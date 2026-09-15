# Progreso — cierre del plan eCommerce B2C+B2B

Plan de origen: `docs/PROMPT_CLAUDE_OPUS_5_CIERRE_ECOMMERCE.md`.

- **BASE_SHA:** `5e3da4ec0df9a7df62f4b8b948944ff0cefa1e7d` (rama `dev`, árbol limpio)
- **Node / npm:** v22.12.0 / 10.9.0
- **Supabase:** proyecto enlazado DEV/QAS `ehxlxbhtlmfgneiagdcj`. Docker no disponible (sin stack local).
- **Deno:** no instalado en la máquina. Supabase CLI sí (`supabase.exe`).
- **Playwright:** `@playwright/test ^1.63.0` y `playwright.config.ts` presentes; sin script npm.

Este archivo lo escribe un solo dueño (el coordinador). Los carriles reportan y el coordinador actualiza.

Estados: `[COMPLETADO]` · `[EN PROGRESO]` · `[PENDIENTE]` · `[BLOQUEADO]`

---

## Matriz verificada contra el código (14/09/2026)

Cada veredicto sale de migraciones, funciones y tests, no de documentación.

| # | Punto | Veredicto | Evidencia clave |
|---|---|---|---|
| 1 | Credit block | **Falta** | `credit_status` existe (`20260902120000_credit_receivables.sql:39-46`); su comentario promete un gancho de checkout que nunca se escribió. `create_order` y `pipeline.ts` no lo leen. |
| 2 | Approval inbox | **Parcial** | `order_approval_decide` existe con tests (`20260828110400_order_commands.sql:227`); repetir la decisión lanza `APROBACION_NO_APLICA`. Sin bandeja en la tienda: `MyOrdersSection` solo lista. |
| 3 | Quote → Order | **Falta** | Esquema de cotizaciones sin conversión; `quotes.order_id` sin escritor; RLS sin acceso del comprador; `create_order` rechaza precio en el cuerpo. |
| 4 | Scheduled Orders | **Parcial** | Tablas y `order_schedule_advance()` existen; solo avanza la fecha; sin runner, API ni UI. El checkout exige JWT del comprador. |
| 5 | Quick Order | **Falta** | SKU no expuesto en la tienda; `cart_replace_lines` rechaza la clave `sku`. |
| 6 | Bulk CSV | **Falta** | Patrón reutilizable en `src/features/pricing/importCsv.ts`. |
| 6b | Reorder | **Parcial** | Funciona para consumidor; en B2B no aparece (`StoreAccountPage` no pasa `storeId`, detalle sin `product_id`). |
| 7 | Channels admin | **Parcial** | Tabla, RLS y default existen; front solo lectura en pricing. |
| 8 | Abandoned Cart Recovery | **Falta** | Datos y evento de analítica existen; sin workflow; carritos invitados sin contacto; sin consentimiento. |
| 9 | Product Relations | **Parcial** | Tabla y alta en PIM; PDP usa relacionados por categoría; sin lectura pública. |
| 10 | Reviews | **Falta** | Nada en esquema ni en `src/`. |
| 11 | Suggested Orders v2 | **Parcial** | Solo `historic_v1`; sin assortment, ATP ni estacionalidad. |
| 12 | invoice.issue | **Parcial** | Outbox, puerto y proveedor declarados; sin productor. |
| 13 | Capability guards | **Falta** | `catalog.advanced`, `payments`, `fulfillment` en `SIN_CANDADO_DE_SERVIDOR`. Cerrarlos sin sembrar entitlements apaga el módulo a todos los tenants. |
| 14 | check:edge | **Falta** | Sin script; Deno no instalado. |
| 15 | E2E / certificación | **Existe (sin re-ejecutar)** | 56/56 documentado en `docs/release-candidate/FINAL_CERTIFICATION.md:71`. |

## Carriles

| Carril | Dueño | Alcance | Rango de migraciones |
|---|---|---|---|
| A — Checkout compartido | coordinador, árbol principal | 1 Credit block, luego 3 Quote → Order | `20260914100000`–`20260914109999` |
| B — Portal B2B | subagente, worktree | 2 Approval inbox, 6b Reorder B2B | `20260914110000`–`20260914119999` |
| C — Pedidos avanzados | subagente, worktree | 5 Quick Order, 6 Bulk CSV | `20260914120000`–`20260914129999` |

