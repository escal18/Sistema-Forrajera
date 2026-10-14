const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { MemoryDB } = require('./memory-db');
const { createInventory } = require('../inventory');
const { createApp } = require('../app');
const { saleInput, calculateSale, dateRange, productInput } = require('../domain');

test('cantidades, presentaciones y cálculos usan el catálogo del servidor', () => {
  const products = new Map([['maiz', { nombre: 'Maíz', codigo_interno: 'MA', unidad_medida: 'kg', precio: 20, costo: 10, stock: 100, presentaciones: [{ nombre: 'Costal 40 kg', factor: 40, precio: 750 }] }]]);
  const input = saleInput({ metodo_pago: 'Efectivo', pago_con: 800, total_esperado: 790, articulos: [{ id_producto: 'maiz', cantidad: 1, presentacion: 'kg' }, { id_producto: 'maiz', cantidad: 1, presentacion: 'kg' }, { id_producto: 'maiz', cantidad: 1, presentacion: 'Costal 40 kg' }] });
  const result = calculateSale(input, products);
  assert.equal(input.articulos.length, 2);
  assert.equal(result.total_centavos, 79000); assert.equal(result.cambio_centavos, 1000);
  assert.equal(result.stock.get('maiz'), 42000); assert.equal(result.costo_centavos, 42000);
  assert.throws(() => saleInput({ metodo_pago: 'Efectivo', pago_con: 0, total_esperado: 0, articulos: [{ id_producto: 'maiz', cantidad: -1 }] }), /Cantidad/);
  assert.throws(() => calculateSale({ ...input, total_esperado_centavos: 1 }, products), /precios cambiaron/);
  assert.throws(() => calculateSale({ ...input, pago_con_centavos: 0 }, products), /no cubre/);
  const unknown = new Map([['maiz', { ...products.get('maiz'), costo: null }]]);
  assert.equal(calculateSale(input, unknown).utilidad_centavos, null);
});

test('valida presentaciones duplicadas y rangos de fechas reales en UTC-6', () => {
  assert.throws(() => productInput({ codigo_interno: 'P', nombre: 'Paca', unidad_medida: 'pieza', precio: 100, presentaciones: [{ nombre: 'pieza', factor: 1, precio: 100 }] }), /repetidos/);
  assert.throws(() => dateRange('2026-02-30', '2026-03-01'), /válidas/);
  assert.throws(() => dateRange('2026-10-02', '2026-10-01'), /ordenado/);
  assert.equal(dateRange('2026-10-14', '2026-10-14').start.toISOString(), '2026-10-14T06:00:00.000Z');
});

test('un reintento de transacción no duplica total, ticket ni movimiento', async () => {
  const db = new MemoryDB(), inv = createInventory(db);
  const actor = { id_usuario: 'ana', usuario: 'ana', nombre: 'Ana', rol: 'cajero' };
  await inv.ref('usuarios', 'ana').set({ turno_activo: null });
  await inv.ref('productos', 'maiz').set({ codigo_interno: 'MA', nombre: 'Maíz', unidad_medida: 'kg', stock: 10, precio: 10, costo: 5 });
  await inv.openShift({ nombre: 'Mañana', fondo_inicial: 100 }, randomUUID(), actor);
  db.retryNext = true;
  const key = randomUUID(), body = { metodo_pago: 'Efectivo', pago_con: 20, total_esperado: 20, articulos: [{ id_producto: 'maiz', cantidad: 2 }] };
  const sale = await inv.sell(body, key, actor);
  assert.equal(sale.total, 20);
  assert.deepEqual(await inv.sell(body, key, actor), sale);
  assert.equal((await inv.read('productos', 'maiz')).stock, 8);
  assert.equal((await inv.activeShift(actor)).tickets_emitidos, 1);
  assert.equal((await inv.history('movimientos')).length, 1);
  await assert.rejects(inv.sell({ ...body, pago_con: 30 }, key, actor), /otra operación/);
});

test('concurrencia, stock insuficiente y doble cierre no alteran el inventario', async () => {
  const db = new MemoryDB(), inv = createInventory(db), actor = { id_usuario: 'ana', usuario: 'ana', nombre: 'Ana' };
  await inv.ref('usuarios', 'ana').set({ turno_activo: null });
  await inv.ref('productos', 'paca').set({ codigo_interno: 'PA', nombre: 'Paca', unidad_medida: 'pieza', stock: 1, precio: 100, costo: 50 });
  const shift = await inv.openShift({ nombre: 'Mañana', fondo_inicial: 20 }, randomUUID(), actor);
  const body = { metodo_pago: 'Tarjeta', total_esperado: 100, articulos: [{ id_producto: 'paca', cantidad: 1 }] };
  const results = await Promise.allSettled([inv.sell(body, randomUUID(), actor), inv.sell(body, randomUUID(), actor)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await inv.read('productos', 'paca')).stock, 0);
  assert.equal((await inv.activeShift(actor)).tarjeta_centavos, 10000);
  const closed = await inv.closeShift(shift.id, { efectivo_contado: 20 }, actor);
  assert.equal(closed.diferencia_centavos, 0);
  assert.deepEqual(await inv.closeShift(shift.id, { efectivo_contado: 20 }, actor), closed);
  await assert.rejects(inv.closeShift(shift.id, { efectivo_contado: 21 }, actor), /otro conteo/);
  await assert.rejects(inv.sell(body, randomUUID(), actor), /Abre un turno/);
});

