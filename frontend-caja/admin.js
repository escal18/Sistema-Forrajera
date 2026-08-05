const API_PRODUCTOS = 'http://localhost:3000/api/productos';
const API_CORTES = 'http://localhost:3000/api/cortes/hoy';

// Al cargar la página, traemos el catálogo inmediatamente
document.addEventListener('DOMContentLoaded', () => {
    cargarCatalogo();
    actualizarCorte();
    cargarHistorialVentas(); // <-- Nueva línea
    etInterval(() => {
        cargarCatalogo();
        actualizarCorte();
        cargarHistorialVentas();
    }, 1000);
});

// ==========================================
// 1. Lógica del Corte de Caja Mejorado
// ==========================================
const btnGenerarCorte = document.getElementById('btn-generar-corte');
const inputFondoCaja = document.getElementById('fondo-caja');

btnGenerarCorte.addEventListener('click', () => {
    actualizarCorte();
    cargarHistorialVentas();
});

// Hacer que el total esperado se recalcule si el admin cambia el fondo manualmente
inputFondoCaja.addEventListener('input', calcularTotalCajon);

// Variable global para guardar cuánto se vendió realmente
let totalVentasDia = 0; 

async function actualizarCorte() {
    try {
        const respuesta = await fetch(API_CORTES);
        const corte = await respuesta.json();

        document.getElementById('admin-tickets').textContent = corte.tickets_emitidos;
        
        // Guardamos las ventas netas y las mostramos
        totalVentasDia = parseFloat(corte.total_esperado);
        document.getElementById('admin-ventas').textContent = `$${totalVentasDia.toFixed(2)}`;

        // Calculamos la suma final
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
                    <!-- Botón para Editar -->
                    <button class="btn-editar" style="padding: 5px 10px; background-color: #f39c12; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        Editar
                    </button>
                </td>
            `;
            
            // Asignar el evento al botón de editar de esta fila
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

// Función que llena el formulario con los datos del producto seleccionado
function cargarDatosEnFormulario(producto) {
    inputId.value = producto.id_producto;
    document.getElementById('prod-codigo').value = producto.codigo_interno;
    document.getElementById('prod-nombre').value = producto.nombre;
    document.getElementById('prod-unidad').value = producto.unidad_medida;
    document.getElementById('prod-precio').value = producto.precio;
    document.getElementById('prod-stock').value = producto.stock;

    // Cambiar la apariencia del formulario para que se note que es edición
    btnGuardarProd.textContent = 'Actualizar Producto';
    btnGuardarProd.style.backgroundColor = '#f39c12';
    btnCancelarEdicion.classList.remove('oculto'); // Mostrar botón cancelar
    
    // Hacer scroll suave hacia arriba para que el usuario vea el formulario
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Función para limpiar el formulario y salir del modo edición
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

    // Extraemos los datos del formulario
    const datosProducto = {
        codigo_interno: document.getElementById('prod-codigo').value.toUpperCase(),
        nombre: document.getElementById('prod-nombre').value,
        unidad_medida: document.getElementById('prod-unidad').value,
        precio: parseFloat(document.getElementById('prod-precio').value),
        stock: parseFloat(document.getElementById('prod-stock').value)
    };

    const idEdicion = inputId.value;
    
    // Si idEdicion tiene algo, hacemos PUT (Actualizar), si está vacío hacemos POST (Crear)
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
            cargarCatalogo(); // Recargamos la tabla
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
// 4.Cargar Historial de Ventas
// ==========================================
async function cargarHistorialVentas() {
    try {
        const respuesta = await fetch('http://localhost:3000/api/ventas/hoy/detalle');
        const ventas = await respuesta.json();
        
        const cuerpoVentas = document.getElementById('cuerpo-ventas');
        cuerpoVentas.innerHTML = '';

        ventas.forEach(venta => {
            // Extraer solo la hora (HH:MM) de la fecha_hora
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
        // Hacemos fetch al nuevo endpoint enviando las fechas por la URL
        const respuesta = await fetch(`http://localhost:3000/api/ventas/reportes?inicio=${inicio}&fin=${fin}`);
        const ventas = await respuesta.json();
        
        const cuerpoReportes = document.getElementById('cuerpo-reportes');
        cuerpoReportes.innerHTML = '';
        let totalPeriodo = 0;

        // Si no hay ventas en esas fechas
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

        // Si hay ventas, creamos la tabla y vamos sumando el total
        ventas.forEach(venta => {
            totalPeriodo += parseFloat(venta.total);
            
            // Formatear para que se vea el día, mes y año junto con la hora
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

        // Actualizamos el número verde grande con la ganancia de esos días
        document.getElementById('total-reporte').textContent = `$${totalPeriodo.toFixed(2)}`;

    } catch (error) {
        console.error('Error al buscar reporte:', error);
        alert('Hubo un problema al generar el reporte.');
    }
});