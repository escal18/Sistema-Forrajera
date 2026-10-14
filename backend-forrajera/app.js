const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AppError, fail, text, docId } = require('./domain');
const { createAuth, SESSION_MS } = require('./auth');
const { createInventory } = require('./inventory');

function wire(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  return value;
}
function createApp({ db, frontendPath = path.join(__dirname, '../frontend-caja'), log = console }) {
  const app = express(), auth = createAuth(db), inv = createInventory(db);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    const send = res.json.bind(res);
    res.json = data => send(wire(data));
    next();
  });
  const localHost = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    let allowed = !origin;
    if (origin) {
      try {
        const u = new URL(origin);
        allowed = origin === `${req.protocol}://${req.get('Host')}` ||
          (localHost(u.hostname) && ['http:', 'https:'].includes(u.protocol)) ||
          (process.env.APP_ORIGIN && origin === process.env.APP_ORIGIN);
      } catch { allowed = false; }
    }
    if (!allowed) return next(new AppError('Origen de la solicitud no permitido.', 403));
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); res.set('Access-Control-Allow-Credentials', 'true'); }
    res.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    // Las escrituras desde navegadores deben ser JSON: evita formularios CSRF.
    if (['POST', 'PUT'].includes(req.method) && !req.is('application/json')) return next(new AppError('Envía los datos en formato JSON.', 415));
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const cookieToken = req => (req.get('Cookie') || '').split(';').map(c => c.trim()).find(c => c.startsWith('forrajera_session='))?.slice('forrajera_session='.length);
  const setCookie = (req, res, token, clear = false) => res.cookie('forrajera_session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/api', maxAge: clear ? 0 : SESSION_MS });
  const attempts = new Map();
  const limitLogin = (req, res, next) => {
    const now = Date.now(), key = req.ip;
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const record = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (++record.count > 30) return next(new AppError('Demasiados intentos. Espera 15 minutos.', 429));
    attempts.set(key, record);
    next();
  };
  app.get('/api/salud', (req, res) => res.json({ estado: 'ok' }));
  app.get('/api/auth/estado', route(async (req, res) => res.json({ requiere_configuracion: await auth.needsSetup() })));
  app.post('/api/auth/configurar', limitLogin, route(async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !localHost(req.hostname)) fail('Crea el primer administrador desde localhost en el equipo del servidor.', 403);
    res.status(201).json(await auth.setup(req.body));
  }));
  app.post('/api/auth/login', limitLogin, route(async (req, res) => {
    const result = await auth.login(req.body);
    setCookie(req, res, result.token);
    res.json(result.usuario);
  }));
  app.use('/api', (req, res, next) => {
    auth.authenticate(cookieToken(req)).then(user => { req.user = user; next(); }).catch(next);
  });
  return configureAuthenticated(app, { auth, inv, route, cookieToken, setCookie, frontendPath, log });
}
function configureAuthenticated(app, ctx) {
  const { auth, inv, route, cookieToken, setCookie, frontendPath, log } = ctx;
  const admin = (req, res, next) => req.user.rol === 'administrador' ? next() : next(new AppError('Esta acción requiere un administrador.', 403));
  const key = req => req.get('Idempotency-Key');
  const productFor = (product, user) => {
    if (user.rol === 'administrador') return product;
    const { costo, ...publicProduct } = product;
    return publicProduct;
  };
  const saleFor = (sale, user) => {
    if (user.rol === 'administrador') return sale;
    const { costo_total, utilidad, huella, ...rest } = sale;
    return { ...rest, articulos: (rest.articulos || []).map(({ costo_total, ...row }) => row) };
  };
  app.get('/api/auth/me', (req, res) => res.json(req.user));
  app.post('/api/auth/logout', route(async (req, res) => { await auth.logout(cookieToken(req)); setCookie(req, res, '', true); res.json({ ok: true }); }));
  app.post('/api/auth/password', route(async (req, res) => { await auth.changePassword(req.body, req.user); setCookie(req, res, '', true); res.json({ ok: true }); }));
  app.get('/api/usuarios', admin, route(async (req, res) => res.json(await auth.users())));
  app.post('/api/usuarios', admin, route(async (req, res) => res.status(201).json(await auth.saveUser(req.body, null, req.user))));
  app.put('/api/usuarios/:id', admin, route(async (req, res) => res.json(await auth.saveUser(req.body, req.params.id, req.user))));
  app.get('/api/productos', route(async (req, res) => res.json((await inv.listProducts(req.query.buscar)).map(p => productFor(p, req.user)))));
  app.post('/api/productos', admin, route(async (req, res) => res.status(201).json(await inv.saveProduct(req.body, null, req.user))));
  app.put('/api/productos/:id', admin, route(async (req, res) => res.json(await inv.saveProduct(req.body, req.params.id, req.user))));
  app.get('/api/turnos/actual', route(async (req, res) => res.json(await inv.activeShift(req.user))));
  app.post('/api/turnos', route(async (req, res) => res.status(201).json(await inv.openShift(req.body, key(req), req.user))));
  app.post('/api/turnos/:id/cerrar', route(async (req, res) => res.json(await inv.closeShift(req.params.id, req.body, req.user))));
  app.get('/api/turnos', admin, route(async (req, res) => res.json(await inv.history('turnos', 'fecha_apertura'))));
  app.get('/api/mis-ventas', route(async (req, res) => res.json((await inv.userSales(req.user)).map(s => saleFor({ ...s, id_venta: s.id }, req.user)))));
  app.post('/api/ventas', route(async (req, res) => res.status(201).json(saleFor(await inv.sell(req.body, key(req), req.user), req.user))));
  app.get('/api/ventas/:id', route(async (req, res) => {
    const sale = await inv.read('ventas', docId(req.params.id));
    if (!sale) fail('Venta no encontrada.', 404);
    if (req.user.rol !== 'administrador' && sale.id_usuario !== req.user.id_usuario) fail('No tienes permiso para consultar esta venta.', 403);
    res.json(saleFor({ ...sale, id_venta: sale.id }, req.user));
  }));
  app.post('/api/ventas/:id/devolver', admin, route(async (req, res) => res.json(await inv.returnSale(req.params.id, req.body, req.user))));
  app.get('/api/movimientos', admin, route(async (req, res) => res.json(await inv.movements(req.query.id_producto))));
  app.post('/api/movimientos', admin, route(async (req, res) => res.status(201).json(await inv.adjust(req.body, key(req), req.user))));
  app.get('/api/proveedores', admin, route(async (req, res) => res.json(inv.docs(await inv.ref('proveedores', '_').parent.get()))));
  app.post('/api/proveedores', admin, route(async (req, res) => {
    const supplier = { nombre: text(req.body.nombre, 'Proveedor', 100), contacto: String(req.body.contacto || '').trim().slice(0, 200), creado_en: new Date(), id_usuario: req.user.id_usuario };
    const supplierRef = inv.ref('proveedores', randomUUID());
    await supplierRef.set(supplier);
    res.status(201).json({ id: supplierRef.id, ...supplier });
  }));
  app.get('/api/compras', admin, route(async (req, res) => res.json(await inv.history('compras'))));
  app.post('/api/compras', admin, route(async (req, res) => res.status(201).json(await inv.buy(req.body, key(req), req.user))));
  app.get('/api/reportes', admin, route(async (req, res) => res.json(await inv.report(req.query.inicio, req.query.fin))));
  app.get('/api/cortes/anteriores', admin, route(async (req, res) => res.json(await inv.history('cortes_caja', 'fecha_corte'))));
  app.use('/api', (req, res) => res.status(404).json({ error: 'La ruta solicitada no existe.' }));
  app.use(express.static(frontendPath, { etag: true, maxAge: 0 }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof AppError ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
    if (status === 500) log.error('Error de API:', error.message);
    res.status(status).json({ error: status === 500 ? 'No se pudo completar la operación. Revisa la conexión con Firebase y vuelve a intentar.' : status === 400 && !(error instanceof AppError) ? 'El JSON enviado no es válido.' : status === 413 ? 'La solicitud es demasiado grande.' : error.message });
  });
  return app;
}
module.exports = { createApp, wire };
