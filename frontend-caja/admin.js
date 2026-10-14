const API_PRODUCTOS = 'http://localhost:3000/api/productos';
const API_CORTES = 'http://localhost:3000/api/cortes/hoy';

// Al cargar la página, inicializamos los datos y recuperamos el fondo del turno
document.addEventListener('DOMContentLoaded', () => {
    // 1. Recuperar el fondo inicial guardado (Opción A: persiste para el turno/día)
    if (localStorage.getItem('fondo_inicial')) {
        document.getElementById('fondo-caja').value = localStorage.getItem('fondo_inicial');
    }

    cargarCatalogo();
    actualizarCorte();
    cargarHistorialVentas();
    cargarHistorialCortes();

    // Sincronización automática cada 5 segundos (Polling eficiente)
    setInterval(() => {
        cargarCatalogo();
        actualizarCorte();
        cargarHistorialVentas();
    }, 5000);
});

// ==========================================
// 1. Lógica del Corte de Caja y Fondo Inicial
// ==========================================
const btnGenerarCorte = document.getElementById('btn-generar-corte');
const inputFondoCaja = document.getElementById('fondo-caja');

btnGenerarCorte.addEventListener('click', () => {
    actualizarCorte();
    cargarHistorialVentas();
    alert('Datos actualizados manualmente.');
});

// Guardar automáticamente el fondo en el navegador cada vez que se modifique
inputFondoCaja.addEventListener('input', (e) => {
    localStorage.setItem('fondo_inicial', e.target.value);
    calcularTotalCajon();
});

// Variable global para guardar cuánto se vendió realmente en el turno
let totalVentasDia = 0; 

async function actualizarCorte() {
    try {
        const respuesta = await fetch(API_CORTES);
        const corte = await respuesta.json();

        document.getElementById('admin-tickets').textContent = corte.tickets_emitidos;
        
        // Guardamos las ventas netas del turno actual y las mostramos
        totalVentasDia = parseFloat(corte.total_esperado);
        document.getElementById('admin-ventas').textContent = `$${totalVentasDia.toFixed(2)}`;

        // Calculamos la suma final (Fondo + Ventas)
        calcularTotalCajon();
    } catch (error) {
        console.error('Error al obtener el corte:', error);
    }
}

function calcularTotalCajon() {
    const fondo = parseFloat(inputFondoCaja.value) || 0;
    const totalEsperado = totalVentasDia + fondo;
    document.getElementById('admin-total-cajon').textContent = `$${totalEsperado.toFixed(2)}`;
}

