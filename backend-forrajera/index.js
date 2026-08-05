const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json()); // Permite recibir datos en formato JSON

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "caja_forrajera",
  password: "18092004", // Tu contraseña real
  port: 5432,
});

// ==========================================
// ENDPOINT DE PRUEBA
// ==========================================
app.get("/api/test", async (req, res) => {
  try {
    const resultado = await pool.query("SELECT * FROM Productos");
    res.json({
      mensaje: "¡Conexión exitosa a PostgreSQL!",
      productos: resultado.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al conectar con la base de datos" });
  }
});

// ==========================================
// ENDPOINT 1: Buscar Productos (GET)
// ==========================================
app.get("/api/productos", async (req, res) => {
  try {
    const { buscar } = req.query;

    let query = "SELECT * FROM Productos";
    let parametros = [];

    if (buscar) {
      query += " WHERE nombre ILIKE $1 OR codigo_interno ILIKE $1";
      parametros.push(`%${buscar}%`);
    }

    const resultado = await pool.query(query, parametros);
    res.json(resultado.rows);
  } catch (error) {
    console.error("Error al buscar:", error);
    res.status(500).json({ error: "Hubo un problema al buscar los productos" });
  }
});

// ==========================================
// ENDPOINT 2: Crear un Producto (POST)
// ==========================================
app.post("/api/productos", async (req, res) => {
  try {
    const { codigo_interno, nombre, unidad_medida, precio, stock } = req.body;

    const query = `
      INSERT INTO Productos (codigo_interno, nombre, unidad_medida, precio, stock)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const parametros = [codigo_interno, nombre, unidad_medida, precio, stock];

    const resultado = await pool.query(query, parametros);

    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al insertar:", error);
    if (error.code === "23505") {
      return res.status(400).json({ error: "El código interno ya existe." });
    }
    res.status(500).json({ error: "Hubo un problema al guardar el producto" });
  }
});

// ==========================================
// ENDPOINT 3: Procesar Venta (POST)
// ==========================================
app.post('/api/ventas', async (req, res) => {
  // En lugar de usar pool.query directo, solicitamos un "cliente" exclusivo 
  // para poder agrupar varias consultas en una sola transacción.
  const cliente = await pool.connect();

  try {
    // 1. Iniciamos la transacción
    await cliente.query('BEGIN');

    // Extraemos los datos enviados (nota: el frontend no envía precios)
    const { metodo_pago, id_usuario, articulos } = req.body;

    let totalVenta = 0;
    const detallesParaInsertar = [];

    // 2. Procesar cada artículo iterando sobre ellos
    for (const articulo of articulos) {
      // Buscar el precio actual y el stock del producto
      const resProducto = await cliente.query(
        'SELECT nombre, precio, stock FROM Productos WHERE id_producto = $1',
        [articulo.id_producto]
      );

      if (resProducto.rows.length === 0) {
        throw new Error(`El producto con ID ${articulo.id_producto} no existe.`);
      }

      const producto = resProducto.rows[0];
      
      // Convertimos a números para poder operar (Postgres devuelve los DECIMAL como strings en Node)
      const cantidadComprada = parseFloat(articulo.cantidad);
      const stockDisponible = parseFloat(producto.stock);
      const precioUnitario = parseFloat(producto.precio);

      // Validar si hay stock suficiente
      if (cantidadComprada > stockDisponible) {
        throw new Error(`Stock insuficiente de ${producto.nombre}. Disponible: ${stockDisponible}`);
      }

      // Calcular el subtotal de este artículo
      const subtotal = cantidadComprada * precioUnitario;
      totalVenta += subtotal;

      // Descontar el stock en la base de datos
      await cliente.query(
        'UPDATE Productos SET stock = stock - $1 WHERE id_producto = $2',
        [cantidadComprada, articulo.id_producto]
      );

      // Guardamos en memoria los datos para insertarlos en Detalle_Venta después
      detallesParaInsertar.push({
        id_producto: articulo.id_producto,
        cantidad: cantidadComprada,
        precio_unitario: precioUnitario,
        subtotal: subtotal
      });
    }

    // 3. Insertar la cabecera de la Venta con el total calculado
    const resVenta = await cliente.query(
      `INSERT INTO Ventas (total, metodo_pago, id_usuario) 
       VALUES ($1, $2, $3) 
       RETURNING id_venta, fecha_hora`,
      [totalVenta, metodo_pago, id_usuario || null] 
    );
    
    const idNuevaVenta = resVenta.rows[0].id_venta;

    // 4. Insertar todos los artículos en Detalle_Venta
    for (const detalle of detallesParaInsertar) {
      await cliente.query(
        `INSERT INTO Detalle_Venta (id_venta, id_producto, cantidad, precio_unitario, subtotal) 
         VALUES ($1, $2, $3, $4, $5)`,
        [idNuevaVenta, detalle.id_producto, detalle.cantidad, detalle.precio_unitario, detalle.subtotal]
      );
    }

    // 5. Si todo salió bien, confirmamos la transacción
    await cliente.query('COMMIT');

    // Devolvemos el éxito al panel web
    res.status(201).json({
      mensaje: 'Venta procesada correctamente',
      ticket: {
        folio: idNuevaVenta,
        fecha: resVenta.rows[0].fecha_hora,
        total: totalVenta
      }
    });

  } catch (error) {
    // Si ALGO falló arriba (ej. falta de stock), revertimos todos los cambios
    await cliente.query('ROLLBACK');
    console.error('Error procesando venta:', error.message);
    res.status(400).json({ error: error.message });
  } finally {
    // Siempre liberamos el cliente para que no se sature la base de datos
    cliente.release();
  }
});

// ==========================================
// ENDPOINT 4: Corte de Caja del Día (GET)
// ==========================================
app.get('/api/cortes/hoy', async (req, res) => {
    try {
        // En PostgreSQL, CURRENT_DATE nos da la fecha de hoy (sin la hora)
        // Usamos DATE(fecha_hora) para extraer solo la fecha del timestamp
        const query = `
            SELECT 
                COUNT(id_venta) as total_tickets,
                COALESCE(SUM(total), 0) as dinero_en_caja
            FROM Ventas 
            WHERE DATE(fecha_hora) = CURRENT_DATE
        `;

        const resultado = await pool.query(query);
        
        res.json({
            fecha: new Date().toLocaleDateString(),
            tickets_emitidos: parseInt(resultado.rows[0].total_tickets),
            total_esperado: parseFloat(resultado.rows[0].dinero_en_caja)
        });

    } catch (error) {
        console.error('Error al generar el corte:', error);
        res.status(500).json({ error: 'Hubo un problema al calcular el corte de caja' });
    }
});

// ==========================================
// ENDPOINT 5: Actualizar Producto (PUT)
// ==========================================
app.put('/api/productos/:id', async (req, res) => {
    try {
        const id_producto = req.params.id;
        const { codigo_interno, nombre, unidad_medida, precio, stock } = req.body;

        const query = `
            UPDATE Productos 
            SET 
                codigo_interno = $1, 
                nombre = $2, 
                unidad_medida = $3, 
                precio = $4, 
                stock = $5
            WHERE id_producto = $6
            RETURNING *;
        `;

        const parametros = [codigo_interno, nombre, unidad_medida, precio, stock, id_producto];
        const resultado = await pool.query(query, parametros);

        if (resultado.rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        res.json(resultado.rows[0]);

    } catch (error) {
        console.error('Error al actualizar:', error);
        // Manejo del error si se intenta poner un código interno que ya tiene otro producto
        if (error.code === '23505') {
            return res.status(400).json({ error: 'El código interno ya está en uso por otro producto.' });
        }
        res.status(500).json({ error: 'Error al actualizar el producto' });
    }
});

// ==========================================
// ENDPOINT 6: Historial de Ventas del Día (GET)
// ==========================================
app.get('/api/ventas/hoy/detalle', async (req, res) => {
    try {
        const query = `
            SELECT id_venta, fecha_hora, total, metodo_pago 
            FROM Ventas 
            WHERE DATE(fecha_hora) = CURRENT_DATE
            ORDER BY fecha_hora DESC; -- Muestra los más recientes primero
        `;
        const resultado = await pool.query(query);
        res.json(resultado.rows);
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ error: 'Error al obtener el historial de ventas' });
    }
});

// ==========================================
// ENDPOINT 7: Reporte de Ventas por Fechas (GET)
// ==========================================
app.get('/api/ventas/reportes', async (req, res) => {
    try {
        // Extraemos las fechas de la URL (ej. ?inicio=2026-08-01&fin=2026-08-31)
        const { inicio, fin } = req.query;

        const query = `
            SELECT id_venta, fecha_hora, total, metodo_pago 
            FROM Ventas 
            WHERE DATE(fecha_hora) BETWEEN $1 AND $2
            ORDER BY fecha_hora DESC;
        `;
        
        const resultado = await pool.query(query, [inicio, fin]);
        res.json(resultado.rows);
    } catch (error) {
        console.error('Error al generar reporte:', error);
        res.status(500).json({ error: 'Error al obtener el reporte de ventas' });
    }
});

// ==========================================
// ARRANCAR EL SERVIDOR (SIEMPRE AL FINAL)
// ==========================================
const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(
    `Servidor de la forrajera corriendo en http://localhost:${PUERTO}`,
  );
});