Reglas de propiedad: **solo el carril A** redefine `create_order`, `checkout_place_order` o toca `supabase/functions/_shared/checkout/`. Integración en orden A → C → B.

---

## P0

### 0. Aislamiento de gates — [COMPLETADO] `a0068ef`
- Hallazgo: los worktrees paralelos viven en `.claude/worktrees` y Vitest y ESLint los recogían, duplicando la suite con código de otra rama.
- Archivos modificados: `vite.config.ts` (exclude `.claude/**`), `eslint.config.js`, `.gitignore`.
- Pruebas ejecutadas: `npx vitest list --filesOnly` → 207 archivos, 0 bajo `.claude`; `npm run lint` limpio.

### 1. Credit Block en checkout server-side — [COMPLETADO] `fe2e87a`
- Diseño: **autoridad** = trigger `before insert` en `orders` (`ebim.assert_order_account_credit_open`), cubre pipeline, `create_order_for_slug`, API enterprise e inserts de servidor. **Aviso temprano** = etapa 2 del pipeline (`validate_account`), antes de precio, reserva y pago. `watch` no bloquea. Solo afecta a la inserción.
- Archivos modificados:
  - `supabase/migrations/20260914100000_credit_block_checkout.sql` (nueva): trigger + `my_effective_business_account_for_slug` con `credit_status`.
  - `supabase/functions/_shared/checkout/ports.ts`, `dbPorts.ts`, `pipeline.ts`, `errors.ts` (`CREDITO_BLOQUEADO` = 403, no reintentable).
  - `src/features/storefront/checkout.ts`, `src/shared/i18n/messages.{es,en}.ts`.
  - `supabase/tests/credit-block.test.ts` (nueva, 11 pruebas).
  - `supabase/tests/fulfillment.test.ts`: el test de despacho con crédito bloqueado creaba el pedido con la cuenta ya bloqueada (imposible desde A1). Reordenado: pedido al día, bloqueo después. Sigue probando lo mismo.
- Pruebas ejecutadas:
  - A1 + checkout afectado (6 archivos): **149/149**.
  - Guardas transversales + vitrina + OMS + crédito (52 archivos): **827/827**.
  - `tsc --noEmit` limpio, `npm run lint` limpio.
- Resultado: comprador bloqueado rechazado en etapa 2 sin pedido, líneas, reserva ni intento de pago; `create_order` directo e `insert` directo con `service_role` también rechazados; `watch`, otra cuenta al día e invitado compran; desbloquear restaura.
- Pendientes / riesgos:
  - **Riesgo residual:** si `my_effective_business_account_for_slug` falla por error transitorio, el pipeline compra como anónimo por diseño previo (fail-open). El pedido nace sin cuenta, sin crédito ni precio de convenio. No se cambia: cerrarlo dejaría sin comprar a todo B2B ante cualquier caída.
  - **Decisión de negocio abierta:** el bloqueo impide también pedidos prepagados de una cuenta retenida. Es lo que pide el plan; confirmar con cobranzas.
  - Migración **no aplicada** en DEV/QAS.

### 2. Approval Portal B2B — [COMPLETADO] `bae16bc`, `707e044` (carril B, integrado en `200d7f3`)
- Diseño: reutiliza `order_approval_decide`; no hay segundo motor de aprobación. La **misma decisión repetida** devuelve el resultado guardado (`already_decided`) sin reescribir firma ni republicar el evento; la **contraria** sigue lanzando `APROBACION_NO_APLICA`. La repetición pasa antes por todas las autorizaciones, para no revelar el estado de un pedido ajeno.
- Archivos modificados:
  - `supabase/migrations/20260914110000_approval_inbox.sql` (nueva): `order_approval_decide`, `my_business_order_detail` (+ `approval_status`, `can_decide` de servidor, firma, motivo, `product_id`/`variant_id`), `my_business_orders` (+ `purchase_order_number`, `buyer_email` solo para quien decide).
  - `src/features/storefront/portal.ts`, `account/approvals.ts`, `account/MyApprovalsSection.tsx`, `account/MyOrderDrawer.tsx`, `StoreAccountPage.tsx` (pestaña «Aprobaciones» + `storeId` a `MyOrdersSection`), i18n ES/EN.
  - Tests: `supabase/tests/approval-inbox.test.ts` (13), `src/features/storefront/account/approvals-inbox.test.tsx` (12).