// ==========================================
// 2. Lógica del Catálogo (CRUD)
// ==========================================
async function cargarCatalogo() {
    try {
        const respuesta = await fetch(API_PRODUCTOS);
        const productos = await respuesta.json();
        
        const cuerpoCatalogo = document.getElementById('cuerpo-catalogo');
        cuerpoCatalogo.innerHTML = '';

        productos.forEach(prod => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${prod.codigo_interno}</strong></td>
                <td>${prod.nombre} <br><small>${prod.unidad_medida}</small></td>
                <td>$${parseFloat(prod.precio).toFixed(2)}</td>
                <td>
                    <span style="color: ${prod.stock < 5 ? 'red' : 'black'}; font-weight: bold;">
                        ${parseFloat(prod.stock).toFixed(3)}
                    </span>
                </td>
                <td>
                    <button class="btn-editar" style="padding: 5px 10px; background-color: #f39c12; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        Editar
                    </button>
                </td>
            `;
            
            const btnEditar = tr.querySelector('.btn-editar');
            btnEditar.addEventListener('click', () => cargarDatosEnFormulario(prod));

            cuerpoCatalogo.appendChild(tr);
        });

    } catch (error) {
        console.error('Error al cargar catálogo:', error);
    }
}

// ==========================================
// 3. Alta y Edición de Productos
// ==========================================
const formProducto = document.getElementById('form-producto');
const inputId = document.getElementById('prod-id');
const btnGuardarProd = document.getElementById('btn-guardar-prod');
const btnCancelarEdicion = document.getElementById('btn-cancelar-edicion');

function cargarDatosEnFormulario(producto) {
    inputId.value = producto.id_producto;
    document.getElementById('prod-codigo').value = producto.codigo_interno;
    document.getElementById('prod-nombre').value = producto.nombre;
    document.getElementById('prod-unidad').value = producto.unidad_medida;
    document.getElementById('prod-precio').value = producto.precio;
    document.getElementById('prod-stock').value = producto.stock;

    btnGuardarProd.textContent = 'Actualizar Producto';
    btnGuardarProd.style.backgroundColor = '#f39c12';
    btnCancelarEdicion.classList.remove('oculto');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetearFormulario() {
    formProducto.reset();
    inputId.value = '';
    btnGuardarProd.textContent = 'Guardar Producto';
    btnGuardarProd.style.backgroundColor = '#1976d2';
    btnCancelarEdicion.classList.add('oculto');
}

btnCancelarEdicion.addEventListener('click', resetearFormulario);

formProducto.addEventListener('submit', async (e) => {
    e.preventDefault(); 

    const datosProducto = {
        codigo_interno: document.getElementById('prod-codigo').value.toUpperCase(),
        nombre: document.getElementById('prod-nombre').value,
        unidad_medida: document.getElementById('prod-unidad').value,
        precio: parseFloat(document.getElementById('prod-precio').value),
        stock: parseFloat(document.getElementById('prod-stock').value)
    };

    const idEdicion = inputId.value;
    const metodoHttp = idEdicion ? 'PUT' : 'POST';
    const urlEndpoint = idEdicion ? `${API_PRODUCTOS}/${idEdicion}` : API_PRODUCTOS;

    try {
        const respuesta = await fetch(urlEndpoint, {
            method: metodoHttp,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosProducto)
        });

        if (respuesta.ok) {
            alert(idEdicion ? 'Producto actualizado correctamente' : 'Producto agregado exitosamente');
            resetearFormulario();
            cargarCatalogo();
        } else {
            const error = await respuesta.json();
            alert(`Error: ${error.error}`);
        }
    } catch (error) {
        console.error('Error al guardar/actualizar:', error);
        alert('Hubo un problema de conexión con el servidor.');
    }
});

// ==========================================
// 4. Cargar Historial de Ventas
// ==========================================
async function cargarHistorialVentas() {
    try {
        const respuesta = await fetch('http://localhost:3000/api/ventas/hoy/detalle');
        const ventas = await respuesta.json();
        
        const cuerpoVentas = document.getElementById('cuerpo-ventas');
        cuerpoVentas.innerHTML = '';

        ventas.forEach(venta => {
            const horaVenta = new Date(venta.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>#${venta.id_venta}</strong></td>
                <td>${horaVenta}</td>
                <td>${venta.metodo_pago}</td>
                <td style="color: #27ae60; font-weight: bold;">$${parseFloat(venta.total).toFixed(2)}</td>
            `;
            cuerpoVentas.appendChild(tr);
        });

    } catch (error) {
        console.error('Error al cargar historial de ventas:', error);
    }
}

// ==========================================
// 5. Lógica de Reportes Históricos
// ==========================================
const btnBuscarReporte = document.getElementById('btn-buscar-reporte');

