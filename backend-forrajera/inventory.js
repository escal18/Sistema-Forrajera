const { randomUUID } = require('node:crypto');
const { fail, text, money, quantity, hash, docId, operationKey, productInput, saleInput, calculateSale, dateRange } = require('./domain');

const millis = value => value?.toDate ? value.toDate().getTime() : new Date(value).getTime();
const withId = snap => snap.exists ? { ...snap.data(), id: snap.id } : null;
function createInventory(db) {
  const ref = (collection, id) => db.collection(collection).doc(id);
  const read = async (collection, id) => withId(await ref(collection, id).get());
  const docs = snapshot => snapshot.docs.map(s => ({ ...s.data(), id: s.id }));
  const actor = user => ({ id_usuario: user.id_usuario, usuario: user.usuario, nombre_usuario: user.nombre });
  function movement(t, id, data, user, now) {
    t.set(ref('movimientos', id), { ...data, ...actor(user), fecha_hora: now });
  }
  async function listProducts(search = '') {
    const rows = docs(await db.collection('productos').get());
    const term = String(search).trim().toLocaleLowerCase('es');
    return rows.filter(p => `${p.nombre} ${p.codigo_interno}`.toLocaleLowerCase('es').includes(term)).map(p => ({ ...p, id_producto: p.id, stock_minimo: p.stock_minimo ?? 0, presentaciones: p.presentaciones || [] })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  async function saveProduct(body, id, user) {
    const data = productInput(body);
    const isNew = !id;
    const productRef = ref('productos', id ? docId(id) : randomUUID());
    const codeRef = ref('codigos_productos', hash(data.codigo_interno));
    const now = new Date();
    return db.runTransaction(async t => {
      const old = await t.get(productRef);
      const reservation = await t.get(codeRef);
      const existing = await t.get(db.collection('productos').where('codigo_interno', '==', data.codigo_interno));
      if (!isNew && !old.exists) fail('El producto no existe.', 404);
      if ((reservation.exists && reservation.data().id_producto !== productRef.id) || existing.docs.some(s => s.id !== productRef.id)) fail('La clave de producto ya existe.', 409);
      const previous = old.exists ? old.data() : null;
      if (previous && data.unidad_medida !== previous.unidad_medida) fail('La unidad base de un producto existente no se puede cambiar. Crea otro producto para evitar alterar su historial.');
      if (previous && body.stock !== undefined && quantity(body.stock) !== quantity(previous.stock)) fail('Registra un movimiento para cambiar las existencias.');
      const stock = isNew ? quantity(body.stock ?? 0, 'Existencia inicial') / 1000 : previous.stock;
      t.set(productRef, { ...previous, ...data, stock, actualizado_en: now });
      t.set(codeRef, { id_producto: productRef.id });
      if (previous && previous.codigo_interno !== data.codigo_interno) t.delete(ref('codigos_productos', hash(previous.codigo_interno)));
      if (isNew && stock) movement(t, `inicial_${productRef.id}`, { id_producto: productRef.id, producto: data.nombre, unidad_medida: data.unidad_medida, tipo: 'inicial', cantidad: stock, stock_anterior: 0, stock_nuevo: stock, motivo: 'Existencia al dar de alta el producto' }, user, now);
      t.set(ref('auditoria', randomUUID()), { tipo: isNew ? 'alta_producto' : 'edicion_producto', id_producto: productRef.id, antes: previous, despues: { ...data, stock }, ...actor(user), fecha_hora: now });
      return { id_producto: productRef.id, ...data, stock };
    });
  }
  async function activeShift(user) {
    const current = await read('usuarios', user.id_usuario);
    return current?.turno_activo ? read('turnos', current.turno_activo) : null;
  }
  async function openShift(body, key, user) {
    const id = operationKey(key);
    const fund = money(body.fondo_inicial, 'Fondo inicial');
    const name = text(body.nombre || 'Turno', 'Nombre del turno', 60);
    return db.runTransaction(async t => {
      const u = await t.get(ref('usuarios', user.id_usuario));
      const shiftRef = ref('turnos', id);
      const existing = await t.get(shiftRef);
      if (existing.exists) {
        const old = existing.data();
        if (old.id_usuario !== user.id_usuario || old.fondo_centavos !== fund || old.nombre !== name) fail('La clave de apertura ya fue utilizada.', 409);
        return { id, ...old };
      }
      if (u.data().turno_activo) fail('Ya tienes un turno abierto. Actualiza la pantalla.', 409);
      const shift = { ...actor(user), nombre: name, estado: 'abierto', fecha_apertura: new Date(), fondo_centavos: fund, efectivo_centavos: 0, tarjeta_centavos: 0, tickets_emitidos: 0, devoluciones: 0 };
      t.set(shiftRef, shift);
      t.update(ref('usuarios', user.id_usuario), { turno_activo: id });
      return { id, ...shift };
    });
  }
  async function closeShift(id, body, user) {
    docId(id);
    const counted = money(body.efectivo_contado, 'Efectivo contado');
    const note = typeof body.observaciones === 'string' ? body.observaciones.trim().slice(0, 500) : '';
    return db.runTransaction(async t => {
      const shiftRef = ref('turnos', id);
      const snap = await t.get(shiftRef);
      const u = await t.get(ref('usuarios', user.id_usuario));
      if (!snap.exists) fail('Turno no encontrado.', 404);
      const shift = snap.data();
      if (shift.id_usuario !== user.id_usuario) fail('Solo puedes cerrar tu propio turno.', 403);
      if (shift.estado === 'cerrado') {
        if (shift.contado_centavos !== counted || shift.observaciones !== note) fail('Este turno ya se cerró con otro conteo.', 409);
        return { id, ...shift };
      }
      if (u.data().turno_activo !== id) fail('Este turno ya no es el activo.', 409);
      const expected = shift.fondo_centavos + shift.efectivo_centavos;
      const closed = { ...shift, estado: 'cerrado', fecha_cierre: new Date(), esperado_centavos: expected, contado_centavos: counted, diferencia_centavos: counted - expected, observaciones: note };
      t.set(shiftRef, closed);
      t.update(ref('usuarios', user.id_usuario), { turno_activo: null });
      return { id, ...closed };
    });
  }
  async function sell(body, key, user) {
    const id = operationKey(key);
    const input = saleInput(body);
    const fingerprint = hash(JSON.stringify(input));
    const now = new Date();
    return db.runTransaction(async t => {
      const saleRef = ref('ventas', id);
      const existing = await t.get(saleRef);
      if (existing.exists) {
        const saved = existing.data();
        if (saved.id_usuario !== user.id_usuario || saved.huella !== fingerprint) fail('Esta clave de venta corresponde a otra operación.', 409);
        return { id_venta: id, ...saved };
      }
      const userSnap = await t.get(ref('usuarios', user.id_usuario));
      const shiftId = userSnap.data().turno_activo;
      if (!shiftId) fail('Abre un turno antes de cobrar.', 409);
      const shiftRef = ref('turnos', shiftId);
      const shiftSnap = await t.get(shiftRef);
      if (!shiftSnap.exists || shiftSnap.data().estado !== 'abierto') fail('El turno está cerrado.', 409);
      const products = new Map();
      for (const productId of new Set(input.articulos.map(a => a.id_producto))) {
        const snap = await t.get(ref('productos', productId));
        if (snap.exists) products.set(productId, snap.data());
      }
      // Cada intento de Firestore vuelve a calcular el total desde cero.
      const result = calculateSale(input, products);
      const sale = { folio: `V-${id.toUpperCase()}`, ...actor(user), id_turno: shiftId, estado: 'completada', fecha_hora: now, huella: fingerprint,
        metodo_pago: input.metodo_pago, articulos: result.articulos, total: result.total_centavos / 100,
        costo_total: result.costo_centavos === null ? null : result.costo_centavos / 100,
        utilidad: result.utilidad_centavos === null ? null : result.utilidad_centavos / 100,
        pago_con: input.pago_con_centavos === null ? null : input.pago_con_centavos / 100, cambio: result.cambio_centavos / 100 };
      for (const [productId, used] of result.stock) {
        const p = products.get(productId);
        const next = (quantity(p.stock) - used) / 1000;
        t.update(ref('productos', productId), { stock: next, actualizado_en: now });
        movement(t, `venta_${id}_${productId}`, { id_producto: productId, producto: p.nombre, unidad_medida: p.unidad_medida, tipo: 'venta', cantidad: -used / 1000, stock_anterior: p.stock, stock_nuevo: next, referencia: id, motivo: sale.folio }, user, now);
      }
      const shift = shiftSnap.data();
      const field = input.metodo_pago === 'Efectivo' ? 'efectivo_centavos' : 'tarjeta_centavos';
      t.update(shiftRef, { [field]: shift[field] + result.total_centavos, tickets_emitidos: shift.tickets_emitidos + 1 });
      t.set(saleRef, sale);
      return { id_venta: id, ...sale };
    });
  }
  async function returnSale(id, body, user) {
    docId(id);
    const reason = text(body.motivo, 'Motivo de devolución', 300);
    return db.runTransaction(async t => {
      const saleRef = ref('ventas', id);
      const saleSnap = await t.get(saleRef);
      const returned = await t.get(ref('devoluciones', id));
      if (!saleSnap.exists) fail('Venta no encontrada.', 404);
      if (returned.exists) return { id, ...returned.data() };
      const sale = saleSnap.data();
      if (!sale.folio || !sale.articulos?.every(a => a.cantidad_base > 0)) fail('Esta venta antigua no tiene el detalle necesario para devolverla automáticamente. Registra un ajuste documentado.');
      const u = await t.get(ref('usuarios', user.id_usuario));
      if (!u.data().turno_activo) fail('Abre tu turno de caja para registrar el reembolso.', 409);
      const shiftRef = ref('turnos', u.data().turno_activo);
      const shiftSnap = await t.get(shiftRef);
      if (!shiftSnap.exists || shiftSnap.data().estado !== 'abierto') fail('El turno está cerrado.', 409);
      const quantities = new Map(), returnedCosts = new Map();
      for (const a of sale.articulos) {
        quantities.set(a.id_producto, (quantities.get(a.id_producto) || 0) + quantity(a.cantidad_base));
        const previousCost = returnedCosts.get(a.id_producto);
        returnedCosts.set(a.id_producto, a.costo_total == null || previousCost === null ? null : (previousCost || 0) + money(a.costo_total));
      }
      const products = new Map();
      for (const productId of quantities.keys()) {
        const p = await t.get(ref('productos', productId));
        if (!p.exists) fail('Un producto de la venta ya no existe.');
        products.set(productId, p.data());
      }
      const shift = shiftSnap.data();
      const total = money(sale.total);
      if (sale.metodo_pago === 'Efectivo' && shift.fondo_centavos + shift.efectivo_centavos < total) fail('No hay suficiente efectivo registrado en este turno para el reembolso.', 409);
      const now = new Date();
      for (const [productId, q] of quantities) {
        const p = products.get(productId);
        const next = (quantity(p.stock) + q) / 1000;
        const currentQ = quantity(p.stock), returnedCost = returnedCosts.get(productId);
        const costKnown = returnedCost !== null && (!currentQ || p.costo != null);
        const averageCost = costKnown ? Math.round(((currentQ ? money(p.costo) * currentQ : 0) + returnedCost * 1000) / (currentQ + q)) / 100 : null;
        if (quantity(next) > 1e10) fail('La devolución supera el límite de existencias.');
        t.update(ref('productos', productId), { stock: next, costo: averageCost, actualizado_en: now });
        movement(t, `devolucion_${id}_${productId}`, { id_producto: productId, producto: p.nombre, unidad_medida: p.unidad_medida, tipo: 'devolucion', cantidad: q / 1000, stock_anterior: p.stock, stock_nuevo: next, motivo: reason, referencia: id }, user, now);
      }
      const refund = { id_venta: id, folio: sale.folio, ...actor(user), id_turno: shiftRef.id, fecha_hora: now, motivo: reason, metodo_pago: sale.metodo_pago, total: sale.total, costo_total: sale.costo_total ?? null, utilidad: sale.utilidad ?? null, articulos: sale.articulos };
      const field = sale.metodo_pago === 'Efectivo' ? 'efectivo_centavos' : 'tarjeta_centavos';
      t.update(shiftRef, { [field]: shift[field] - total, devoluciones: shift.devoluciones + 1 });
      t.update(saleRef, { estado: 'devuelta', fecha_devolucion: now });
      t.set(ref('devoluciones', id), refund);
      return { id, ...refund };
    });
  }
  async function adjust(body, key, user) {
    const id = operationKey(key), productId = docId(body.id_producto);
    const reason = text(body.motivo, 'Motivo', 300);
    if (!['ajuste', 'merma'].includes(body.tipo)) fail('Selecciona ajuste o merma.');
    const q = quantity(body.cantidad, 'Cantidad', true);
    if (!q || (body.tipo === 'merma' && q >= 0)) fail('El ajuste debe ser distinto de cero y la merma debe ser negativa.');
    const fingerprint = hash(JSON.stringify([productId, reason, body.tipo, q]));
    return db.runTransaction(async t => {
      const op = ref('movimientos', `ajuste_${id}`);
      const old = await t.get(op);
      if (old.exists) { if (old.data().huella !== fingerprint) fail('Clave de operación utilizada.', 409); return { id: op.id, ...old.data() }; }
      const p = await t.get(ref('productos', productId));
      if (!p.exists) fail('Producto no encontrado.', 404);
      const current = p.data();
      const next = (quantity(current.stock) + q) / 1000;
      if (next < 0) fail('El movimiento dejaría existencias negativas.', 409);
      quantity(next, 'Existencia resultante');
      const data = { id_producto: productId, producto: current.nombre, unidad_medida: current.unidad_medida, tipo: body.tipo, cantidad: q / 1000, stock_anterior: current.stock, stock_nuevo: next, motivo: reason, huella: fingerprint };
      const now = new Date();
      t.update(ref('productos', productId), { stock: next, actualizado_en: now });
      movement(t, op.id, data, user, now);
      return { id: op.id, ...data };
    });
  }
  async function buy(body, key, user) {
    const id = operationKey(key), productId = docId(body.id_producto), supplierId = docId(body.id_proveedor);
    const q = quantity(body.cantidad, 'Cantidad comprada');
    const cost = money(body.costo_unitario, 'Costo por unidad base');
    if (!q) fail('La cantidad comprada debe ser mayor que cero.');
    const purchaseTotal = Math.round(cost * q / 1000);
    if (!Number.isSafeInteger(purchaseTotal) || purchaseTotal > 1e9) fail('El importe de la compra no debe superar $10,000,000.');
    const invoice = text(body.referencia, 'Factura o referencia', 100);
    const fingerprint = hash(JSON.stringify([productId, supplierId, q, cost, invoice]));
    return db.runTransaction(async t => {
      const purchaseRef = ref('compras', id);
      const old = await t.get(purchaseRef);
      if (old.exists) { if (old.data().huella !== fingerprint) fail('Clave de compra utilizada.', 409); return { id, ...old.data() }; }
      const p = await t.get(ref('productos', productId));
      const s = await t.get(ref('proveedores', supplierId));
      if (!p.exists || !s.exists) fail('Producto o proveedor no encontrado.', 404);
      const product = p.data();
      const previousQ = quantity(product.stock);
      if (previousQ && product.costo == null) fail('Define primero el costo base del inventario existente para calcular el costo promedio.');
      const nextQ = previousQ + q;
      if (nextQ > 1e10) fail('La compra supera el límite de existencias.');
      const average = Math.round(((product.costo == null ? 0 : money(product.costo)) * previousQ + cost * q) / nextQ);
      const now = new Date();
      const purchase = { id_producto: productId, producto: product.nombre, unidad_medida: product.unidad_medida, id_proveedor: supplierId, proveedor: s.data().nombre, cantidad: q / 1000, costo_unitario: cost / 100, total: purchaseTotal / 100, referencia: invoice, huella: fingerprint, ...actor(user), fecha_hora: now };
      t.update(ref('productos', productId), { stock: nextQ / 1000, costo: average / 100, actualizado_en: now });
      t.set(purchaseRef, purchase);
      movement(t, `compra_${id}`, { id_producto: productId, producto: product.nombre, unidad_medida: product.unidad_medida, tipo: 'compra', cantidad: q / 1000, stock_anterior: product.stock, stock_nuevo: nextQ / 1000, referencia: id, motivo: `${s.data().nombre}: ${invoice}` }, user, now);
      return { id, ...purchase };
    });
  }
  async function history(collection, field = 'fecha_hora', limit = 200) {
    return docs(await db.collection(collection).orderBy(field, 'desc').limit(limit).get());
  }
  async function userSales(user) {
    return docs(await db.collection('ventas').where('id_usuario', '==', user.id_usuario).get())
      .sort((a, b) => millis(b.fecha_hora) - millis(a.fecha_hora)).slice(0, 200);
  }
  async function movements(productId) {
    if (!productId) return history('movimientos');
    docId(productId);
    return docs(await db.collection('movimientos').where('id_producto', '==', productId).get()).sort((a, b) => millis(b.fecha_hora) - millis(a.fecha_hora)).slice(0, 200);
  }
  async function report(start, end) {
    const range = dateRange(start, end);
    const load = async collection => {
      const snap = await db.collection(collection).where('fecha_hora', '>=', range.start).where('fecha_hora', '<', range.end).limit(5001).get();
      if (snap.size > 5000) fail('El periodo contiene demasiados movimientos. Selecciona un intervalo menor.');
      return docs(snap);
    };
    const [sales, returns] = await Promise.all([load('ventas'), load('devoluciones')]);
    let gross = 0, refunds = 0, cost = 0, unknown = 0, cash = 0, card = 0;
    const ranking = new Map();
    for (const [rows, sign] of [[sales, 1], [returns, -1]]) {
      for (const s of rows) {
        const total = money(s.total);
        if (sign === 1) gross += total; else refunds += total;
        if (s.costo_total == null) unknown++; else cost += sign * money(s.costo_total);
        if (s.metodo_pago === 'Efectivo') cash += sign * total; else card += sign * total;
        for (const a of s.articulos || []) {
          if (!a.nombre || a.subtotal == null) continue;
          const item = ranking.get(a.id_producto) || { nombre: a.nombre, unidad_medida: a.unidad_base, cantidad: 0, importe: 0 };
          item.cantidad += sign * quantity(a.cantidad_base) / 1000;
          item.importe += sign * money(a.subtotal);
          ranking.set(a.id_producto, item);
        }
      }
    }
    return { inicio: start, fin: end, ventas_brutas: gross / 100, devoluciones: refunds / 100, ventas_netas: (gross - refunds) / 100, efectivo: cash / 100, tarjeta: card / 100,
      costo: unknown ? null : cost / 100, utilidad: unknown ? null : (gross - refunds - cost) / 100, operaciones_sin_costo: unknown, tickets: sales.length,
      mas_vendidos: [...ranking.values()].map(p => ({ ...p, cantidad: Math.round(p.cantidad * 1000) / 1000, importe: p.importe / 100 })).sort((a, b) => b.importe - a.importe).slice(0, 10),
      ventas: sales.sort((a, b) => millis(b.fecha_hora) - millis(a.fecha_hora)), reembolsos: returns.sort((a, b) => millis(b.fecha_hora) - millis(a.fecha_hora)) };
  }
  return { ref, read, docs, listProducts, saveProduct, activeShift, openShift, closeShift, sell, returnSale, adjust, buy, history, userSales, movements, report };
}
module.exports = { createInventory };
