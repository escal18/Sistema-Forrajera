const express = require("express");
const cors = require("cors");

// 1. Importación moderna de Firebase (v10+)
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./firebase-key.json");

// 2. Inicializar Firebase
initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();
const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// ENDPOINT 1: Buscar Productos (GET)
// ==========================================
app.get("/api/productos", async (req, res) => {
  try {
    const { buscar } = req.query;
    const productosRef = db.collection("productos");
    const snapshot = await productosRef.get();

    let productos = [];
    snapshot.forEach((doc) => {
      // En Firestore, el ID del documento viene separado de los datos
      productos.push({ id_producto: doc.id, ...doc.data() });
    });

    // Firestore no tiene un operador ILIKE nativo, la búsqueda de texto parcial
    // se maneja filtrando el arreglo en memoria (para catálogos pequeños/medianos)
    if (buscar) {
      const termino = buscar.toLowerCase();
      productos = productos.filter(
        (p) =>
          p.nombre.toLowerCase().includes(termino) ||
          p.codigo_interno.toLowerCase().includes(termino),
      );
    }

    res.json(productos);
  } catch (error) {
    console.error("Error al buscar:", error);
    res.status(500).json({ error: "Error al consultar Firestore" });
  }
});

// ==========================================
// ENDPOINT 2: Crear un Producto (POST)
// ==========================================
app.post("/api/productos", async (req, res) => {
  try {
    const { codigo_interno, nombre, unidad_medida, precio, stock } = req.body;

    // Verificar si el código ya existe (simulando el UNIQUE de SQL)
    const existe = await db
      .collection("productos")
      .where("codigo_interno", "==", codigo_interno)
      .get();
    if (!existe.empty) {
      return res.status(400).json({ error: "El código interno ya existe." });
    }

    const nuevoProducto = {
      codigo_interno,
      nombre,
      unidad_medida,
      precio: parseFloat(precio),
      stock: parseFloat(stock),
    };

    const docRef = await db.collection("productos").add(nuevoProducto);

    res.status(201).json({ id_producto: docRef.id, ...nuevoProducto });
  } catch (error) {
    console.error("Error al insertar:", error);
    res.status(500).json({ error: "Problema al guardar el producto" });
  }
});

// ==========================================
// ENDPOINT 3: Procesar Venta con Transacción (POST)
// ==========================================
app.post("/api/ventas", async (req, res) => {
  try {
    const { metodo_pago, id_usuario, articulos } = req.body;
    let totalVenta = 0;

    // Usamos runTransaction para asegurar operaciones ACID en la nube
    await db.runTransaction(async (t) => {
      const lecturasProductos = [];

      // 1. Leer todos los productos involucrados primero (Regla de Firestore: Leer antes de Escribir)
      for (const articulo of articulos) {
        const docRef = db.collection("productos").doc(articulo.id_producto);
        lecturasProductos.push({
          ref: docRef,
          doc: await t.get(docRef),
          cantidadComprada: parseFloat(articulo.cantidad),
        });
      }

      // 2. Validar stock y calcular total
      lecturasProductos.forEach(({ doc, cantidadComprada }) => {
        if (!doc.exists) throw new Error(`Producto no encontrado.`);

        const producto = doc.data();
        if (cantidadComprada > producto.stock) {
          throw new Error(`Stock insuficiente de ${producto.nombre}.`);
        }
        totalVenta += cantidadComprada * producto.precio;
      });

      // 3. Ejecutar las escrituras (descontar stock)
      lecturasProductos.forEach(({ ref, doc, cantidadComprada }) => {
        const nuevoStock = doc.data().stock - cantidadComprada;
        t.update(ref, { stock: nuevoStock });
      });

      // 4. Guardar el ticket (incrustando los artículos directamente en el documento)
      const nuevaVentaRef = db.collection("ventas").doc();
      t.set(nuevaVentaRef, {
        total: totalVenta,
        metodo_pago,
        fecha_hora: FieldValue.serverTimestamp(), // Estampa de tiempo nativa corregida
        articulos: articulos,
      });
    });

    res.status(201).json({
      mensaje: "Venta procesada correctamente en la nube",
      ticket: { total: totalVenta },
    });
  } catch (error) {
    console.error("Error en transacción de venta:", error.message);
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// ENDPOINT 4: Corte de Caja del Día (GET)
// ==========================================
app.get('/api/cortes/hoy', async (req, res) => {
  try {
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);

    const snapshot = await db.collection('ventas')
        .where('fecha_hora', '>=', hoyInicio)
        .get();

    let ticketsEmitidos = 0;
    let totalEsperado = 0;

    snapshot.forEach(doc => {
        ticketsEmitidos++;
        totalEsperado += doc.data().total;
    });

    res.json({
        fecha: new Date().toLocaleDateString(),
        tickets_emitidos: ticketsEmitidos,
        total_esperado: totalEsperado
    });
  } catch (error) {
    console.error('Error al generar el corte:', error);
    res.status(500).json({ error: 'Hubo un problema al calcular el corte de caja' });
  }
});

// ==========================================
// ENDPOINT 5: Actualizar Producto (PUT)
// ==========================================
app.put("/api/productos/:id", async (req, res) => {
  try {
    const id_producto = req.params.id;
    const { codigo_interno, nombre, unidad_medida, precio, stock } = req.body;

    const docRef = db.collection("productos").doc(id_producto);
    await docRef.update({
      codigo_interno,
      nombre,
      unidad_medida,
      precio: parseFloat(precio),
      stock: parseFloat(stock),
    });

    res.json({ id_producto, mensaje: "Producto actualizado" });
  } catch (error) {
    console.error("Error al actualizar:", error);
    res.status(500).json({ error: "Error al actualizar el producto" });
  }
});

// ==========================================
// ENDPOINT 6: Historial de Ventas del Día (GET)
// ==========================================
app.get("/api/ventas/hoy/detalle", async (req, res) => {
  try {
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);

    const snapshot = await db
      .collection("ventas")
      .where("fecha_hora", ">=", hoyInicio)
      .orderBy("fecha_hora", "desc")
      .get();

    let ventas = [];
    snapshot.forEach((doc) => {
      const data = doc.data();

      // Firestore guarda las fechas como un objeto Timestamp especial.
      // Lo convertimos a formato Date estándar para que el frontend lo entienda.
      const fechaNormal = data.fecha_hora
        ? data.fecha_hora.toDate()
        : new Date();

      ventas.push({
        id_venta: doc.id, // En Firestore usamos doc.id como identificador
        fecha_hora: fechaNormal,
        total: data.total,
        metodo_pago: data.metodo_pago,
      });
    });

    res.json(ventas);
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ error: "Error al obtener el historial de ventas" });
  }
});