btnBuscarReporte.addEventListener('click', async () => {
    const inicio = document.getElementById('fecha-inicio').value;
    const fin = document.getElementById('fecha-fin').value;

    if (!inicio || !fin) {
        alert('Por favor selecciona ambas fechas para buscar.');
        return;
    }

    try {
        const respuesta = await fetch(`http://localhost:3000/api/ventas/reportes?inicio=${inicio}&fin=${fin}`);
        const ventas = await respuesta.json();
        
        const cuerpoReportes = document.getElementById('cuerpo-reportes');
        cuerpoReportes.innerHTML = '';
        let totalPeriodo = 0;

        if (ventas.length === 0) {
            cuerpoReportes.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 20px; color: #e74c3c;">
                        No se encontraron ventas entre el ${inicio} y el ${fin}.
                    </td>
                </tr>`;
            document.getElementById('total-reporte').textContent = '$0.00';
            return;
        }

        ventas.forEach(venta => {
            totalPeriodo += parseFloat(venta.total);
            const fechaCompleta = new Date(venta.fecha_hora).toLocaleString();
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1;"><strong>#${venta.id_venta}</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1;">${fechaCompleta}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1;">${venta.metodo_pago}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1; text-align: right; color: #27ae60; font-weight: bold;">
                    $${parseFloat(venta.total).toFixed(2)}
                </td>
            `;
            cuerpoReportes.appendChild(tr);
        });

        document.getElementById('total-reporte').textContent = `$${totalPeriodo.toFixed(2)}`;

    } catch (error) {
        console.error('Error al buscar reporte:', error);
        alert('Hubo un problema al generar el reporte.');
    }
});

// ==========================================
// 6. Lógica para Guardar Turno y Ver Historial
// ==========================================
const btnGuardarCorte = document.getElementById('btn-guardar-corte');

btnGuardarCorte.addEventListener('click', async () => {
    const fondo = parseFloat(document.getElementById('fondo-caja').value) || 0;
    const tickets = document.getElementById('admin-tickets').textContent;
    const ventas = totalVentasDia; 
    const totalCajon = ventas + fondo;

    if (ventas === 0) {
        alert('No hay ventas registradas en este turno para cortar.');
        return;
    }

    const turnoActual = prompt('¿Qué turno estás cerrando? (Ej. Turno Mañana, Turno Tarde):', 'Turno Mañana');
    if (!turnoActual) return;

    if (!confirm(`¿Cerrar ${turnoActual} con ventas por $${ventas.toFixed(2)} y dejar la caja lista para el siguiente turno?`)) {
        return;
    }

    try {
        const respuesta = await fetch('http://localhost:3000/api/cortes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fondo_inicial: fondo,
                ventas_dia: ventas,
                total_esperado: totalCajon,
                tickets_emitidos: parseInt(tickets),
                turno: turnoActual
            })
        });

        if (respuesta.ok) {
            alert(`¡${turnoActual} guardado con éxito! La pantalla se ha reiniciado para el siguiente turno.`);
            
            // Reiniciamos los contadores visuales locales
            totalVentasDia = 0;
            document.getElementById('admin-ventas').textContent = '$0.00';
            document.getElementById('admin-tickets').textContent = '0';
            calcularTotalCajon();
            
            cargarHistorialCortes();
        } else {
            alert('Error al guardar el corte de turno.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error de conexión con el servidor.');
    }
});

async function cargarHistorialCortes() {
    try {
        const respuesta = await fetch('http://localhost:3000/api/cortes/historial');
        const historial = await respuesta.json();
        
        const cuerpo = document.getElementById('cuerpo-historial-cortes');
        cuerpo.innerHTML = '';

        if (historial.length === 0) {
            cuerpo.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 15px; color: #7f8c8d;">No hay cortes guardados todavía.</td></tr>`;
            return;
        }

        historial.forEach(corte => {
            const fechaFormateada = new Date(corte.fecha).toLocaleDateString();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1;"><strong>${fechaFormateada}</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1;">${corte.turno || 'Turno Único'}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1; text-align: center;">${corte.tickets_emitidos}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1; text-align: right; color: #27ae60;">$${parseFloat(corte.ventas_dia).toFixed(2)}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ecf0f1; text-align: right; font-weight: bold;">$${parseFloat(corte.total_esperado).toFixed(2)}</td>
            `;
            cuerpo.appendChild(tr);
        });
    } catch (error) {
        console.error('Error al cargar historial de cortes:', error);
    }
}