test('devolver repone el costo histórico y las compras no inventan costos faltantes', async () => {
  const db = new MemoryDB(), inv = createInventory(db), actor = { id_usuario: 'admin', usuario: 'admin', nombre: 'Admin' };
  await inv.ref('usuarios', 'admin').set({ turno_activo: null });
  await inv.ref('productos', 'maiz').set({ codigo_interno: 'MA', nombre: 'Maíz', unidad_medida: 'kg', stock: 10, precio: 30, costo: 10 });
  await inv.ref('proveedores', 'prov').set({ nombre: 'Proveedor' });
  await inv.openShift({ nombre: 'Prueba', fondo_inicial: 1000 }, randomUUID(), actor);
  const key = randomUUID();
  await inv.sell({ metodo_pago: 'Efectivo', pago_con: 30, total_esperado: 30, articulos: [{ id_producto: 'maiz', cantidad: 1 }] }, key, actor);
  await inv.buy({ id_producto: 'maiz', id_proveedor: 'prov', cantidad: 1, costo_unitario: 20, referencia: 'F-1' }, randomUUID(), actor);
  assert.equal((await inv.read('productos', 'maiz')).costo, 11);
  await inv.returnSale(key, { motivo: 'Mercancía recibida' }, actor);
  assert.equal((await inv.read('productos', 'maiz')).stock, 11);
  assert.equal((await inv.read('productos', 'maiz')).costo, 10.91);
  await inv.ref('productos', 'sin-costo').set({ codigo_interno: 'SC', nombre: 'Sin costo', unidad_medida: 'kg', stock: 10, precio: 30, costo: null });
  await assert.rejects(inv.buy({ id_producto: 'sin-costo', id_proveedor: 'prov', cantidad: 1, costo_unitario: 20, referencia: 'F-2' }, randomUUID(), actor), /Define primero el costo/);
  await assert.rejects(inv.buy({ id_producto: 'maiz', id_proveedor: 'prov', cantidad: 1000, costo_unitario: 100000, referencia: 'F-3' }, randomUUID(), actor), /no debe superar/);
});