- Pruebas ejecutadas (carril): SQL 7 archivos **123/123**; UI 10 archivos **159/159**; `tsc` y `lint` limpios. Con la migración retirada fallan 9 de las 13 SQL: prueban el comportamiento nuevo.
- Resultado: approver de la cuenta A no ve ni decide pedidos de la B; buyer y viewer no deciden aunque llamen a la RPC; doble clic = una llamada; errores traducidos por código.
- Pendientes / hallazgos:
  - **Hallazgo (decisión de negocio):** un `admin` de la cuenta puede aprobar su propio pedido. Sin separación de funciones. No se cambió; un test fija la política vigente para que cualquier cambio sea deliberado.
  - La página de cuenta consulta la cola de pendientes para cada usuario B2B (una RPC más por carga).

### 6b. Reorder B2B — [COMPLETADO] (carril B)
- `StoreAccountPage` pasa `storeId` a `MyOrdersSection` y el detalle devuelve `product_id`/`variant_id`: «Volver a comprar» aparece para B2B y sigue pasando por el carrito.

### 3. Quote → Order idempotente — [COMPLETADO] `e54b4a8`, `4f050c2` + pestaña en la integración
- **Decisión explícita: aceptar crea un ACUERDO DE PRECIO + líneas para el carrito, NO un pedido.** `create_order` nunca acepta precio del llamante; copiar importes obligaría a abrir esa puerta, y un pedido desde SQL se saltaría surtido, ATP, crédito, OC y aprobación. La cotización aceptada se convierte en una lista de alcance `customer` (el de mayor precedencia del motor existente), vigente hasta `valid_until`. No hay segundo motor de precio.
- Por qué el precio no se escapa: `min_quantity` = cantidad cotizada en unidades base; la lista se **cierra** al primer pedido que la usa; vigencia = la de la cotización.
- **Enlace pedido ↔ cotización por trigger DIFERIDO al commit**: `create_order` resuelve el precio línea a línea en su bucle, así que cerrar la lista al insertar la primera línea cobraría la segunda a catálogo. El trigger bloquea la cotización `for update`: un segundo pedido que intente el mismo precio aborta al confirmar.
- Las listas nacidas de cotización las gobierna `trade.quotes`, no `pricing.lists` (`ebim.active_price_lists` redefinida con las mismas columnas).
- Archivos modificados:
  - `supabase/migrations/20260914101000_quote_to_order.sql` (nueva): `price_lists.source_quote_id`, firma de aceptación en `quotes`, vista de listas activas, `ebim.quote_buyer`, `public.my_quotes`, `public.accept_quote`, `public.request_quote`, `ebim.link_order_to_quote` (constraint trigger diferido).
  - `src/features/storefront/quotes.ts`, `account/MyQuotesSection.tsx`, `cart/RequestQuoteButton.tsx`, `StoreCartPage.tsx`, `StoreAccountPage.tsx` (pestaña «Cotizaciones», ancla `#cotizaciones`), `src/shared/lib/db-schema.ts`, i18n ES/EN.
  - Tests: `supabase/tests/quote-to-order.test.ts` (20), `src/features/storefront/account/my-quotes.test.tsx` (9).
- Pruebas ejecutadas:
  - A3 SQL: **20/20**, sobre el checkout de producción (`runCheckout` + `createDbPorts`), con `trade.quotes` y SIN `pricing.lists`.
  - Precios, promociones, checkout, cotizaciones y guardas (31 archivos): **825/825** (3 suites cayeron por tiempo de arranque con 31 bases en paralelo; solas, 169/169).
  - Vitrina + i18n + arquitectura (47 archivos): **681/681**. `tsc`, `lint` limpios.
