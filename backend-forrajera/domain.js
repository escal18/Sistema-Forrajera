const { createHash } = require('node:crypto');

class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new AppError(message, status); };
function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}: escribe entre 1 y ${max} caracteres.`);
  return value.trim();
}
function number(value, label, { min = 0, max = 1e9, scale = 100 } = {}) {
  if (value === '' || value === null || typeof value === 'boolean' || !['number', 'string'].includes(typeof value)) fail(`${label}: valor inválido.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || Math.abs(n * scale - Math.round(n * scale)) > 0.00001) fail(`${label}: usa un valor entre ${min} y ${max}, con hasta ${Math.log10(scale)} decimales.`);
  return Math.round(n * scale);
}
const money = (v, label = 'Importe') => number(v, label, { max: 10000000 });
const quantity = (v, label = 'Cantidad', signed = false) => number(v, label, { min: signed ? -10000000 : 0, max: 10000000, scale: 1000 });
const hash = value => createHash('sha256').update(value).digest('hex');
function operationKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) fail('Falta una clave de operación válida.');
  return value;
}
function docId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('Identificador inválido.');
  return value;
}
function username(value) {
  const result = text(value, 'Usuario', 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(result)) fail('El usuario debe tener de 3 a 40 letras, números, puntos o guiones.');
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail('La contraseña debe tener de 10 a 128 caracteres.');
  return value;
}
function safeUser(user) {
  return { id_usuario: user.id_usuario, usuario: user.usuario, nombre: user.nombre, rol: user.rol, activo: user.activo, turno_activo: user.turno_activo || null };
}
function productInput(body) {
  const base = text(body.unidad_medida, 'Unidad base', 30);
  const precio = money(body.precio, 'Precio base') / 100;
  const list = body.presentaciones ?? [];
  if (!Array.isArray(list) || list.length > 12) fail('Puedes registrar hasta 12 presentaciones.');
  const names = new Set([base.toLowerCase()]);
  const presentaciones = list.map(p => {
    const nombre = text(p.nombre, 'Presentación', 40);
    if (names.has(nombre.toLowerCase())) fail('Las presentaciones no deben tener nombres repetidos ni iguales a la unidad base.');
    names.add(nombre.toLowerCase());
    const factor = quantity(p.factor, 'Equivalencia');
    if (!factor) fail('La equivalencia debe ser mayor que cero.');
    return { nombre, factor: factor / 1000, precio: money(p.precio, 'Precio de presentación') / 100 };
  });
  return {
    codigo_interno: text(body.codigo_interno, 'Clave', 40).toUpperCase(),
    nombre: text(body.nombre, 'Nombre', 120), unidad_medida: base, precio,
    costo: body.costo === '' || body.costo == null ? null : money(body.costo, 'Costo base') / 100,
    stock_minimo: quantity(body.stock_minimo ?? 0, 'Stock mínimo') / 1000,
    favorito: body.favorito === true, presentaciones
  };
}
function presentation(product, name) {
  if (!name || name === product.unidad_medida) return { nombre: product.unidad_medida, factor: 1, precio: product.precio };
  const found = (product.presentaciones || []).find(p => p.nombre === name);
  if (!found) fail(`La presentación de ${product.nombre} ya no está disponible. Actualiza el catálogo.`);
  return found;
}
function saleInput(body) {
  if (!['Efectivo', 'Tarjeta'].includes(body.metodo_pago)) fail('Selecciona efectivo o tarjeta.');
  if (!Array.isArray(body.articulos) || !body.articulos.length || body.articulos.length > 100) fail('La venta debe contener entre 1 y 100 renglones.');
  const rows = new Map();
  for (const raw of body.articulos) {
    const id = docId(raw.id_producto);
    const name = raw.presentacion ? text(raw.presentacion, 'Presentación', 40) : '';
    const q = quantity(raw.cantidad);
    if (!q) fail('Todas las cantidades deben ser mayores que cero.');
    const key = JSON.stringify([id, name]);
    const current = rows.get(key) || { id_producto: id, presentacion: name, cantidad_mil: 0 };
    current.cantidad_mil += q;
    if (current.cantidad_mil > 1e10) fail('Cantidad fuera de rango.');
    rows.set(key, current);
  }
  return {
    metodo_pago: body.metodo_pago,
    total_esperado_centavos: money(body.total_esperado, 'Total mostrado'),
    pago_con_centavos: body.metodo_pago === 'Efectivo' ? money(body.pago_con, 'Pago recibido') : null,
    articulos: [...rows.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  };
}
function calculateSale(input, products) {
  let total = 0, costo = 0, costoCompleto = true;
  const stock = new Map();
  const articulos = input.articulos.map(row => {
    const p = products.get(row.id_producto);
    if (!p) fail('Uno de los productos ya no existe.');
    const unit = presentation(p, row.presentacion);
    const factor = quantity(unit.factor, 'Equivalencia');
    const base = row.cantidad_mil * factor / 1000;
    if (!Number.isSafeInteger(base)) fail(`La cantidad de ${p.nombre} no se puede representar con 3 decimales en ${p.unidad_medida}.`);
    const subtotal = Math.round(money(unit.precio, 'Precio') * row.cantidad_mil / 1000);
    const cost = p.costo == null ? null : Math.round(money(p.costo, 'Costo') * base / 1000);
    total += subtotal;
    if (cost === null) costoCompleto = false; else costo += cost;
    stock.set(row.id_producto, (stock.get(row.id_producto) || 0) + base);
    return { id_producto: row.id_producto, codigo_interno: p.codigo_interno, nombre: p.nombre, unidad_base: p.unidad_medida,
      presentacion: unit.nombre, factor: unit.factor, cantidad: row.cantidad_mil / 1000, cantidad_base: base / 1000,
      precio: unit.precio, subtotal: subtotal / 100, costo_total: cost === null ? null : cost / 100 };
  });
  if (total <= 0 || total > 1e9 || !Number.isSafeInteger(total)) fail('El total debe ser mayor que cero y no superar $10,000,000.');
  if (total !== input.total_esperado_centavos) fail('Los precios cambiaron. Actualiza el catálogo y revisa el total antes de cobrar.', 409);
  for (const [id, used] of stock) {
    const p = products.get(id);
    if (used > quantity(p.stock, 'Existencia')) fail(`Existencias insuficientes de ${p.nombre}: quedan ${p.stock} ${p.unidad_medida}.`, 409);
  }
  if (input.metodo_pago === 'Efectivo' && input.pago_con_centavos < total) fail('El efectivo recibido no cubre el total.');
  return { articulos, stock, total_centavos: total, costo_centavos: costoCompleto ? costo : null,
    utilidad_centavos: costoCompleto ? total - costo : null,
    cambio_centavos: input.metodo_pago === 'Efectivo' ? input.pago_con_centavos - total : 0 };
}
function dateRange(inicio, fin) {
  for (const value of [inicio, fin]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Selecciona fechas válidas.');
  }
  // El negocio usa UTC-6. Evitar el huso horario de la máquina del servidor.
  const start = new Date(`${inicio}T00:00:00-06:00`);
  const end = new Date(new Date(`${fin}T00:00:00-06:00`).getTime() + 86400000);
  if (start >= end || end - start > 366 * 86400000) fail('El periodo debe estar ordenado y no superar 366 días.');
  return { start, end };
}
module.exports = { AppError, fail, text, number, money, quantity, hash, operationKey, docId, username, password, safeUser, productInput, saleInput, calculateSale, dateRange };