test('API completa: permisos, compras, ventas, devoluciones, reportes y sesiones', async t => {
  const db = new MemoryDB(), app = createApp({ db, log: { error: (...args) => { throw new Error(args.join(' ')); } } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(url, { method = 'GET', body, cookie, key, status = 200, origin } = {}) {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    assert.equal(res.status, status, `${method} ${url}: ${JSON.stringify(data)}`);
    return { data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  const adminBody = { usuario: 'admin', nombre: 'Administrador', password: 'una-clave-larga' };
  assert.equal((await request('/auth/estado')).data.requiere_configuracion, true);
  await request('/productos', { status: 401 });
  await request('/auth/configurar', { method: 'POST', body: adminBody, origin: 'https://malicioso.example', status: 403 });
  await request('/auth/configurar', { method: 'POST', body: adminBody, status: 201 });
  await request('/auth/configurar', { method: 'POST', body: adminBody, status: 409 });
  const admin = (await request('/auth/login', { method: 'POST', body: adminBody })).cookie;
  await request('/auth/login', { method: 'POST', body: { usuario: 'nadie', password: 'incorrecta' }, status: 401 });
  await request('/usuarios', { method: 'POST', cookie: admin, body: { usuario: 'cajero', nombre: 'Ana', password: 'otra-clave-larga', rol: 'cajero' }, status: 201 });
  const cashier = (await request('/auth/login', { method: 'POST', body: { usuario: 'cajero', password: 'otra-clave-larga' } })).cookie;
  const product = { codigo_interno: 'MA', nombre: 'Maíz', unidad_medida: 'kg', precio: 20, costo: 10, stock: 100, stock_minimo: 5, presentaciones: [{ nombre: 'Costal 40 kg', factor: 40, precio: 750 }], favorito: true };
  await request('/productos', { method: 'POST', cookie: cashier, body: product, status: 403 });
  const p = (await request('/productos', { method: 'POST', cookie: admin, body: product, status: 201 })).data;
  await request('/productos', { method: 'POST', cookie: admin, body: product, status: 409 });
  const visible = (await request('/productos', { cookie: cashier })).data[0]; assert.equal(visible.costo, undefined);
  await request(`/productos/${p.id_producto}`, { method: 'PUT', cookie: admin, body: { ...product, stock: 1000 }, status: 400 });
  await request(`/productos/${p.id_producto}`, { method: 'PUT', cookie: admin, body: { ...product, unidad_medida: 'pieza' }, status: 400 });
  const shift = (await request('/turnos', { method: 'POST', cookie: cashier, key: randomUUID(), body: { fondo_inicial: 100, nombre: 'Ana mañana' }, status: 201 })).data;
  const saleKey = randomUUID(), saleBody = { metodo_pago: 'Efectivo', total_esperado: 40, pago_con: 50, articulos: [{ id_producto: p.id_producto, cantidad: 2, precio: 0 }] };
  const sale = (await request('/ventas', { method: 'POST', cookie: cashier, key: saleKey, body: saleBody, status: 201 })).data;
  assert.equal(sale.total, 40); assert.equal(sale.cambio, 10); assert.ok(sale.folio); assert.equal(sale.costo_total, undefined); assert.equal(sale.articulos[0].costo_total, undefined);
  await request('/ventas', { method: 'POST', cookie: cashier, key: saleKey, body: saleBody, status: 201 });
  assert.equal((await request('/productos', { cookie: admin })).data[0].stock, 98);
  await request('/ventas', { method: 'POST', cookie: cashier, key: randomUUID(), body: { ...saleBody, articulos: [{ id_producto: p.id_producto, cantidad: 60 }, { id_producto: p.id_producto, cantidad: 60 }], pago_con: 3000, total_esperado: 2400 }, status: 409 });
  await request('/reportes?inicio=2026-01-01&fin=2026-01-02', { cookie: cashier, status: 403 });
  const adminShift = (await request('/turnos', { method: 'POST', cookie: admin, key: randomUUID(), body: { fondo_inicial: 100, nombre: 'Reembolsos' }, status: 201 })).data;
  await request(`/ventas/${saleKey}/devolver`, { method: 'POST', cookie: admin, body: { motivo: 'Devolución de mercancía recibida' } });
  await request(`/ventas/${saleKey}/devolver`, { method: 'POST', cookie: admin, body: { motivo: 'Devolución de mercancía recibida' } });
  assert.equal((await request('/productos', { cookie: admin })).data[0].stock, 100);
  const date = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  const report = (await request(`/reportes?inicio=${date}&fin=${date}`, { cookie: admin })).data;
  assert.equal(report.ventas_netas, 0); assert.equal(report.utilidad, 0); assert.equal(report.ventas.length, 1); assert.equal(report.reembolsos.length, 1);
  const supplier = (await request('/proveedores', { method: 'POST', cookie: admin, body: { nombre: 'Proveedor local', contacto: 'Contacto' }, status: 201 })).data;
  const purchaseKey = randomUUID(), purchase = { id_producto: p.id_producto, id_proveedor: supplier.id, cantidad: 20, costo_unitario: 20, referencia: 'FAC-1' };
  await request('/compras', { method: 'POST', cookie: admin, key: purchaseKey, body: purchase, status: 201 });
  await request('/compras', { method: 'POST', cookie: admin, key: purchaseKey, body: purchase, status: 201 });
  const updated = (await request('/productos', { cookie: admin })).data[0]; assert.equal(updated.stock, 120); assert.equal(updated.costo, 11.67);
  const adjustmentKey = randomUUID(), adjustment = { id_producto: p.id_producto, tipo: 'merma', cantidad: -1, motivo: 'Producto dañado' };
  await request('/movimientos', { method: 'POST', cookie: admin, key: adjustmentKey, body: adjustment, status: 201 });
  await request('/movimientos', { method: 'POST', cookie: admin, key: adjustmentKey, body: adjustment, status: 201 });
  assert.equal((await request('/productos', { cookie: admin })).data[0].stock, 119);
  await request('/movimientos', { method: 'POST', cookie: admin, key: randomUUID(), body: { ...adjustment, cantidad: 1 }, status: 400 });
  await request(`/usuarios/cajero`, { method: 'PUT', cookie: admin, body: { nombre: 'Ana', rol: 'cajero', activo: false }, status: 400 });
  const closed = (await request(`/turnos/${shift.id}/cerrar`, { method: 'POST', cookie: cashier, body: { efectivo_contado: 140 } })).data;
  assert.equal(closed.diferencia_centavos, 0);
  const adminClosed = (await request(`/turnos/${adminShift.id}/cerrar`, { method: 'POST', cookie: admin, body: { efectivo_contado: 59 } })).data;
  assert.equal(adminClosed.diferencia_centavos, -100);
  await request('/usuarios/admin', { method: 'PUT', cookie: admin, body: { nombre: 'Administrador', rol: 'cajero', activo: true }, status: 400 });
  await request('/usuarios/cajero', { method: 'PUT', cookie: admin, body: { nombre: 'Ana', rol: 'cajero', activo: true, password: 'nueva-clave-larga' } });
  await request('/auth/me', { cookie: cashier, status: 401 });
  await request('/auth/logout', { method: 'POST', cookie: admin, body: {} });
  await request('/auth/me', { cookie: admin, status: 401 });
});