- Resultado: dos aceptaciones = una lista y un evento; pedido con cantidades cotizadas cobra el precio en TODAS las líneas; segundo pedido a catálogo; 3 de 10 unidades a catálogo y cotización sigue viva; vencida, borrador, otra moneda, cantidad no entera, otro cliente y lector fallan sin escribir nada; anónimo sin EXECUTE; solicitud idempotente por clave, clave ajena = conflicto, precio en la línea = `CAMPO_NO_PERMITIDO`.
- Pendientes / hallazgos:
  - **Brecha transversal (P1, afecta a 3, 5 y 6):** el carrito de la vitrina recorta cada línea a `MAX_LINE_QUANTITY = 99` y no guarda presentación. Una cotización de >99 unidades o con presentación **no se ofrece para aceptar** (se explica al comprador) porque el acuerdo no se alcanzaría y cobraría a catálogo sin avisar. El carril C valida el mismo tope en pedido rápido y CSV. Requiere decisión de producto: tope por línea para compradores B2B.
  - Un pedido que use el precio de solo parte de las líneas cotizadas convierte la cotización entera. Documentado; la UI pasa siempre todas las líneas.
  - La cotización convertida no se "desconvierte" si el pedido se cancela.
  - Migraciones **no aplicadas** en DEV/QAS.

## P1

### 4. Scheduled Orders — [COMPLETADO] `ae2f295`
- **Decisión explícita: el runner PREPARA y AVISA; no crea pedidos.** El checkout exige el JWT del comprador (cuenta efectiva, precio de convenio, crédito, OC, aprobación) y un pedido desde SQL a las 03:00 se saltaría todo eso. Se respeta la regla de `20260902150000`: `order_templates`, `order_schedules` y `order_schedule_advance()` no se reemplazan.
- Runner `ebim.run_order_schedules(limit)` (solo `service_role`, pg_cron cada hora, guardado por disponibilidad):
  - reclama vencidas con `for update of s skip locked`; `order_schedule_runs` único `(schedule_id, run_on)`; propuesta + aviso + evento + avance en la MISMA transacción → dos pasadas = una propuesta y un aviso;
  - motivo de negocio (tienda inactiva, plantilla archivada, sin módulo, sin líneas, cliente inactivo, nadie a quien avisar) → `skipped` y avanza;
  - error técnico → bloque deshecho, `failed` con espera 5 min·2ⁿ⁻¹ (tope 6 h); a los 5 intentos `dead` y deja de reclamarse;
  - la propuesta `ready` anterior no usada pasa a `expired`;
  - aviso `order_schedule.run_ready` a `admin`/`buyer` de la cuenta (enlace `#programados`) y hecho de dominio con la misma clave.
- Comprador (definer; tienda por slug, cuenta por `ebim.effective_business_account`, módulo `orders.advanced` por `company_is_entitled`): `my_order_schedules`, `save_my_order_schedule` (alta idempotente por clave; líneas validadas como el pedido rápido: publicado, variante, canal, moneda, surtido; campos fuera de lista = `CAMPO_NO_PERMITIDO`), `set_my_order_schedule_status` (reanudar no dispara lo perdido), `archive_my_order_schedule`, `take_my_order_schedule_run` (devuelve qué y cuánto; repetible), `dismiss_my_order_schedule_run`. Lector ve y no gestiona. Ajeno e inexistente responden lo mismo.
- Archivos modificados:
  - `supabase/migrations/20260914130000_scheduled_orders.sql`, `20260914130100_scheduled_orders_schedule.sql` (nuevas; aditivas: `order_templates.created_by`/`request_key`).
  - `src/features/storefront/scheduledOrders.ts`, `account/MyScheduledOrdersSection.tsx`, `account/ScheduleDialog.tsx`, `cart/ScheduleCartButton.tsx`, `StoreAccountPage.tsx` (pestaña «Programados»), `StoreCartPage.tsx`, `notifications/text.ts`, `db-schema.ts`, i18n ES/EN.
  - Tests: `supabase/tests/scheduled-orders.test.ts` (20), `account/scheduled-orders.test.tsx` (14), `notifications-ui.test.tsx` (tipo nuevo).
