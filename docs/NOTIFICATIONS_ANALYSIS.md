# Notificaciones — análisis previo a codificar

Estado: **entregas 1 y 2 construidas** el 2026-09-12 —núcleo y avisos P1—, con las decisiones de la
sección 7 tomadas como se proponen: buzón `ecommerce@grupoebim.com`, remitente «eCommerce by EBIM»
con la marca de la tienda dentro del correo, y la lista P1 completa. El correo queda bloqueado hasta
que el operador cargue los secretos `MS_*`. Detalle y pendientes en `docs/STATE.md`.

Propuesta original, del mismo día:
Pedido del operador: avisar a los usuarios de lo que les afecta, en el backoffice y en la tienda,
empezando por el sugerido de pedido. Este documento dice qué existe, qué regla de suite manda, qué
se podría notificar y en qué orden construirlo.

---

## 1. Lo que ya existe

| Pieza | Estado | Dónde |
|---|---|---|
| Registro central de hechos del negocio, con reintentos y deduplicación | Funciona | `domain_events` (`20260828100200`) |
| Reparto de esos hechos a webhooks de terceros | Funciona | trigger `domain_events_webhook_fanout` (`20260828170200`) |
| Puerto de avisos por correo, SMS y WhatsApp, por plantilla y con idempotencia | **Diseñado, sin implementar** | `src/domain/ports/notification.ts` |
| Hecho `notification.order_confirmation` al confirmar un pedido | **Se publica y nadie lo consume** | `create_order` |
| Campanita en el backoffice, avisos en la cuenta del comprador | No existe | — |
| Consumidor de `domain_events` que genere avisos | No existe | — |
| Ejecutor de tareas programadas | No existe: es la deuda **D5** del recorrido B2B | `docs/STATE.md` |

**Huecos que ya se ven hoy.** Dos textos de la tienda prometen correos que no salen:

- El checkout termina con «Te enviamos la confirmación por correo».
- «Tu cuenta» dice que «el seguimiento detallado llega en el correo de confirmación de cada pedido».

El hecho de la confirmación está registrado con todo lo necesario —número de pedido, correo,
nombre, total— y falta quien lo lea.

### Hechos que ya se registran

Estos doce son materia prima inmediata: un aviso sobre ellos no exige tocar la lógica de negocio.

`order.created` · `order.status_changed` · `order.payment_status_changed` ·
`order.fulfillment_status_changed` · `order.approval_requested` · `order.approval_decided` ·
`payment.refunded` · `fulfillment.created` · `fulfillment.delivered` · `return.requested` ·
`return.completed` · `notification.order_confirmation`

Todo lo demás de este documento necesita **publicar un hecho nuevo** donde ya cambia el estado, o
**una tarea programada** si el aviso depende del paso del tiempo (vencimientos, stock bajo).

---

## 2. Regla de suite que condiciona el diseño — contrato §14

El contrato de plataforma fija el correo para todas las apps, y es norma, no sugerencia:

- **Remitente dedicado por app** con nombre `<App> by EBIM`. Para esta app sería
  `ecommerce@grupoebim.com` como «eCommerce by EBIM».
- **Método único: Microsoft Graph `sendMail` en modo aplicación**, con la App Registration de suite
  que ya funciona en GMAO y una Application Access Policy que solo deja enviar como ese buzón.
- **Secretos** `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER_EMAIL`,
  `MS_SENDER_NAME` en los secretos de Edge Functions, **cargados por el operador**.
- **Botón «Probar»** en cada integración.
- **Prohibidos** los remitentes genéricos, y el contrato nombra `onboarding@resend.dev`.

> **Incumplimiento a corregir.** El 2026-09-12 se configuró el correo de Auth por Resend con
> `onboarding@resend.dev`. Eso contradice §14 en el proveedor y en el remitente. Hay que revertirlo
> y llevar el correo a Graph. Para los correos de Auth —recuperar contraseña, confirmar— el camino
> compatible es el *Send Email Hook* de Supabase apuntando a una Edge Function que envíe por Graph,
> porque Graph no es SMTP. Las plantillas en español de `supabase/templates/` se reaprovechan.

**Precedente de suite.** eSupplier ya avisa con **campanita y correo** (coordinación
`esupplier-027`). Esta propuesta sigue ese mismo patrón para que las apps se sientan iguales.

---

## 3. Canales

| Canal | Para quién | Cuándo usarlo |
|---|---|---|
| **Campanita del backoffice** | Miembros del tenant, según su rol | Todo lo operativo. Es el canal por defecto |
| **Avisos en «Tu cuenta» de la tienda** | Compradores con sesión | Lo que pasa con sus pedidos, su empresa y su crédito |
| **Correo por Graph** | Los dos, más el comprador sin cuenta | Lo que exige actuar fuera de la app, o cuando no hay sesión donde enseñarlo |
| SMS y WhatsApp | — | Fuera de alcance: el puerto existe, falta decidir proveedor |

El comprador **anónimo** solo puede recibir correo: no tiene cuenta donde ver una campanita. Por
eso la confirmación de pedido es correo sí o sí.

---

## 4. Qué se podría notificar

