'use strict';
(async () => {
  let products = [], cart = [], shift = null, lastSale = null, ready = false;
  const $ = F.$;
  let draftKey, receiptKey;
  const hasPendingSale = () => ready && F.pending().some(p => p.name === 'venta');
  const lineCents = a => Math.round(Math.round(a.precio * 100) * Math.round(a.cantidad * 1000) / 1000);
  const totalCents = () => cart.reduce((sum, a) => sum + lineCents(a), 0);
  function unit(product, name) {
    return name === product.unidad_medida ? { nombre: name, factor: 1, precio: Number(product.precio) } : (product.presentaciones || []).find(p => p.nombre === name);
  }
  function saveDraft() { if (draftKey) localStorage.setItem(draftKey, JSON.stringify(cart)); }
  function drawCart() {
    const locked = hasPendingSale();
    F.table($('cuerpo-ticket'), cart, [
      a => {
        const wrap = document.createElement('div'), label = document.createElement('strong');
        label.textContent = a.nombre; wrap.append(label);
        const select = document.createElement('select'); select.setAttribute('aria-label', `Presentación de ${a.nombre}`); select.disabled = locked;
        const p = products.find(p => p.id_producto === a.id_producto);
        if (p) for (const u of [{ nombre: p.unidad_medida, factor: 1, precio: p.precio }, ...p.presentaciones]) {
          const opt = document.createElement('option'); opt.value = u.nombre; opt.textContent = `${u.nombre}${u.factor !== 1 ? ` (${F.qty(u.factor)} ${p.unidad_medida})` : ''}`; select.append(opt);
        }
        select.value = a.presentacion;
        select.onchange = () => { const u = unit(p, select.value); a.presentacion = u.nombre; a.factor = u.factor; a.precio = Number(u.precio); saveDraft(); drawCart(); };
        wrap.append(select); return wrap;
      },
      a => {
        const input = document.createElement('input'); input.type = 'number'; input.min = '0.001'; input.max = '10000000'; input.step = '0.001'; input.value = a.cantidad; input.disabled = locked; input.setAttribute('aria-label', `Cantidad de ${a.nombre}`);
        input.onchange = () => {
          const q = Number(input.value);
          if (!Number.isFinite(q) || q <= 0 || Math.abs(q * 1000 - Math.round(q * 1000)) > 0.00001) { F.message('Escribe una cantidad positiva con hasta 3 decimales.'); input.value = a.cantidad; return; }
          a.cantidad = q; saveDraft(); drawCart();
        }; return input;
      },
      a => F.money(a.precio), a => F.money(lineCents(a) / 100),
      a => { const b = F.button('Quitar', () => { cart.splice(cart.indexOf(a), 1); saveDraft(); drawCart(); }, 'danger'); b.disabled = locked; return b; }
    ], 'Busca un producto para comenzar la venta.');
    $('total-venta').textContent = F.money(totalCents() / 100);
    $('btn-cobrar').disabled = !cart.length || !shift || locked;
    $('vaciar').disabled = locked;
    $('metodo-pago').disabled = locked; $('pago-con').disabled = locked;
    drawChange();
  }
  function drawChange() {
    const cash = $('metodo-pago').value === 'Efectivo';
    $('campo-pago').hidden = !cash;
    $('pago-con').required = cash;
    $('cambio-venta').textContent = F.money(cash ? Math.max(0, Math.round(Number($('pago-con').value || 0) * 100) - totalCents()) / 100 : 0);
  }
  function add(product) {
    if (hasPendingSale()) return F.message('Primero confirma la venta pendiente.');
    if (Number(product.stock) <= 0) return F.message('Este producto no tiene existencias.');
    const old = cart.find(a => a.id_producto === product.id_producto && a.presentacion === product.unidad_medida);
    if (old) old.cantidad = Math.round((old.cantidad + 1) * 1000) / 1000;
    else cart.push({ id_producto: product.id_producto, nombre: product.nombre, presentacion: product.unidad_medida, factor: 1, precio: Number(product.precio), cantidad: 1 });
    $('input-buscador').value = ''; search(); saveDraft(); drawCart(); $('input-buscador').focus();
  }
  function search() {
    const term = $('input-buscador').value.trim().toLocaleLowerCase('es');
    $('lista-resultados').replaceChildren();
    if (!term) { $('estado-busqueda').textContent = ''; return; }
    const matches = products.filter(p => `${p.nombre} ${p.codigo_interno}`.toLocaleLowerCase('es').includes(term));
    $('estado-busqueda').textContent = matches.length ? `${matches.length} coincidencia(s)` : 'No se encontraron productos.';
    for (const p of matches.slice(0, 12)) {
      const b = F.button('', () => add(p), 'result');
      const name = document.createElement('span'), price = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = `${p.nombre} · ${p.codigo_interno}`;
      const detail = document.createElement('small'); detail.textContent = `Disponible: ${F.qty(p.stock)} ${p.unidad_medida}`;
      name.append(title, detail); price.textContent = F.money(p.precio); b.append(name, price); b.disabled = Number(p.stock) <= 0 || hasPendingSale();
      $('lista-resultados').append(b);
    }
  }
  async function loadProducts() {
    products = await F.api('/productos');
    $('favoritos').replaceChildren();
    const favorites = products.filter(p => p.favorito);
    if (!favorites.length) $('favoritos').textContent = 'El administrador puede marcar los productos frecuentes desde Inventario.';
    for (const p of favorites.slice(0, 12)) $('favoritos').append(F.button(p.nombre, () => add(p)));
    const oldCart = cart;
    cart = oldCart.flatMap(a => {
      const p = products.find(p => p.id_producto === a.id_producto), u = p && unit(p, a.presentacion);
      if (!u) return [];
      return [{ ...a, nombre: p.nombre, precio: Number(u.precio), factor: u.factor }];
    });
    if (oldCart.length !== cart.length) F.message('Se quitaron renglones que ya no existen en el catálogo. Revisa el ticket.');
    search(); drawCart(); saveDraft();
  }
  async function loadShift() {
    shift = await F.api('/turnos/actual');
    $('abrir-turno').hidden = !!shift; $('turno-abierto').hidden = !shift;
    if (shift) {
      $('turno-nombre').textContent = `${shift.nombre} · desde ${F.date(shift.fecha_apertura)}`;
      $('resumen-turno').innerHTML = [
        ['Fondo inicial', F.money(shift.fondo_centavos / 100)], ['Ventas netas en efectivo', F.money(shift.efectivo_centavos / 100)],
        ['Ventas netas con tarjeta', F.money(shift.tarjeta_centavos / 100)], ['Efectivo esperado', F.money((shift.fondo_centavos + shift.efectivo_centavos) / 100)], ['Tickets', shift.tickets_emitidos]
      ].map(([label, value]) => `<div class="stat"><small>${F.escape(label)}</small><strong>${F.escape(value)}</strong></div>`).join('');
    }
    drawCart(); drawDifference();
  }
  function drawDifference() {
    const input = $('form-cierre').elements.contado;
    $('diferencia-cierre').textContent = shift && input.value !== '' ? `Diferencia: ${F.money((Math.round(Number(input.value) * 100) - shift.fondo_centavos - shift.efectivo_centavos) / 100)}. Las ventas con tarjeta no forman parte del efectivo contado.` : '';
  }
  function showSale(sale) {
    lastSale = sale; localStorage.setItem(receiptKey, JSON.stringify(sale));
    F.receipt(sale); $('ultima-venta').hidden = false;
    $('ultimo-folio').textContent = sale.folio;
    $('ultimo-total').textContent = `Total: ${F.money(sale.total)} · Cambio: ${F.money(sale.cambio)}`;
  }
  async function saleConfirmed(sale) {
    cart = []; saveDraft(); $('pago-con').value = ''; showSale(sale); drawCart();
    F.message(`Venta confirmada por ${F.money(sale.total)}. Cambio: ${F.money(sale.cambio)}.`, 'ok');
    await Promise.all([loadShift(), loadProducts()]); $('input-buscador').focus();
  }
  try {
    const user = await F.requireUser(); if (!user) return;
    draftKey = `forrajera:${user.id_usuario}:borrador`; receiptKey = `forrajera:${user.id_usuario}:ultimo-ticket`;
    try { cart = JSON.parse(localStorage.getItem(draftKey) || '[]'); if (!Array.isArray(cart)) cart = []; } catch { cart = []; }
    ready = true;
    await Promise.all([loadProducts(), loadShift()]);
    try { const saved = JSON.parse(localStorage.getItem(receiptKey) || 'null'); if (saved) showSale(saved); } catch { /* No hay ticket recuperable. */ }
    $('input-buscador').oninput = search;
    $('input-buscador').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('lista-resultados').querySelector('button:not(:disabled)')?.click(); } };
    $('actualizar').onclick = async () => { try { await Promise.all([loadProducts(), loadShift()]); F.message('Catálogo y turno actualizados.', 'ok'); } catch (e) { F.message(e.message); } };
    $('metodo-pago').onchange = drawChange; $('pago-con').oninput = drawChange;
    $('vaciar').onclick = () => { if (cart.length && confirm('¿Vaciar la venta actual?')) { cart = []; saveDraft(); drawCart(); } };
    $('form-apertura').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      F.busy(form, async () => { await F.operation('apertura', '/turnos', { nombre: form.elements.nombre.value, fondo_inicial: form.elements.fondo.value }, 'Apertura de turno'); await loadShift(); F.message('Turno abierto.', 'ok'); });
    };
    $('form-cierre').elements.contado.oninput = drawDifference;
    $('form-cierre').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      if (!shift || hasPendingSale()) return F.message('Confirma las ventas pendientes antes de cerrar el turno.');
      if (!confirm('¿Confirmas el efectivo contado y el cierre de tu turno?')) return;
      F.busy(form, async () => {
        const closed = await F.operation('cierre', `/turnos/${shift.id}/cerrar`, { efectivo_contado: form.elements.contado.value, observaciones: form.elements.observaciones.value }, 'Cierre de turno');
        form.reset(); await loadShift(); F.message(`Turno cerrado. Diferencia: ${F.money(closed.diferencia_centavos / 100)}.`, 'ok');
      });
    };
    $('form-cobro').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      if (!shift || !cart.length || hasPendingSale()) return;
      const body = { metodo_pago: $('metodo-pago').value, pago_con: $('pago-con').value, total_esperado: totalCents() / 100, articulos: cart.map(a => ({ id_producto: a.id_producto, presentacion: a.presentacion, cantidad: a.cantidad })) };
      F.busy(form, async () => { const sale = await F.operation('venta', '/ventas', body, 'Cobro de venta'); await saleConfirmed(sale); }).finally(drawCart);
    };
    $('imprimir').onclick = () => { if (lastSale) { F.receipt(lastSale); window.print(); } };
    $('consultar-mis-ventas').onclick = async () => {
      try {
        const sales = await F.api('/mis-ventas');
        F.table($('mis-ventas'), sales, [s => `${s.folio} · ${F.date(s.fecha_hora)}`, s => s.metodo_pago, s => F.money(s.total), s => s.estado, s => F.button('Reimprimir', () => { F.receipt(s); window.print(); })]);
      } catch (error) { F.message(error.message); }
    };
    document.addEventListener('pendientes-cambiaron', () => { drawCart(); search(); });
    document.addEventListener('operacion-confirmada', event => {
      const { record, result } = event.detail;
      (record.name === 'venta' ? saleConfirmed(result) : loadShift()).catch(error => F.message(error.message));
    });
    window.addEventListener('storage', () => { F.renderPending(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'F2') { event.preventDefault(); $('input-buscador').focus(); }
      if (event.key === 'F4') { event.preventDefault(); if (!$('btn-cobrar').disabled) $('form-cobro').requestSubmit(); }
    });
  } catch (error) { F.message(error.message); }
})();