- Pruebas ejecutadas: SQL **20/20** (incluye propuesta → `runCheckout` de producción con precio del motor y cuenta B2B); seguridad/capacidades/RLS/orders-advanced/notificaciones **161/161**; vitrina + arquitectura + i18n + invariantes **148/148**; `tsc` y `lint` limpios.
- Pendientes / riesgos:
  - Solo aviso en la app; **sin correo** (no hay plantilla `order_schedule.run_ready` en `notifications-dispatch`).
  - `current_date` es la del servidor (UTC); la UI pide primera fecha desde mañana para no chocar a última hora en Lima.
  - Sin pantalla de backoffice para las ejecuciones: el personal las lee por RLS (`order_schedule_runs`), no hay vista.
  - Mismo tope transversal de 99 por línea: una plantilla que lo supere se avisa y no se ofrece al carrito.
  - Migraciones **no aplicadas** en DEV/QAS.

### 5. Quick Order — [COMPLETADO] `1debe36`, `0cc6cdd`, `fcc5184` (carril C, integrado en `377691d`)
### 6. Bulk CSV Orders — [COMPLETADO] (mismos commits)
- Diseño: resolver de SKU en servidor `public.resolve_order_lines_for_slug` (definer, solo `authenticated`, sin EXECUTE a `anon`); variante antes que producto; SKU oculto, borrador o de otro tenant = `SKU_NO_ENCONTRADO` (no revela productos ocultos); surtido de la cuenta efectiva cuando la sociedad tiene `trade.assortments`; **nunca** devuelve precio, coste, moneda ni stock; no escribe carrito ni pedido. Todo termina en el carrito oficial.
- Duplicados **rechazados**, no sumados. Cantidad 1–99 en navegador (`CANTIDAD_MAXIMA`) por el tope del carrito. **Reimportar no duplica:** la importación FIJA la cantidad del archivo (nuevo → añadir, distinta → `setQuantity`, igual → nada) y no borra lo que no está en el archivo. Números de fila = los del archivo.
- Archivos modificados: `supabase/migrations/20260914120000_quick_order_sku_resolver.sql` (nueva); `src/features/storefront/quick-order/{lines,api,importToCart,QuickOrderPage}.ts(x)`; `src/app/routes.tsx` (`/s/:storeSlug/pedido-rapido`) y `routes.test.tsx`; botón en `StoreAccountPage.tsx` y `account/ConsumerAccount.tsx`; `db-schema.ts`; i18n ES/EN.
- Pruebas ejecutadas (carril): resolver SQL **28/28**, unidad **22/22**, UI **10/10**; guardas (`schema-invariants`, `capability-enforcement`, `public-rpc-gates`, `security-baseline`, i18n, arquitectura, rutas) en verde; suite completa del carril 3978/3978 tests.
- Pendientes / hallazgos:
  - **Riesgo (DoS):** el límite de SKUs no encontrados (`quick_order.sku_probe`, 300/h) es **por tienda**, no por usuario: un abusador puede bloquear la validación de pedido rápido a todos los compradores de esa tienda durante una hora. El carrito y el checkout no se ven afectados.
  - `robots.txt` no lista `/pedido-rapido` (la página sí pone `noindex`); un test fija «cuatro rutas privadas».
  - Sin verificación visual ni en navegador real.

### Hallazgos de integración (coordinador)
- Los worktrees se crearon en `38cf8a6`, un commit de docs por detrás; los dos carriles avanzaron a `5e3da4e` limpios antes de trabajar.
- El junction de `node_modules` en un worktree exige `D:` en mayúscula: con `d:` Vitest carga dos copias de sí mismo.
- En los worktrees, `scripts/qas-smoke.test.mjs` y `scripts/secret-scan.test.mjs` fallan al cargar por el shebang con CRLF del checkout. Pendiente de confirmar en el árbol principal con la suite completa.
- `scripts/demo-preflight.mjs` enumera migraciones solo hasta `20260913160000`: no conoce las nuevas.
- Las dos integraciones (C y B) fusionaron sin conflictos; `tsc`, `lint` y `build` limpios sobre el árbol integrado.

## P2

