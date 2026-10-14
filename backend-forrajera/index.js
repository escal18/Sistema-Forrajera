const path = require('node:path');
const fs = require('node:fs');
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createApp } = require('./app');

try {
  const keyPath = path.join(__dirname, 'firebase-key.json');
  const credential = fs.existsSync(keyPath) ? cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) : applicationDefault();
  initializeApp({ credential });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  const server = createApp({ db }).listen(port, () => console.log(`Caja y administración: http://localhost:${port}\nEn el primer acceso, crea tu cuenta de administrador.`));
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} ya está ocupado. Revisa si la API está iniciada.` : error.message);
    process.exitCode = 1;
  });
} catch (error) {
  console.error('No se pudo iniciar el sistema:', error.message);
  process.exitCode = 1;
}