// ==========================================
// ENDPOINT 7: Reporte de Ventas por Fechas (GET)
// ==========================================
app.get("/api/ventas/reportes", async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    // Convertimos las fechas enviadas por el calendario a formato Date para Firestore
    const fechaInicio = new Date(`${inicio}T00:00:00`);
    const fechaFin = new Date(`${fin}T23:59:59`);

    // Consultamos Firebase buscando fechas en ese rango
    const snapshot = await db
      .collection("ventas")
      .where("fecha_hora", ">=", fechaInicio)
      .where("fecha_hora", "<=", fechaFin)
      .orderBy("fecha_hora", "desc")
      .get();

    let ventas = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      ventas.push({
        id_venta: doc.id,
        fecha_hora: data.fecha_hora ? data.fecha_hora.toDate() : new Date(),
        total: data.total,
        metodo_pago: data.metodo_pago,
      });
    });

    res.json(ventas);
  } catch (error) {
    console.error("Error al generar reporte:", error);
    res.status(500).json({ error: "Error al obtener el reporte de ventas" });
  }
});

// ==========================================
// ENDPOINT 8: Guardar Corte de Turno (POST)
// ==========================================
app.post('/api/cortes', async (req, res) => {
    try {
        const { fondo_inicial, ventas_dia, total_esperado, tickets_emitidos, turno } = req.body;

        const nuevoCorte = {
            fondo_inicial: parseFloat(fondo_inicial),
            ventas_dia: parseFloat(ventas_dia),
            total_esperado: parseFloat(total_esperado),
            tickets_emitidos: parseInt(tickets_emitidos),
            turno: turno || 'Turno Único',
            fecha_corte: FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('cortes_caja').add(nuevoCorte);
        res.status(201).json({ id_corte: docRef.id, mensaje: 'Corte de turno guardado exitosamente' });
    } catch (error) {
        console.error('Error al guardar el corte:', error);
        res.status(500).json({ error: 'Error al registrar el corte de caja' });
    }
});

// ==========================================
// ENDPOINT 9: Consultar Historial de Cortes (GET)
// ==========================================
app.get('/api/cortes/historial', async (req, res) => {
    try {
        const snapshot = await db.collection('cortes_caja')
            .orderBy('fecha_corte', 'desc')
            .get();

        let historial = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const fechaNormal = data.fecha_corte ? data.fecha_corte.toDate() : new Date();
            historial.push({
                id_corte: doc.id,
                fecha: fechaNormal,
                ...data
            });
        });

        res.json(historial);
    } catch (error) {
        console.error('Error al obtener historial de cortes:', error);
        res.status(500).json({ error: 'Error al obtener los cortes pasados' });
    }
});

const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(`Servidor Firestore corriendo en http://localhost:${PUERTO}`);
});
