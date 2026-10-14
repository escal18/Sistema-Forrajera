'use strict';
(async () => {
  const $ = F.$;
  let products = [], suppliers = [], users = [], report = null, returnId = null;
  const formProduct = $('form-producto'), formUser = $('form-usuario');
  const fields = form => Object.fromEntries(new FormData(form));
  function csv(name, rows) {
    const content = '\uFEFF' + rows.map(row => row.map(value => {
      let text = String(value ?? '');
      if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function tab(name) {
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    history.replaceState(null, '', '#' + name);
  }
  function addPresentation(p = {}) {
    if ($('presentaciones').children.length >= 12) return F.message('Puedes agregar hasta 12 presentaciones.');
    const row = document.createElement('div'); row.className = 'unit-row';
    for (const [key, label, type, value] of [['nombre', 'Nombre', 'text', p.nombre || ''], ['factor', 'Equivalencia base', 'number', p.factor || ''], ['precio', 'Precio por presentación', 'number', p.precio ?? '']]) {
      const lab = document.createElement('label'); lab.textContent = label;
      const input = document.createElement('input'); input.dataset.field = key; input.type = type; input.value = value; input.required = true;
      if (type === 'number') { input.min = key === 'factor' ? '0.001' : '0'; input.max = '10000000'; input.step = key === 'factor' ? '0.001' : '0.01'; } else input.maxLength = 40;
      lab.append(input); row.append(lab);
    }
    row.append(F.button('Quitar', () => row.remove(), 'danger')); $('presentaciones').append(row);
  }
  function resetProduct() {
    formProduct.reset(); formProduct.elements.id.value = ''; formProduct.elements.stock.readOnly = false; formProduct.elements.unidad_medida.readOnly = false;
    $('presentaciones').replaceChildren(); $('titulo-producto').textContent = 'Nuevo producto';
  }
  function editProduct(p) {
    resetProduct();
    for (const key of ['codigo_interno', 'nombre', 'unidad_medida', 'precio', 'costo', 'stock', 'stock_minimo']) formProduct.elements[key].value = p[key] ?? '';
    formProduct.elements.id.value = p.id_producto; formProduct.elements.favorito.checked = !!p.favorito;
    formProduct.elements.stock.readOnly = true; formProduct.elements.unidad_medida.readOnly = true;
    for (const unit of p.presentaciones) addPresentation(unit);
    $('titulo-producto').textContent = `Editar: ${p.nombre}`; $('editor-producto').scrollIntoView({ behavior: 'smooth' });
  }
  function drawProducts() {
    const term = $('filtro-productos').value.trim().toLocaleLowerCase('es');
    const rows = products.filter(p => `${p.nombre} ${p.codigo_interno}`.toLocaleLowerCase('es').includes(term) && (!$('solo-bajos').checked || Number(p.stock) <= Number(p.stock_minimo)));
    F.table($('catalogo'), rows, [p => p.codigo_interno, p => `${p.favorito ? '★ ' : ''}${p.nombre} · ${p.unidad_medida}`, p => F.money(p.precio), p => F.money(p.costo), p => {
      const s = document.createElement('span'); s.textContent = F.qty(p.stock); s.className = Number(p.stock) <= Number(p.stock_minimo) ? 'low' : ''; return s;
    }, p => F.qty(p.stock_minimo), p => F.button('Editar', () => editProduct(p))]);
    const low = products.filter(p => Number(p.stock) <= Number(p.stock_minimo));
    const unknown = products.filter(p => p.costo == null);
    const value = products.reduce((sum, p) => sum + (p.costo == null ? 0 : Number(p.costo) * Number(p.stock)), 0);
    $('stats-inventario').innerHTML = [['Productos', products.length], ['Con existencias bajas', low.length], ['Valor a costo conocido', F.money(value)], ['Sin costo registrado', unknown.length]].map(([label, v]) => `<div class="stat"><small>${F.escape(label)}</small><strong>${F.escape(v)}</strong></div>`).join('');
  }
  function productOptions() {
    document.querySelectorAll('.select-productos').forEach(select => {
      const selected = select.value; select.replaceChildren();
      const first = document.createElement('option'); first.value = ''; first.textContent = select.id === 'filtro-movimientos' ? 'Todos los productos' : 'Selecciona un producto'; select.append(first);
      for (const p of products) { const option = document.createElement('option'); option.value = p.id_producto; option.textContent = `${p.codigo_interno} · ${p.nombre} (${p.unidad_medida})`; select.append(option); }
      select.value = selected;
    });
    unitHints();
  }
  function unitHints() {
    for (const [formId, output] of [['form-compra', 'compra-unidad'], ['form-movimiento', 'ajuste-unidad']]) {
      const p = products.find(p => p.id_producto === $(formId).elements.id_producto.value);
      $(output).textContent = p ? `Unidad base: ${p.unidad_medida}. Existencia actual: ${F.qty(p.stock)}. ${p.costo == null ? 'Falta registrar el costo base.' : `Costo promedio: ${F.money(p.costo)}.`}` : 'Selecciona un producto para ver su unidad base y existencia.';
    }
  }
  async function loadProducts() { products = await F.api('/productos'); drawProducts(); productOptions(); }
  async function loadSuppliers() {
    suppliers = await F.api('/proveedores');
    const select = $('compra-proveedor'), selected = select.value; select.replaceChildren();
    const first = document.createElement('option'); first.value = ''; first.textContent = 'Selecciona un proveedor'; select.append(first);
    for (const s of suppliers) { const option = document.createElement('option'); option.value = s.id; option.textContent = s.nombre; select.append(option); }
    select.value = selected;
    F.table($('proveedores'), suppliers, [s => s.nombre, s => s.contacto]);
  }
  async function loadPurchases() {
    F.table($('compras'), await F.api('/compras'), [p => `${F.date(p.fecha_hora)} · ${p.nombre_usuario}`, p => p.producto, p => `${p.proveedor} · ${p.referencia}`, p => `${F.qty(p.cantidad)} ${p.unidad_medida}`, p => F.money(p.costo_unitario), p => F.money(p.total)]);
  }
  async function loadMovements() {
    const id = $('filtro-movimientos').value;
    F.table($('movimientos'), await F.api('/movimientos' + (id ? `?id_producto=${encodeURIComponent(id)}` : '')), [m => F.date(m.fecha_hora), m => m.producto, m => m.tipo, m => `${F.qty(m.cantidad)} ${m.unidad_medida}`, m => `${F.qty(m.stock_anterior)} → ${F.qty(m.stock_nuevo)}`, m => m.nombre_usuario || m.usuario, m => m.motivo]);
  }
  async function loadReport() {
    const form = $('form-reporte');
    report = await F.api(`/reportes?inicio=${encodeURIComponent(form.elements.inicio.value)}&fin=${encodeURIComponent(form.elements.fin.value)}`);
    $('stats-reporte').innerHTML = [['Ventas brutas', F.money(report.ventas_brutas)], ['Reembolsos', F.money(report.devoluciones)], ['Ventas netas', F.money(report.ventas_netas)], ['Utilidad bruta', F.money(report.utilidad)], ['Efectivo neto', F.money(report.efectivo)], ['Tarjeta neta', F.money(report.tarjeta)]].map(([label, v]) => `<div class="stat"><small>${F.escape(label)}</small><strong>${F.escape(v)}</strong></div>`).join('');
    $('aviso-costos').hidden = !report.operaciones_sin_costo;
    $('aviso-costos').textContent = `${report.operaciones_sin_costo} operación(es) no tienen costo histórico. La utilidad del periodo no se puede determinar con esos datos. Registrar un costo hoy no cambia las ventas anteriores.`;
    F.table($('ranking'), report.mas_vendidos, [p => p.nombre, p => `${F.qty(p.cantidad)} ${p.unidad_medida}`, p => F.money(p.importe)]);
    F.table($('reembolsos'), report.reembolsos, [r => `${F.date(r.fecha_hora)} · ${r.folio}`, r => F.money(r.total), r => r.motivo]);
    F.table($('ventas'), report.ventas, [s => `${s.folio || s.id} · ${F.date(s.fecha_hora)}`, s => s.nombre_usuario || 'Venta anterior', s => s.metodo_pago, s => F.money(s.total), s => F.money(s.utilidad), s => s.estado || 'Registro anterior', s => {
      const wrap = document.createElement('div'); wrap.className = 'actions';
      if (s.folio) wrap.append(F.button('Ticket', () => { F.receipt(s); window.print(); }));
      if (s.folio && s.estado !== 'devuelta') wrap.append(F.button('Devolver', () => { returnId = s.id; $('devolucion-folio').textContent = `${s.folio} · ${F.money(s.total)}`; $('form-devolucion').reset(); $('dialog-devolucion').showModal(); }, 'danger'));
      return wrap;
    }]);
  }
  async function loadShifts() {
    F.table($('turnos'), await F.api('/turnos'), [s => `${s.nombre} · ${s.nombre_usuario}`, s => `${F.date(s.fecha_apertura)} / ${F.date(s.fecha_cierre)}`, s => s.estado, s => s.tickets_emitidos, s => F.money(s.fondo_centavos / 100), s => F.money(s.efectivo_centavos / 100), s => F.money(s.tarjeta_centavos / 100), s => F.money((s.fondo_centavos + s.efectivo_centavos) / 100), s => s.contado_centavos == null ? '—' : F.money(s.contado_centavos / 100), s => s.diferencia_centavos == null ? '—' : F.money(s.diferencia_centavos / 100)]);
    F.table($('cortes-anteriores'), await F.api('/cortes/anteriores'), [s => F.date(s.fecha_corte), s => s.turno, s => F.money(s.ventas_dia), s => F.money(s.total_esperado)]);
  }
  function resetUser() {
    formUser.reset(); formUser.elements.id.value = ''; formUser.elements.usuario.readOnly = false; formUser.elements.password.required = true; $('titulo-usuario').textContent = 'Nuevo usuario';
  }
  async function loadUsers() {
    users = await F.api('/usuarios');
    F.table($('usuarios'), users, [u => `${u.nombre} · ${u.usuario}`, u => u.rol, u => u.activo ? 'Activo' : 'Inactivo', u => F.button('Editar', () => {
      resetUser(); formUser.elements.id.value = u.id_usuario; formUser.elements.usuario.value = u.usuario; formUser.elements.usuario.readOnly = true; formUser.elements.nombre.value = u.nombre; formUser.elements.rol.value = u.rol; formUser.elements.activo.checked = u.activo; formUser.elements.password.required = false; $('titulo-usuario').textContent = `Editar: ${u.nombre}`;
    })]);
  }
  const loaders = { inventario: loadProducts, compras: async () => { await loadProducts(); await Promise.all([loadSuppliers(), loadPurchases()]); }, movimientos: async () => { await loadProducts(); await loadMovements(); }, reportes: loadReport, turnos: loadShifts, usuarios: loadUsers };
  async function reload() { const name = document.querySelector('[data-tab][aria-selected="true"]').dataset.tab; await loaders[name](); }
  try {
    const user = await F.requireUser(true); if (!user) return;
    $('form-reporte').elements.inicio.value = F.today(); $('form-reporte').elements.fin.value = F.today();
    resetUser();
    document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = async () => { tab(b.dataset.tab); try { await reload(); } catch (e) { F.message(e.message); } }; });
    const initial = location.hash.slice(1); if (loaders[initial]) tab(initial);
    $('actualizar').onclick = () => reload().then(() => F.message('Datos actualizados.', 'ok')).catch(e => F.message(e.message));
    $('filtro-productos').oninput = drawProducts; $('solo-bajos').onchange = drawProducts;
    $('agregar-presentacion').onclick = () => addPresentation(); $('cancelar-producto').onclick = resetProduct;
    formProduct.onsubmit = event => {
      event.preventDefault();
      F.busy(formProduct, async () => {
        const body = fields(formProduct), id = body.id; delete body.id;
        if (id) delete body.stock;
        body.favorito = formProduct.elements.favorito.checked;
        body.presentaciones = [...$('presentaciones').children].map(row => Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.field, input.value])));
        await F.api('/productos' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body });
        resetProduct(); await loadProducts(); F.message('Producto guardado.', 'ok');
      });
    };
    $('form-compra').elements.id_producto.onchange = unitHints; $('form-movimiento').elements.id_producto.onchange = unitHints;
    for (const [id, name, url, label, after] of [
      ['form-compra', 'compra', '/compras', 'Compra de inventario', async () => { await loadProducts(); await Promise.all([loadPurchases(), loadSuppliers()]); }],
      ['form-movimiento', 'movimiento', '/movimientos', 'Ajuste de inventario', async () => { await loadProducts(); await loadMovements(); }]
    ]) $(id).onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      F.busy(form, async () => { await F.operation(name, url, fields(form), label); form.reset(); await after(); F.message('Movimiento registrado.', 'ok'); });
    };
    $('form-proveedor').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; F.busy(form, async () => { await F.api('/proveedores', { method: 'POST', body: fields(form) }); form.reset(); await loadSuppliers(); F.message('Proveedor guardado.', 'ok'); }); };
    $('filtrar-movimientos').onclick = () => loadMovements().catch(e => F.message(e.message));
    $('form-reporte').onsubmit = event => { event.preventDefault(); F.busy(event.currentTarget, loadReport); };
    $('cancelar-devolucion').onclick = () => $('dialog-devolucion').close();
    $('form-devolucion').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      F.busy(form, async () => { await F.operation('devolucion', `/ventas/${returnId}/devolver`, fields(form), 'Devolución de venta completa'); $('dialog-devolucion').close(); await loadReport(); F.message('Devolución registrada y existencias repuestas.', 'ok'); });
    };
    $('cancelar-usuario').onclick = resetUser;
    formUser.onsubmit = event => {
      event.preventDefault();
      F.busy(formUser, async () => {
        const body = fields(formUser), id = body.id; delete body.id; body.activo = formUser.elements.activo.checked;
        await F.api('/usuarios' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body });
        if (id === user.id_usuario) { location.href = 'login.html'; return; }
        resetUser(); await loadUsers(); F.message('Usuario guardado. Los cambios revocan sus sesiones anteriores.', 'ok');
      });
    };
    $('exportar-inventario').onclick = () => csv(`inventario-${F.today()}.csv`, [['Clave', 'Producto', 'Unidad base', 'Precio', 'Costo', 'Existencia', 'Mínimo'], ...products.map(p => [p.codigo_interno, p.nombre, p.unidad_medida, p.precio, p.costo, p.stock, p.stock_minimo])]);
    $('exportar-ventas').onclick = () => {
      if (!report) return F.message('Consulta primero un periodo.');
      csv(`ventas-${report.inicio}-${report.fin}.csv`, [['Tipo', 'Folio', 'Fecha', 'Responsable', 'Pago', 'Total', 'Costo', 'Utilidad', 'Estado / motivo'], ...report.ventas.map(s => ['Venta', s.folio || s.id, F.date(s.fecha_hora), s.nombre_usuario, s.metodo_pago, s.total, s.costo_total, s.utilidad, s.estado]), ...report.reembolsos.map(s => ['Devolución', s.folio, F.date(s.fecha_hora), s.nombre_usuario, s.metodo_pago, -s.total, s.costo_total == null ? '' : -s.costo_total, s.utilidad == null ? '' : -s.utilidad, s.motivo])]);
    };
    document.addEventListener('operacion-confirmada', () => { $('dialog-devolucion').close(); reload().catch(e => F.message(e.message)); });
    window.addEventListener('storage', () => F.renderPending());
    await reload();
  } catch (error) { F.message(error.message); }
})();
