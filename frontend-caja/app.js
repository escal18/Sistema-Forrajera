// URLs de nuestra API local
const API_PRODUCTOS = 'http://localhost:3000/api/productos';
const API_VENTAS = 'http://localhost:3000/api/ventas';

// Aquí guardaremos los artículos que el cajero vaya agregando
let ticketActual = [];

// Referencias a elementos del DOM
const inputBuscador = document.getElementById('input-buscador');
const cuerpoTicket = document.getElementById('cuerpo-ticket');
const displayTotal = document.getElementById('total-venta');
const btnCobrar = document.getElementById('btn-cobrar');
const btnCorte = document.getElementById('btn-corte');

// ==========================================
// 1. Buscador de Productos en Tiempo Real
// ==========================================

// Escuchar cada vez que el cajero teclea algo
inputBuscador.addEventListener('input', async (e) => {
    const textoBusqueda = e.target.value;
    const listaResultados = document.getElementById('lista-resultados');

    // Si borran el texto, ocultamos la lista
    if (textoBusqueda.trim() === '') {
        listaResultados.classList.add('oculto');
        return;
    }

    try {
        // Hacemos la petición a nuestra API en Node.js
        const respuesta = await fetch(`${API_PRODUCTOS}?buscar=${textoBusqueda}`);
        const productos = await respuesta.json();

        mostrarResultadosBuscador(productos);
    } catch (error) {
        console.error("Error al conectar con la API:", error);
    }
});

// Función para dibujar la lista de resultados debajo del input
function mostrarResultadosBuscador(productos) {
    const listaResultados = document.getElementById('lista-resultados');
    listaResultados.innerHTML = ''; // Limpiar búsqueda anterior

    if (productos.length === 0) {
        listaResultados.classList.add('oculto');
        return;
    }

    // Mostrar el contenedor de la lista
    listaResultados.classList.remove('oculto');
    listaResultados.style.listStyle = "none";
    listaResultados.style.padding = "0";
    listaResultados.style.margin = "0";
    listaResultados.style.border = "1px solid #ccc";
    listaResultados.style.maxHeight = "200px";
    listaResultados.style.overflowY = "auto";

    // Crear una fila por cada producto encontrado en Postgres
    productos.forEach(producto => {
        const li = document.createElement('li');
        li.textContent = `[${producto.codigo_interno}] ${producto.nombre} - $${producto.precio} / ${producto.unidad_medida}`;
        
        // Estilos para que parezca un botón clickeable
        li.style.padding = "10px";
        li.style.borderBottom = "1px solid #eee";
        li.style.cursor = "pointer";
        li.style.backgroundColor = "white";

        // Efecto hover simple
        li.onmouseover = () => li.style.backgroundColor = "#f0f8ff";
        li.onmouseout = () => li.style.backgroundColor = "white";

        // ¿Qué pasa al hacer clic en un producto?
        li.addEventListener('click', () => {
            agregarAlTicket(producto); // Agregamos a la tabla
            inputBuscador.value = ''; // Limpiamos la barra de búsqueda
            listaResultados.classList.add('oculto'); // Escondemos la lista
        });

        listaResultados.appendChild(li);
    });
} 

// ==========================================
// 2. Lógica del Ticket y Totales
// ==========================================

function agregarAlTicket(producto) {
    // Revisar si el producto ya está en el ticket
    const productoExistente = ticketActual.find(item => item.id_producto === producto.id_producto);

    if (productoExistente) {
        // Si ya existe, le sumamos 1 a la cantidad
        productoExistente.cantidad += 1;
    } else {
        // Si es nuevo, lo agregamos al arreglo con cantidad 1
        ticketActual.push({
            id_producto: producto.id_producto,
            codigo_interno: producto.codigo_interno,
            nombre: producto.nombre,
            unidad_medida: producto.unidad_medida,
            precio: parseFloat(producto.precio),
            cantidad: 1
        });
    }

    renderizarTicket();
}

