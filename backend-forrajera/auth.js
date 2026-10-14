const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { fail, text, username, password, safeUser, hash } = require('./domain');
const scrypt = promisify(scryptCallback);
const SESSION_MS = 8 * 60 * 60 * 1000;
async function hashPassword(value) {
  password(value);
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(value, salt, 64);
  return `${salt}:${digest.toString('hex')}`;
}
async function verifyPassword(value, stored) {
  if (typeof value !== 'string' || value.length > 128 || typeof stored !== 'string') return false;
  const [salt, digest] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/.test(digest || '')) return false;
  return timingSafeEqual(await scrypt(value, salt, 64), Buffer.from(digest, 'hex'));
}
function createAuth(db) {
  const ref = (c, id) => db.collection(c).doc(id);
  const publicUser = snap => safeUser({ ...snap.data(), id_usuario: snap.id });
  async function needsSetup() { return !(await ref('configuracion', 'seguridad').get()).exists; }
  async function setup(body) {
    const name = username(body.usuario), display = text(body.nombre, 'Nombre', 80);
    const digest = await hashPassword(body.password);
    return db.runTransaction(async t => {
      const config = await t.get(ref('configuracion', 'seguridad'));
      const existing = await t.get(ref('usuarios', name));
      if (config.exists || existing.exists) fail('El administrador inicial ya fue registrado.', 409);
      const data = { usuario: name, nombre: display, rol: 'administrador', activo: true, password_hash: digest, version: 1, turno_activo: null, creado_en: new Date() };
      t.set(ref('usuarios', name), data);
      t.set(ref('configuracion', 'seguridad'), { administradores: 1, creado_en: new Date() });
      return safeUser({ ...data, id_usuario: name });
    });
  }
  async function login(body) {
    const name = username(body.usuario);
    const snap = await ref('usuarios', name).get();
    // Scrypt también se ejecuta para usuarios desconocidos.
    const dummy = '00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await verifyPassword(body.password, snap.exists ? snap.data().password_hash : dummy);
    if (!snap.exists || !valid || !snap.data().activo) fail('Usuario o contraseña incorrectos.', 401);
    const token = randomBytes(32).toString('hex');
    await ref('sesiones', hash(token)).set({ id_usuario: name, version: snap.data().version, expira_en: new Date(Date.now() + SESSION_MS) });
    return { token, usuario: publicUser(snap) };
  }
  async function authenticate(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) fail('Inicia sesión para continuar.', 401);
    const session = await ref('sesiones', hash(token)).get();
    const data = session.exists ? session.data() : null;
    const expiration = data?.expira_en?.toDate ? data.expira_en.toDate() : new Date(data?.expira_en);
    if (!data || expiration.getTime() <= Date.now() || !Number.isFinite(expiration.getTime())) fail('La sesión expiró. Vuelve a entrar.', 401);
    const user = await ref('usuarios', data.id_usuario).get();
    if (!user.exists || !user.data().activo || user.data().version !== data.version) fail('La sesión ya no es válida.', 401);
    return publicUser(user);
  }
  async function logout(token) { if (token && /^[a-f0-9]{64}$/.test(token)) await ref('sesiones', hash(token)).delete(); }
  async function users() { return (await db.collection('usuarios').get()).docs.map(publicUser); }
  async function saveUser(body, id, actor) {
    const name = username(id || body.usuario);
    const display = text(body.nombre, 'Nombre', 80);
    if (!['administrador', 'cajero'].includes(body.rol)) fail('Rol inválido.');
    const active = body.activo !== false;
    const digest = body.password ? await hashPassword(body.password) : null;
    if (!id && !digest) fail('Escribe una contraseña para el usuario.');
    return db.runTransaction(async t => {
      const userRef = ref('usuarios', name);
      const snap = await t.get(userRef);
      const settingsRef = ref('configuracion', 'seguridad');
      const settings = await t.get(settingsRef);
      if (id && !snap.exists) fail('Usuario no encontrado.', 404);
      if (!id && snap.exists) fail('El nombre de usuario ya existe.', 409);
      const old = snap.exists ? snap.data() : null;
      if (!active && old?.turno_activo) fail('El usuario debe cerrar su turno antes de ser desactivado.');
      const before = old?.activo && old.rol === 'administrador' ? 1 : 0;
      const after = active && body.rol === 'administrador' ? 1 : 0;
      const count = settings.data().administradores + after - before;
      if (count < 1) fail('Debe quedar al menos un administrador activo.');
      const data = { ...old, usuario: name, nombre: display, rol: body.rol, activo: active, password_hash: digest || old.password_hash,
        version: (old?.version || 0) + 1, turno_activo: old?.turno_activo || null, actualizado_en: new Date() };
      t.set(userRef, data);
      t.update(settingsRef, { administradores: count });
      t.set(ref('auditoria', `usuario_${randomBytes(16).toString('hex')}`), { tipo: id ? 'edicion_usuario' : 'alta_usuario', usuario_afectado: name, rol: body.rol, activo: active, id_usuario: actor.id_usuario, fecha_hora: new Date() });
      return safeUser({ ...data, id_usuario: name });
    });
  }
  async function changePassword(body, user) {
    const userRef = ref('usuarios', user.id_usuario);
    const snap = await userRef.get();
    if (!await verifyPassword(body.actual, snap.data().password_hash)) fail('La contraseña actual es incorrecta.');
    const digest = await hashPassword(body.nueva);
    await db.runTransaction(async t => {
      const current = await t.get(userRef);
      if (current.data().version !== snap.data().version) fail('El usuario cambió durante la operación. Inténtalo de nuevo.', 409);
      t.update(userRef, { password_hash: digest, version: current.data().version + 1 });
    });
  }
  return { needsSetup, setup, login, authenticate, logout, users, saveUser, changePassword };
}
module.exports = { createAuth, hashPassword, verifyPassword, SESSION_MS };
