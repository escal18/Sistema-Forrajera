# Sistema Forrajera

Inventario, compras y caja con usuarios y turnos. Interfaz en español; búsqueda por nombre o clave, sin lector de códigos.

## Iniciar

```powershell
cd backend-forrajera
npm install
npm start
```

Abre **http://localhost:3000**. También puedes presionar F5 en VS Code y elegir **Iniciar Caja y API**. `npm run dev` reinicia el servidor al guardar cambios.

La API necesita `backend-forrajera/firebase-key.json`, o credenciales estándar de Firebase mediante `GOOGLE_APPLICATION_CREDENTIALS`. La clave privada está excluida de Git. No la publiques.

En el primer acceso, crea tu administrador desde **localhost en el equipo del servidor**. No hay contraseñas predeterminadas. Después podrás agregar cajeros o administradores desde Administración → Usuarios. Las contraseñas requieren al menos 10 caracteres; se guardan con scrypt y sal aleatoria. Las sesiones duran 8 horas y usan una cookie HttpOnly. Un cambio de usuario, contraseña, permiso o estado revoca sus sesiones anteriores. Debe quedar al menos un administrador activo.

Live Server en los puertos 5500–5599 sigue siendo compatible si usas el mismo nombre de servidor (localhost o 127.0.0.1) para abrir la interfaz y la API. Se recomienda usar directamente el puerto 3000. Puedes configurar `PORT` para otro puerto y `APP_ORIGIN` para un origen adicional autorizado. Si publicas el servicio, utiliza HTTPS para las cookies y el tráfico de autenticación.

## Uso diario

1. El cajero inicia sesión y abre su turno con el fondo de efectivo recibido.
2. Busca productos por nombre o clave, o elige los productos frecuentes. F2 lleva al buscador; Enter agrega la primera coincidencia; F4 confirma el formulario de cobro.
3. Elige cantidad y presentación, método de pago y efectivo recibido. El servidor verifica precios, cantidades y existencias. El precio mostrado debe coincidir con el catálogo vigente.
4. Una venta confirmada genera folio, guarda los artículos y descuenta existencias en una sola transacción. Puedes imprimir el ticket y reimprimirlo después.
5. Al terminar, cuenta el efectivo y cierra el turno. Se muestra la diferencia entre contado y esperado. Las tarjetas no forman parte del efectivo del cajón.

Si se pierde la conexión al registrar una venta, compra, movimiento o turno, **reintenta la misma operación pendiente**. El navegador conserva la clave de operación y el servidor devuelve el resultado previo sin repetirla. No borres los datos del navegador para resolver una operación pendiente. Los borradores de caja y el último ticket se guardan por usuario en ese navegador.

## Inventario y presentaciones

- Cada producto tiene una **unidad base inmutable**, precio, costo opcional, existencia mínima y presentaciones opcionales.
- Ejemplo: unidad base `kg`, existencia `1,000`; presentación `Costal 40 kg`, equivalencia `40` y precio por costal. Vender dos costales descuenta `80 kg`.
- Para pacas vendidas enteras puedes usar `pieza`. No se presupone que todas las pacas tengan el mismo peso.
- Cantidades y equivalencias admiten hasta 3 decimales. Las combinaciones deben poder expresarse con 3 decimales en la unidad base.
- Al crear un producto puedes indicar existencias iniciales. Después, los cambios se registran mediante compras, ajustes, mermas o devoluciones, con responsable, fecha, motivo y existencia anterior y posterior.
- Las compras se registran en la unidad base y actualizan el costo promedio ponderado. Si el inventario existente no tiene costo, primero registra su costo base. Una compra de inventario no descuenta dinero del cajón de ventas.
- Las devoluciones completas requieren administrador, motivo y un turno propio abierto para el reembolso. Se repone toda la mercancía; verifica su recepción física. Las devoluciones en efectivo requieren saldo suficiente registrado en el turno. Una devolución no puede ejecutarse dos veces.

## Permisos

| Función | Cajero | Administrador |
|---|---|---|
| Buscar productos y cobrar | Sí | Sí |
| Abrir y cerrar su propio turno | Sí | Sí |
| Consultar y reimprimir sus ventas | Sí | Sí |
| Costos, utilidad y reportes generales | No | Sí |
| Editar productos, compras, proveedores y ajustes | No | Sí |
| Devoluciones completas y usuarios | No | Sí |

Los permisos se validan en la API, además de la interfaz.

## Reportes y datos anteriores

Administración incluye existencias bajas, valor del inventario con costo conocido, movimientos, compras, turnos, ventas netas, utilidad bruta, productos más vendidos por importe y exportación CSV. Los reportes usan fechas **UTC−6**. Las devoluciones se restan en su fecha de registro.

Los productos, ventas y cortes anteriores se conservan. No se inventan costos, usuarios ni presentaciones para los registros antiguos. Las ventas sin costo histórico muestran utilidad pendiente, aunque registres un costo después. Los cortes antiguos aparecen aparte y no se recalculan como turnos nuevos. Las ventas antiguas sin cantidades base no admiten devolución automática.

La utilidad mostrada es **bruta** (ventas menos costo de mercancía), antes de gastos operativos e impuestos. Los reportes admiten hasta 5,000 ventas y 5,000 devoluciones por periodo; si se supera ese límite, solicita un intervalo menor. Los historiales muestran los últimos 200 registros. Para catálogos grandes conviene migrar la búsqueda local y los filtros a consultas paginadas.

## Comprobaciones

```powershell
cd backend-forrajera
npm test
```

Las pruebas usan un adaptador transaccional en memoria: **no escriben en Firebase ni en el inventario real**. Cubren permisos, sesiones, validación, precios, conversiones, duplicados, reintentos, concurrencia, compras, mermas, devoluciones y cortes. El adaptador obliga a leer antes de escribir, como Firestore. Una prueba con el emulador o un proyecto de Firebase de desarrollo es recomendable antes de un despliegue público.

`/api/salud` comprueba que el servidor esté escuchando. Si aparece `ERR_CONNECTION_REFUSED`, inicia la API y deja abierta su terminal. Los errores de acceso a la base aparecen en la terminal del servidor.