function renderizarTicket() {
    cuerpoTicket.innerHTML = ''; // Limpiamos la tabla antes de redibujar
    let total = 0;

    ticketActual.forEach((articulo, index) => {
        const subtotal = articulo.cantidad * articulo.precio;
        total += subtotal;

        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td>
                <strong>${articulo.codigo_interno}</strong><br>
                <small>${articulo.nombre}</small>
            </td>
            <td>
                <!-- Input tipo number que permite decimales (step="0.001") -->
                <input type="number" 
                       value="${articulo.cantidad}" 
                       step="0.001" 
                       min="0.001"
                       class="input-cantidad"
                       onchange="actualizarCantidad(${index}, this.value)">
                <small>${articulo.unidad_medida}</small>
            </td>
            <td>$${articulo.precio.toFixed(2)}</td>
            <td><strong>$${subtotal.toFixed(2)}</strong></td>
            <td>
                <button onclick="eliminarArticulo(${index})" style="color: red; cursor: pointer;">X</button>
            </td>
        `;

        cuerpoTicket.appendChild(tr);
    });

    // Actualizamos el número grande del panel derecho
    displayTotal.textContent = total.toFixed(2);
}

// Función que se ejecuta cuando el cajero cambia el número en la casilla de cantidad
function actualizarCantidad(index, nuevaCantidad) {
    const cantidadParseada = parseFloat(nuevaCantidad);
    
    if (cantidadParseada > 0) {
        ticketActual[index].cantidad = cantidadParseada;
    } else {
        ticketActual[index].cantidad = 1; // Prevenir cantidades negativas o cero
    }
    
    renderizarTicket(); // Redibujar para actualizar los subtotales
}

// Función para el botón rojo de eliminar (X)
function eliminarArticulo(index) {
    ticketActual.splice(index, 1); // Quita el elemento del arreglo
    renderizarTicket();
}

// ==========================================
// 3. Procesar la Venta (Enviar al Backend)
// ==========================================

btnCobrar.addEventListener('click', async () => {
    // 1. Validar que haya artículos en el ticket
    if (ticketActual.length === 0) {
        alert('El ticket está vacío. Agrega productos antes de cobrar.');
        return;
    }

    // 2. Preparar los datos tal como los espera nuestra API
    const metodoPago = document.getElementById('metodo-pago').value;
    
    // Transformamos nuestro arreglo del ticket al formato exacto que pide el backend
    const datosVenta = {
        metodo_pago: metodoPago,
        id_usuario: null, // Lo dejamos en null por ahora, listo para cuando agregues login
        articulos: ticketActual.map(articulo => {
            return {
                id_producto: articulo.id_producto,
                cantidad: articulo.cantidad
            };
        })
    };

    // Deshabilitar el botón temporalmente para evitar dobles cobros si el cajero da doble clic
    btnCobrar.disabled = true;
    btnCobrar.textContent = 'Procesando...';

    try {
        // 3. Enviar la petición POST al servidor
        const respuesta = await fetch(API_VENTAS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datosVenta)
        });

        const resultado = await respuesta.json();

        // 4. Evaluar la respuesta del servidor
        if (respuesta.ok) {
            // Éxito: Mostramos el mensaje y el folio
            alert(`¡${resultado.mensaje}!\nFolio del ticket: ${resultado.ticket.folio}\nTotal cobrado: $${resultado.ticket.total}`);
            
            // Limpiamos la pantalla dejándola lista para el siguiente cliente
            ticketActual = [];
            renderizarTicket();
            document.getElementById('input-buscador').focus(); // Regresamos el cursor al buscador
            inputPagoCon.value = '';
            displayCambio.textContent = '0.00';
        } else {
            // Error del backend (ej. no hay stock suficiente de un producto)
            alert(`Venta rechazada: ${resultado.error}`);
        }

    } catch (error) {
        console.error('Error de red al cobrar:', error);
        alert('Error de comunicación con el servidor. Revisa que el backend esté corriendo.');
    } finally {
        // Volvemos a habilitar el botón sin importar si hubo éxito o error
        btnCobrar.disabled = false;
        btnCobrar.textContent = 'Cobrar e Imprimir';
    }
});

// ==========================================
// 4. Cálculo de Cambio
// ==========================================
const inputPagoCon = document.getElementById('pago-con');
const displayCambio = document.getElementById('cambio-venta');

inputPagoCon.addEventListener('input', () => {
    // Obtenemos el total actual leyendo el texto del display y convirtiéndolo a número
    const totalActual = parseFloat(displayTotal.textContent);
    const pagoCon = parseFloat(inputPagoCon.value) || 0;

    let cambio = pagoCon - totalActual;
    
    // Si el cambio es negativo (aún no completa), mostramos 0
    if (cambio < 0) cambio = 0;

    displayCambio.textContent = cambio.toFixed(2);
});
