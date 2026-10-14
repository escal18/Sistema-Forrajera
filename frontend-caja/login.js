'use strict';
(async () => {
  const form = F.$('form-login');
  try {
    const state = await F.api('/auth/estado');
    if (state.requiere_configuracion) {
      F.$('titulo').textContent = 'Configura tu administrador';
      F.$('instrucciones').textContent = 'Este es el primer acceso. Crea tu cuenta desde localhost en este equipo. Usa una contraseña de al menos 10 caracteres.';
      F.$('campo-nombre').hidden = false;
      form.elements.nombre.required = true;
      form.elements.password.minLength = 10;
      form.elements.password.autocomplete = 'new-password';
      F.$('entrar').textContent = 'Crear administrador';
    }
    form.onsubmit = event => {
      event.preventDefault();
      F.busy(form, async () => {
        const body = { usuario: form.elements.usuario.value, password: form.elements.password.value, nombre: form.elements.nombre.value };
        if (state.requiere_configuracion) await F.api('/auth/configurar', { method: 'POST', body });
        const user = await F.api('/auth/login', { method: 'POST', body });
        location.href = new URLSearchParams(location.search).get('next') === 'admin' && user.rol === 'administrador' ? 'admin.html' : 'index.html';
      });
    };
  } catch (error) { F.message(error.message); }
})();
