'use strict';
window.F = (() => {
  const liveServer = /^55\d\d$/.test(location.port) || location.protocol === 'file:';
  const base = liveServer ? `http://${location.hostname || 'localhost'}:3000/api` : `${location.origin}/api`;
  let user;
  const $ = id => document.getElementById(id);
  const money = value => value == null ? 'Sin costo registrado' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
  const qty = value => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(value);
  const date = value => value ? new Date(value).toLocaleString('es-MX', { timeZone: 'Etc/GMT+6', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const today = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uuid = () => crypto.randomUUID();
  function message(value, type = 'error') {
    const target = $('mensaje');
    if (!target) return;
    target.textContent = value;
    target.className = `mensaje ${type}`;
    target.hidden = !value;
    const inline = document.querySelector('dialog[open] [data-dialog-message]');
    if (inline) { inline.textContent = value; inline.hidden = !value; inline.className = `mensaje ${type}`; }
  }
  async function api(url, { method = 'GET', body, key } = {}) {
    let response;
    try {
      response = await fetch(base + url, {
        method, credentials: 'include', cache: 'no-store',
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000)
      });
    } catch {
      const error = new Error('No se pudo confirmar la operación. Comprueba que la API esté iniciada y que haya conexión. Si estabas cobrando, reintenta la misma operación pendiente.');
      error.status = 0;
      throw error;
    }
    let data;
    try { data = await response.json(); }
    catch {
      const error = new Error('El servidor devolvió una respuesta inválida. Conserva la operación pendiente y reinténtala cuando se recupere la conexión.');
      error.status = 0; throw error;
    }
    if (!response.ok) {
      const error = new Error(data.error || `Error ${response.status}`);
      error.status = response.status;
      if (response.status === 401 && !url.startsWith('/auth/')) location.href = 'login.html';
      throw error;
    }
    return data;
  }
  const pendingPrefix = () => `forrajera:${user.id_usuario}:pendiente:`;
  function pending() {
    const prefix = pendingPrefix(), result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(prefix)) { try { result.push({ storageKey: key, ...JSON.parse(localStorage.getItem(key)) }); } catch { /* Conservar una entrada dañada para revisión manual. */ } }
    }
    return result;
  }
  async function sendPending(record) {
    try {
      const result = await api(record.url, { method: record.method, body: record.body, key: record.key });
      localStorage.removeItem(record.storageKey);
      return result;
    } catch (error) {
      if ([400, 404, 409, 415, 422].includes(error.status)) localStorage.removeItem(record.storageKey);
      throw error;
    } finally { renderPending(); }
  }
  async function operation(name, url, body, label, method = 'POST') {
    if (pending().some(p => p.name === name)) throw new Error('Hay una operación pendiente de este tipo. Usa su botón Reintentar antes de registrar otra.');
    const record = { name, url, body, method, label, key: uuid(), created: new Date().toISOString(), storageKey: pendingPrefix() + name };
    // Guardar antes de enviar: una recarga no debe crear otro cobro.
    localStorage.setItem(record.storageKey, JSON.stringify(record));
    renderPending();
    return sendPending(record);
  }
  function renderPending() {
    const target = $('pendientes');
    if (!target || !user) return;
    target.replaceChildren();
    for (const record of pending()) {
      const row = document.createElement('div'); row.className = 'pendiente';
      const label = document.createElement('span'); label.textContent = `${record.label} · ${date(record.created)}. Falta confirmar el resultado.`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Reintentar la misma operación';
      button.onclick = async () => {
        button.disabled = true;
        try {
          const result = await sendPending(record);
          message('Operación confirmada. No se registró dos veces.', 'ok');
          document.dispatchEvent(new CustomEvent('operacion-confirmada', { detail: { record, result } }));
        } catch (error) { message(error.message); button.disabled = false; }
      };
      row.append(label, button); target.append(row);
    }
    document.dispatchEvent(new Event('pendientes-cambiaron'));
  }
  async function requireUser(admin = false) {
    try { user = await api('/auth/me'); }
    catch (error) { if (error.status === 401) { location.href = `login.html?next=${admin ? 'admin' : 'caja'}`; return null; } throw error; }
    if (admin && user.rol !== 'administrador') { location.href = 'index.html'; return null; }
    if ($('sesion-usuario')) $('sesion-usuario').textContent = `${user.nombre} · ${user.rol}`;
    document.querySelectorAll('[data-admin]').forEach(el => { el.hidden = user.rol !== 'administrador'; });
    if ($('salir')) $('salir').onclick = async () => {
      try { await api('/auth/logout', { method: 'POST', body: {} }); location.href = 'login.html'; } catch (e) { message(e.message); }
    };
    const passwordForm = $('form-password');
    if (passwordForm) passwordForm.onsubmit = async event => {
      event.preventDefault();
      await busy(passwordForm, async () => {
        await api('/auth/password', { method: 'POST', body: { actual: passwordForm.elements.actual.value, nueva: passwordForm.elements.nueva.value } });
        location.href = 'login.html';
      });
    };
    renderPending();
    return user;
  }
  async function busy(form, fn) {
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    buttons.forEach(b => { b.disabled = true; }); message('');
    try { return await fn(); } catch (error) { message(error.message); }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  function table(target, rows, columns, empty = 'No hay registros.') {
    target.replaceChildren();
    if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = columns.length; td.textContent = empty; tr.append(td); target.append(tr); return; }
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const td = document.createElement('td'), value = column(row);
        if (value instanceof Node) td.append(value); else td.textContent = value ?? '—';
        tr.append(td);
      }
      target.append(tr);
    }
  }
  function button(label, handler, className = '') {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className;
    b.onclick = async () => { b.disabled = true; try { await handler(); } catch (e) { message(e.message); } finally { b.disabled = false; } };
    return b;
  }
  function receipt(sale) {
    const target = $('ticket-impresion');
    target.innerHTML = `<h2>Forrajera</h2>${sale.estado === 'devuelta' ? '<h3>VENTA DEVUELTA</h3>' : ''}<p>${escape(sale.folio || sale.id_venta)}</p><p>${escape(date(sale.fecha_hora))}<br>Cajero: ${escape(sale.nombre_usuario || sale.usuario)}</p><hr><table><thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>${sale.articulos.map(a => `<tr><td>${escape(a.nombre)}<br><small>${escape(a.presentacion)}</small></td><td>${escape(qty(a.cantidad))}</td><td>${escape(money(a.subtotal))}</td></tr>`).join('')}</tbody></table><hr><h3>Total: ${escape(money(sale.total))}</h3><p>Pago: ${escape(sale.metodo_pago)}${sale.metodo_pago === 'Efectivo' ? `<br>Recibido: ${escape(money(sale.pago_con))}<br>Cambio: ${escape(money(sale.cambio))}` : ''}</p><p>Gracias por su compra</p>`;
  }
  return { $, api, message, money, qty, date, today, escape, uuid, requireUser, busy, table, button, operation, pending, renderPending, receipt, get user() { return user; } };
})();