Leyenda de la columna **Base**:
- **Hoy** — el hecho ya se registra en `domain_events`.
- **Evento** — el estado existe; falta publicar el hecho donde cambia.
- **Programada** — depende del paso del tiempo y necesita el ejecutor de la deuda D5.
- **Pantalla** — el destinatario todavía no tiene dónde verlo o actuar.

Prioridad: **P1** primera entrega · **P2** segunda · **P3** cuando haya demanda.

### 4.1 Backoffice

#### Ventas y pedidos

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Entró un pedido nuevo | owner, admin, orders | Campanita | Hoy | **P1** |
| Un pedido espera tu aprobación | owner, admin, orders | Campanita y correo | Hoy | **P1** |
| El cobro de un pedido falló | owner, admin, orders | Campanita | Hoy | **P1** |
| Se reembolsó un pedido | owner, admin, orders | Campanita | Hoy | P2 |
| Pedido pagado que lleva horas sin preparar | owner, admin, orders | Campanita, resumen | Programada | P2 |
| Un pedido recurrente se pausó o terminó | owner, admin, orders | Campanita | Evento | P3 |

#### Logística y devoluciones

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Un cliente pidió una devolución | owner, admin, orders | Campanita | Hoy | **P1** |
| Entrega fallida: rechazada o cliente no encontrado | owner, admin, orders | Campanita | Evento | P2 |
| Llegó la mercadería devuelta y hay que inspeccionarla | owner, admin, orders | Campanita | Evento | P2 |

#### Inventario y catálogo

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Producto por debajo del punto de reorden | owner, admin, catalog | Campanita, **resumen diario** | Programada | P2 |
| Producto publicado sin stock | owner, admin, catalog | Campanita, resumen | Programada | P3 |
| Promoción que empieza o termina hoy | owner, admin | Campanita | Programada | P3 |
| Presupuesto de trade marketing consumido | owner, admin | Campanita | Evento | P2 |

#### Clientes, crédito y cobranza

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Cliente B2B pasó a bloqueado por crédito | owner, admin, vendedor de su cartera | Campanita | Evento | P2 |
| Cuota vencida de un cliente | owner, admin, vendedor de su cartera | Campanita, resumen | Programada | P2 |
| Comprobante electrónico rechazado | owner, admin | Campanita y correo | Evento | P2 |
| Cotización aceptada o rechazada por el cliente | owner, admin, orders, vendedor | Campanita | Evento, Pantalla | P2 |
| Cotización a punto de vencer | vendedor | Campanita | Programada | P3 |

#### Fuerza de ventas y planificación

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Sugerido generado para un cliente de tu cartera | vendedor | Campanita | Evento | **P1** |
| El cliente aceptó el sugerido | vendedor, orders | Campanita | Evento, Pantalla | P2 |
| Comisión aprobada o pagada | vendedor | Campanita | Evento | P3 |
| Meta del periodo en riesgo | vendedor, admin | Campanita, resumen | Programada | P3 |

> El rol **vendedor** (`sales_rep`) existe en la base y ninguna pantalla lo asigna. Los avisos para
> vendedores quedan colgados de cerrar ese hueco primero.

#### Seguridad y administración

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Te dieron acceso a este backoffice | la persona | Correo | Evento | **P1** |
| Cambiaron tu rol o te quitaron el acceso | la persona | Campanita y correo | Evento | P2 |
| Una integración dejó de responder: circuito abierto | owner, admin | Campanita y correo | Evento | **P1** |
| Un webhook acumula entregas fallidas | owner, admin | Campanita | Evento | P2 |
| Consumo de IA cerca de la cuota del mes | owner, admin | Campanita | Programada | P3 |

### 4.2 Tienda

#### Pedidos

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Recibimos tu pedido | el comprador, también anónimo | Correo | **Hoy**, y ya se promete en pantalla | **P1** |
| Tu pedido está pagado | el comprador | Aviso y correo | Hoy | P2 |
| Tu pedido salió, con seguimiento | el comprador | Aviso y correo | Hoy | **P1** |
| Tu pedido fue entregado | el comprador | Aviso | Hoy | P2 |
| El cobro falló, reintenta el pago | el comprador | Correo | Hoy | P2 |
| Tu pedido fue cancelado | el comprador | Aviso y correo | Hoy | P2 |

#### Compras de empresa B2B

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Tu pedido quedó esperando aprobación | quien compró | Aviso | Hoy | **P1** |
| Tu pedido fue aprobado o rechazado, con el motivo | quien compró | Aviso y correo | Hoy | **P1** |
| Te vincularon a la empresa X, falta que te activen | la persona | Correo | Evento | **P1** |
| Ya puedes comprar a nombre de la empresa X | la persona | Correo | Evento | **P1** |
| Tienes un pedido sugerido para revisar | compradores de la cuenta | Aviso y correo | Evento, **Pantalla** | **P1** |
| Te enviaron una cotización | compradores de la cuenta | Aviso y correo | Evento, Pantalla | P2 |
| Tu cotización vence pronto | compradores de la cuenta | Aviso | Programada | P3 |

