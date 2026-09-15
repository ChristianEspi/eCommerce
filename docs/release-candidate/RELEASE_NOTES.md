# Release notes — cierre del plan eCommerce B2C + B2B

Rama `dev` · base del plan `5e3da4e` · código certificado en `c5066af` · 2026-09-14.
**Nada desplegado.** Orden de despliegue y condiciones en [`DEPLOYMENT_MANIFEST.md`](DEPLOYMENT_MANIFEST.md);
evidencia y dictamen en [`FINAL_CERTIFICATION.md`](FINAL_CERTIFICATION.md); trazabilidad ítem a ítem en
[`../PROGRESO_CIERRE.md`](../PROGRESO_CIERRE.md).

## Para compradores de empresa (vitrina)

- **Crédito bloqueado.** Una cuenta con el crédito retenido por cobranzas ya no puede confirmar pedidos; el checkout
  lo dice antes de cobrar y a quién acudir. Aplica también a pedidos prepagados de esa cuenta (decisión a confirmar
  con cobranzas).
- **Aprobaciones.** Pestaña «Aprobaciones» en Tu cuenta para quien puede firmar: la cola de su empresa, aprobar o
  rechazar con motivo. Pulsar dos veces no firma dos veces.
- **Cotizaciones.** «Solicitar cotización» desde el carrito y pestaña «Cotizaciones»: aceptar una cotización lleva
  las líneas al carrito con el precio cotizado, que se cobra una sola vez, en las cantidades cotizadas y hasta su
  vencimiento. Una cotización de más de 99 unidades por línea o en presentaciones no se ofrece para aceptar (el
  carrito no las admite) y se explica por qué.
- **Pedido rápido y CSV** (`/s/<tienda>/pedido-rapido`): SKU y cantidad escritos, pegados o en archivo; validación
  por fila con motivo; al carrito. Volver a cargar el mismo archivo no duplica.
- **Pedidos programados.** «Programar este pedido» desde el carrito y pestaña «Programados»: cada N días llega un
  aviso con la propuesta para pasarla al carrito; pausar, reanudar, editar y eliminar. **Nunca crea un pedido
  solo**: se confirma en el checkout con el precio, el stock, el crédito y la aprobación del día.
- **Volver a comprar** también para cuentas B2B.
- **Opiniones** en la ficha (solo moderadas, «Compra verificada» la pone el servidor) y **productos relacionados**
  curados por la tienda.

## Para el backoffice

- **Canales** (`/app/channels`): alta, edición, activar/desactivar y canal por defecto.
- **Moderación de opiniones** (`/app/reviews`).
- **Carritos abandonados**: recordatorio por correo a compradores con sesión. **Nace apagado**; encenderlo exige que
  el negocio confirme la base legal de consentimiento.
- **Sugerido v2** en Planificación: temporada, surtido y disponibilidad, explicado por línea, con respaldo v1.
- **Comprobantes**: estado de emisión y botón «Emitir» (encola `invoice.issue`; sin facturador configurado queda
  visible como pendiente de configuración, no falla).
- **Módulos con candado de servidor**: `catalog.advanced`, `payments` y `fulfillment` ya se exigen en la base, no
  solo en el menú. Un tenant que el Hub nunca sincronizó los conserva.

## Seguridad y dinero (corregido)

- Un conector de pago **simulado** (`sandbox`, o Culqi sin su secreto) ya no deja pedidos pagados sin dinero: solo
  cobra donde el despliegue lo permite con `EBIM_PAYMENTS_ALLOW_SIMULATION=true`.
- Un cobro capturado por **menos de lo debido** ya no marca el pedido pagado: queda el cobro, una nota y un
  incidente `COBRO_INCOMPLETO`.
- Un aviso **tardío** de la pasarela sobre un cobro cerrado ya no provoca reintentos infinitos.
- **Abrir un envío** respeta «no entregar sin cobrar», igual que marcarlo en camino.
- El `secret_ref` de un webhook saliente ya no puede nombrar secretos del servidor: queda encerrado en el espacio de
  la sociedad.
- Abrir el carrito desde varias pestañas o componentes a la vez ya no falla con 409.

## Rendimiento

La portada (399,6 kB) y la ficha (384,6 kB) quedan **por debajo** del RC anterior y de su techo, sin subir el
presupuesto: el diccionario del backoffice se descarga solo al entrar en `/app`, y las opiniones de la ficha llegan
después del primer pintado.

## Operación (lo que cambia al desplegar)

- 19 migraciones nuevas, 9 Edge Functions a desplegar: ver manifiesto.
- Secretos de Edge Functions nuevos o renombrados:
  - `EBIM_PAYMENTS_ALLOW_SIMULATION=true` **solo** en DEV/QAS/demo. Sin ella, el `sandbox` deja de cobrar.
  - Webhooks salientes: `EBIM_WH_<company_id en hex>_<secret_ref>` (re-aprovisionar los existentes).
- Tres trabajos de `pg_cron`: `ecommerce-order-schedules` (cada hora) y `ecommerce-cart-recovery` (cada 15 min) son
  nuevos; `ecommerce-notifications-dispatch` ya existía.
- `npm run check:edge` es un gate nuevo (necesita red la primera vez para descargar Deno 2.9.6).
- Sin cambios de dependencias (`package-lock.json` idéntico al RC).

## Pendiente, fuera de este código

Proveedor fiscal que consuma `invoice.issue`; pasarela y transportista reales (devolución real, liquidación de
reembolsos); plantilla de correo del aviso de pedido programado; base legal de la recuperación de carritos;
separación de funciones en aprobaciones (hoy un admin de la cuenta puede aprobar su propio pedido). Detalle y
responsables en `FINAL_CERTIFICATION.md`.