### 7. Channels Admin — [COMPLETADO] `a9d52ad` (carril D2, integrado en `a9a5129`)
- Pantalla `/app/channels` (owner/admin, permiso `store.manage`, grupo Catálogo): buscador único, alta/edición (el `requires_auth` se deriva del tipo), activar/desactivar, resumen de catálogo por canal.
- `public.channel_set_default(p_channel_id)`: definer con autorización interna owner/admin del tenant; bloquea los canales de la tienda; destino **activo y B2C** (un defecto B2B dejaría sin vender a la vitrina pública, que depende de `ebim.public_channel`); idempotente. Canal ajeno e inexistente responden igual.
- Trigger `ebim.guard_channel_write` (solo `authenticated`): impide desactivar, cerrar a B2B, borrar o mover el canal por defecto y cambiar `is_default` a mano.
- Migración `20260914150000_channels_admin.sql`. Tests: `channels-admin.test.ts` (17), `channels-ui.test.tsx` (12).
- Riesgo: la exención del guard se apoya en `current_user`; verificado en PGlite, no en Supabase real.

### 8. Abandoned Cart Recovery — [COMPLETADO · condicionado a base legal] `633c8bb`, `f7b83df`, `0effee5` (carril D3, integrado en `eeac6ec`)
- **Condición externa:** no hay dato de consentimiento de marketing en el esquema. El ajuste por tienda nace **APAGADO**; el dueño legal/negocio debe confirmar la base legal antes de encenderlo.
- Elegibilidad: solo comprador autenticado con correo de Auth (nunca `@ebim.pe`), carrito activo/abandonado con líneas, inactividad entre ventana (4 h, 1–72) y edad máxima (7 d, 1–30), tienda activa y ajuste encendido. **Invitados nunca.**
- Supresión centralizada (`ebim.cart_recovery_block_reason`): convertido, fusionado, vaciado, nueva actividad, demasiado viejo, tienda apagada, sin contacto, baja, pedido posterior no cancelado o carrito más nuevo del mismo usuario.
- **Guardia al enviar:** `public.notification_email_claim` redefinida con un paso previo que caduca con `SUPRIMIDO` lo que ya no califica. Worker sin cambios, sin segunda cola.
- Idempotencia: episodio `(cart_id, last_activity_at)` único + clave de cola. Dos ejecuciones = un correo.
- Baja de un clic con secreto de 244 bits guardado como sha256; la RPC pública solo devuelve booleano y solo da de baja a ese destinatario en esa tienda; la página pide confirmar. También desde Tu cuenta → Avisos.
- Observabilidad `cart_recovery_overview` (30 días). pg_cron cada 15 min, 200 carritos, sin secretos.
- Migraciones `20260914160000_cart_recovery.sql`, `20260914160100_cart_recovery_schedule.sql`. Tests: 46 + 9 + 8. `security-baseline` → 21 funciones anónimas.
- Riesgos: sin retención de filas de recordatorio; secretos de baja sin caducidad; sin cabecera `List-Unsubscribe`; entrega real depende de Graph y Vault.

### 9. Product Relations — [COMPLETADO] `d76e294`, `fd1c610` (carril D1, integrado en `4a0da56`)
- `public.product_relations_for_slug(slug, product, kinds, limit)` (anon): solo ids de relacionados publicados, visibles en el canal público y de la misma tienda; tope 24; tipo desconocido = `TIPO_RELACION_INVALIDO`.
- Ficha: «Completa tu compra» (cross-sell, accesorio, repuesto), «Mejora tu elección» (up-sell), «También te puede interesar» (relacionado, sustituto). El relleno por categoría solo si no hay curados o la función falla, sin repetir.
- PIM: subir, bajar y quitar con la RLS existente (sin función nueva).
- Migración `20260914140000_storefront_product_relations.sql`. Tests: SQL 17, UI 6 + 5.

### 10. Reviews — [COMPLETADO] `2f93f98`, `255f3c9` (carril D1, integrado en `4a0da56`)
- `product_reviews` con RLS forzada; sin escritura directa. `submit_product_review` (sesión; solo rating/título/cuerpo/nombre; `verified_purchase` lo pone el servidor por `order_buyers` + `order_items`, excluye cancelados y reembolsados; cada edición vuelve a pendiente; el personal no reseña su catálogo; 10/h por usuario y techo por tienda). `product_reviews_for_slug` (anon, solo publicadas + resumen calculado). `moderate_product_review` (owner/admin/catalog, motivo al rechazar, `audit_log`).
- Ficha: resumen, lista paginada, «Compra verificada», formulario con estado propio. Backoffice `/app/reviews` (capacidad `catalog`, permiso `catalog.write`) con pestañas, buscador y exportar.
- Migración `20260914141000_product_reviews.sql`. Tests: SQL 38, UI 14 + 5.
- Riesgos: el techo por tienda es compartido (un abusador puede frenar a otros durante una hora, igual que en pedido rápido); exportar CSV sin test.