> Los dos avisos de vínculo resuelven lo que pasó el 2026-09-12: una persona vinculada como
> «Invitado» entró a la tienda y leyó «no estás vinculado a ninguna empresa», sin saber que solo le
> faltaba la activación.

#### Crédito y cuenta

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Se emitió tu factura | la cuenta B2B | Correo | Evento | P2 |
| Tienes una cuota por vencer | la cuenta B2B | Aviso y correo | Programada | P2 |
| Tienes una cuota vencida | la cuenta B2B | Aviso y correo | Programada | P2 |
| Tu cuenta tiene el crédito bloqueado | la cuenta B2B | Aviso | Evento | P2 |

#### Devoluciones y dinero

| Aviso | Quién lo recibe | Canal | Base | Prioridad |
|---|---|---|---|---|
| Recibimos tu devolución | el comprador | Aviso y correo | Evento | P2 |
| Emitimos tu reembolso | el comprador | Aviso y correo | Hoy | P2 |
| Tu tarjeta regalo vence pronto | el titular | Correo | Programada | P3 |

#### Marketing — exige consentimiento

| Aviso | Canal | Base | Prioridad |
|---|---|---|---|
| Dejaste productos en el carrito | Correo | Programada | P3 |
| Un favorito volvió a tener stock | Aviso y correo | Evento | P3 |
| Un favorito bajó de precio | Aviso y correo | Evento | P3 |

Ninguno de estos se envía sin que el comprador lo haya aceptado expresamente. No es un ajuste de
producto: es una obligación legal sobre comunicaciones comerciales.

---

## 5. Reglas de diseño que se proponen

1. **El destinatario lo decide el servidor.** Se deriva del rol, de la cartera del vendedor o del
   vínculo con la cuenta B2B. Nadie se suscribe a los avisos de otro mandando un id.
2. **Aislamiento por tenant y por persona.** Cada aviso lleva `organization_id` y `company_id` y
   la RLS solo deja leer los propios. Un `@ebim.pe` nunca es destinatario de negocio.
3. **Solo módulos contratados.** Sin la capacidad activa no hay aviso, igual que no hay pantalla.
4. **Un hecho, un aviso.** Se reutiliza la deduplicación de `domain_events`: un reintento no avisa
   dos veces.
5. **El aviso enlaza, no copia.** Guarda el tipo y el enlace al objeto; el detalle se lee con la RLS
   de siempre. Así un aviso viejo no enseña datos que el usuario ya no tiene derecho a ver.
6. **Plantilla con variables, nunca texto armado en el dominio**, como fija el puerto. El texto se
   traduce y se cambia sin desplegar.
7. **Resumen para lo repetitivo.** Cincuenta productos bajo mínimo son **un** aviso diario, no
   cincuenta.
8. **Preferencias por persona** para silenciar tipos, salvo los de seguridad, que no se silencian.
9. **Leído y archivado**, no borrado, para poder responder quién se enteró de qué y cuándo.

---

## 6. Entregas propuestas

| Entrega | Contenido | Depende de |
|---|---|---|
| **1. Núcleo** | Tabla de avisos con RLS, consumidor de `domain_events`, campanita del backoffice, avisos en «Tu cuenta», envío por Graph con botón «Probar», revertir Resend | Que el operador cargue los secretos `MS_*` y cree el buzón `ecommerce@grupoebim.com` |
| **2. Avisos P1** | Todos los marcados **P1** arriba, incluido el sugerido | Entrega 1. Para el sugerido, además, que el comprador pueda verlo en su cuenta |
| **3. Programados y P2** | Vencimientos, stock bajo, resúmenes diarios y el resto de P2 | El ejecutor de tareas programadas, deuda **D5** |
| **4. Preferencias y marketing** | Silenciar por tipo, consentimiento y los avisos P3 | Entregas 1 a 3 |

---

## 7. Decisiones que necesita tomar el operador

1. **Buzón de envío.** Confirmar `ecommerce@grupoebim.com` y que se añada a la Application Access
   Policy de suite. Sin eso no sale ningún correo que cumpla §14.
2. **Nombre en los correos al comprador.** El contrato pide «eCommerce by EBIM» como remitente,
   pero el comprador de Química Suiza no conoce a EBIM. Se propone mantener ese remitente y poner
   el nombre y el logo de la tienda **dentro** del correo. Si se quiere el nombre de la tienda en el
   remitente, es un cambio de contrato y va al buzón de coordinación antes de codificar.
3. **Sugerido visible para el comprador.** Avisar «tienes un sugerido» solo tiene sentido si el
   comprador puede abrirlo y aceptarlo desde su cuenta. Hoy no puede, y aceptar tampoco crea pedido.
4. **Alcance de la primera entrega.** Confirmar la lista P1 o recortarla.

---

## 8. Pendientes que salen de este análisis

- **Revertir la configuración de Resend** del 2026-09-12 por incumplir §14.
- **Aviso de suite `gmao-037`**, dirigido a todas las apps: eCommerce aplicó la contraseña
  `Demo2026!` a las cuentas **nuevas**, pero no la parte B, que es ponerla a las cuentas
  **existentes** con el script que corre el operador. Tampoco hay respuesta firmada en el buzón.