### Integración D1 — verificada (`4a0da56`)
- Conflicto en la superficie anónima (D1 +2 publicado, D3 +1 secreto): resuelta a **23 = 12 publicado · 8 secreto · 2 techo · 1 recogido** en `security-baseline.test.ts` y `docs/SECURITY_BASELINE.md` §1.6. Resto fusionado solo.
- Sobre el árbol integrado: `tsc` y `lint` limpios; D1 + programados + guardas (`security-baseline`, `capability-enforcement`, `public-rpc-gates`, `schema-invariants`, rutas, i18n, arquitectura, navegación, admin): **21 archivos, 317/317**.

### 11. Suggested Orders v2 — [COMPLETADO] `36dff86` (carril D2)
- `suggest_order_v2` explicable con respaldo `historic_v1`. Dos ventanas (reciente `p_days` 7–180; larga máx(3R, 90); 60 % reciente + 40 % larga). Estacionalidad solo con ≥1 año de historia, ≥3 pedidos y ventas en el año; factor acotado [0.5, 2]; si no, 1 con motivo.
- Filtros antes de cantidad: publicado, variante activa, surtido, visibilidad por canal. ATP: stock conocido recorta; sin stock → `shortage` (se muestra, no se guarda); desconocido o con backorder → no recorta y lo dice.
- `saveSuggestion` guarda `model_code` y `on_hand_quantity`.
- Migración `20260914151000_suggest_order_v2.sql`. Tests: 17 SQL + 4 UI.
- Riesgos: sin conversión de unidades (igual que v1); con `service_role` el ATP sale desconocido.

### Integración D2 + D3 — verificada
- Fusiones sin conflictos. Sobre el árbol integrado: `tsc` y `lint` limpios; rutas, i18n, arquitectura, navegación, `security-baseline`, `capability-enforcement`, `schema-invariants`, `public-rpc-gates` y pruebas nuevas: **17 archivos, 284/284**.

## P3

### 12. invoice.issue — [EN PROGRESO] (carril E1, worktree; rango `20260914170000`–`179999`; incluye revisión D2 pagos/fulfillment)
### 13. Capability guards — [EN PROGRESO] (carril E2, worktree; rango `20260914180000`–`189999`)

### 14. check:edge — [COMPLETADO] `ddc9423`
- `npm run check:edge` → `scripts/check-edge.mjs`: `deno check` de **todos** los `.ts` de `supabase/functions` (67: entradas, `_runtime`, `_shared`; sin `*.test.ts`), con configuración propia `scripts/deno.check.json` (strict, `nodeModulesDir: none`) para no heredar el `tsconfig` del frontend ni cambiar el despliegue.
- Deno: `DENO_BIN` → `deno` del PATH → paquete oficial npm `deno@2.9.6` fijado (vía `npx`, sin shell). Sin archivos o sin Deno sale con 1: nunca es no-op.
- No se añadió como devDependency: `engine-strict` rechaza la instalación en Node 22.12 por `eslint-visitor-keys@5` (exige ≥22.13). **Hallazgo:** el contrato `engines.node >=22.12` ya no se sostiene con el árbol actual para instalaciones nuevas; revisar `.nvmrc`/engines antes de `npm ci` en CI.
- **Defectos reales encontrados en la primera pasada y corregidos:** `catalog-copy` lanzaba `notFound` con el texto como código (el navegador recibía una frase); `_shared/userProvisioning.ts` no compilaba con TS 6 de Deno.
- Pruebas: verde sobre el árbol; **rojo (exit 1) con un error de tipos plantado** y retirado; `scripts/check-edge.test.mjs` 7/7; `create-user`, catálogo, `secret-scan`, `qas-smoke`: 198/198; `tsc` y `lint` limpios.
- Pendiente: la primera ejecución sin caché descarga Deno y los `npm:` del borde (red necesaria en CI).
### 15. E2E y certificación final P07/P08 — [PENDIENTE]
