# Deployment manifest — cierre del plan eCommerce

> **Nada de esto está desplegado.** Es la lista exacta, en orden, de lo que hay que llevar a QAS. Ningún paso se
> ejecutó contra DEV/QAS/PRD. El manifiesto del RC anterior (2026-09-13, siete migraciones `20260913*`) está en el
> historial (`0395ca3`) y es **prerrequisito** de este.

## Base

| Dato | Valor |
|---|---|
| Rama | `dev` |
| Base del plan | `5e3da4e` |
| Commit certificado | `c5066af` (ver `FINAL_CERTIFICATION.md`) |
| Node | contrato `engines` ≥ 22.12, recomendado 24 (`.nvmrc`). **Ver §0: el árbol actual exige ≥ 22.13 para instalar.** |
| `package-lock.json` SHA-256 | `78a8dd13afccec3b5250b266572ed461d5ddbcf65f931309d155bf59328e1700` (idéntico al RC anterior) |

## 0 · Antes de empezar

- [ ] Fusionar/promover `dev` por el camino habitual (no hecho desde aquí).
- [ ] Confirmar que QAS tiene aplicadas las migraciones hasta `20260913160000_consumer_addresses.sql` (manifiesto
  del RC anterior). Comprobarlo por objetos o con el preflight: `scripts/aplicar-migracion.mjs` no lleva tabla de
  control.
- [ ] **Candados de capacidad (migraciones 14–17):** listar los tenants que YA tienen fila en
  `tenant_platform_context` y comprobar que sus `tenant_entitlements` incluyen `ecommerce.payments`,
  `ecommerce.fulfillment` y `ecommerce.catalog.advanced` si usan esos módulos. Un tenant sincronizado sin ellos
  **pierde** esos módulos al aplicar; uno nunca sincronizado los conserva.
- [x] **Versión de Postgres.** Comprobado el 2026-09-15: el proyecto enlazado `ehxlxbhtlmfgneiagdcj` corre
  **PostgreSQL 17.6**, la misma versión de la certificación local (el «15» venía de un documento anterior).
- [ ] **Node del build:** `engine-strict=true` + una dependencia de ESLint (`eslint-visitor-keys@5`) exigen Node
  ≥ 22.13; `npm ci` falla en 22.12. Usar Node 24 (`RUNTIME.md`) o subir `engines`.
- [ ] Ventana sin tráfico de compra: la migración 1 añade un trigger a `orders` y la 19 recrea `cart_open`.

## 1 · Migraciones (en este orden, una a una)

`node scripts/aplicar-migracion.mjs supabase/migrations/<archivo>`. SHA-256 del contenido versionado
(`git cat-file -p HEAD:<ruta> | shasum -a 256`; el árbol de trabajo en Windows tiene CRLF y da otro hash).

| # | Archivo | SHA-256 | Qué cambia |
|---|---|---|---|
| 1 | `20260914100000_credit_block_checkout.sql` | `a73594248f133375a073f2d2185a9cc92037f2d751166cf78e35148c06e0659d` | trigger `orders_assert_account_credit_open`; `my_effective_business_account_for_slug` + `credit_status` |
| 2 | `20260914101000_quote_to_order.sql` | `60caaa237c53358a804016473361a940055a7109ff5a0c5898af7d7d79eeb78a` | `price_lists.source_quote_id`, columnas de aceptación en `quotes`, vista `active_price_lists`, `my_quotes`, `accept_quote`, `request_quote`, trigger diferido de enlace pedido↔cotización |
| 3 | `20260914110000_approval_inbox.sql` | `066f9dfe55ffe085207e266d2a613f2095bae91ba6b4d015dc285d6f6ab529fd` | `order_approval_decide` idempotente; `my_business_order_detail`, `my_business_orders` |
| 4 | `20260914120000_quick_order_sku_resolver.sql` | `8d7d621a0c52c120de5cda443c19f5a43f8214fc2a15075f2b1d5feddb74999d` | `resolve_order_lines_for_slug` |
| 5 | `20260914130000_scheduled_orders.sql` | `c600c495461dd2b7e2bd7ced7360f46a0c071540ecfc24c43a0c7f3f185fb494` | `order_schedule_runs`, `ebim.run_order_schedules`, 6 RPC del comprador; `order_templates.created_by/request_key` |
| 6 | `20260914130100_scheduled_orders_schedule.sql` | `7bb15aca73fe9e16bbff0b2d6d793a3d0c2424b51ee034aa8e2b60d24e586262` | pg_cron `ecommerce-order-schedules` (cada hora) |
| 7 | `20260914140000_storefront_product_relations.sql` | `a483cf3ba595f1a9c78aac4ec3f95adf60e5277544496f17c392e14f0c3aadca` | `product_relations_for_slug` (anon) |
| 8 | `20260914141000_product_reviews.sql` | `d0d1b57ec13b774cf60ca37daa41b86bff2ac23249f0c405f774431f67d753fc` | `product_reviews` + 4 RPC (una anon) |
| 9 | `20260914150000_channels_admin.sql` | `755aee111f28528f6a219060e0d35ead089c990f83b808467a0ca71d62b514b8` | `channel_set_default`, trigger `guard_channel_write` |
| 10 | `20260914151000_suggest_order_v2.sql` | `7364d401b77c7375c0316cda978d65568c3fef41ef8f54165803791f8dbf9208` | `suggest_order_v2` |
| 11 | `20260914160000_cart_recovery.sql` | `e4884b1bf222e0d1a1617999a5df126564b0c7c2c88dac4a0ac2b63e141d0f76` | ajustes por tienda (apagados), bajas, recordatorios; **recrea `notification_email_claim`** |
| 12 | `20260914160100_cart_recovery_schedule.sql` | `cfcf89ca3e86302514cc610034f358b2ff68b072e4787c7256d5064bde452304` | pg_cron `ecommerce-cart-recovery` (cada 15 min) |
| 13 | `20260914170000_invoice_issue_producer.sql` | `cf4726626ea0fca227f7b16f88e481ed6aa142b693c1a2199c0a763ef07d01f0` | `invoice_issue_requests`, `invoice_request_issue`, `ebim.invoice_issue_enqueue`, vista `invoice_issue_status` |
| 14 | `20260914180000_capability_guard_core.sql` | `c9a3620b9146dbed4eb7f1a0a862d154ee45ae4b8262a4f45232d927c66d0df5` | `app_capabilities.legacy_until_synced`, `ebim.assert_capability`, **redefine `company_is_entitled`** |
| 15 | `20260914180100_capability_guard_catalog_advanced.sql` | `3b0dd72148525d5602b5ebede95a63fc2dbbb2bf94fddf756609941bdcbd13ac` | policies de escritura de 11 tablas PIM |
| 16 | `20260914180200_capability_guard_payments.sql` | `c46c1d7432f353ae7eb2a46902135b546cd3e6d8d0039fd51d80f23f77cde5cd` | `payment_methods` + `ebim.assert_payment_operator` |
| 17 | `20260914180300_capability_guard_fulfillment.sql` | `029df068ec9be33e15f30ea47596d57dce76ad410d1bf1932be5d748d9fe57e7` | configuración de entrega/devolución + `ebim.assert_fulfillment_operator`; recrea 6 comandos |
| 18 | `20260914190000_payment_dispatch_hardening.sql` | `285a02a3a80cfcdd164611aecad885add009b3ce61f08889e542db6923211f19` | **recrea `payment_apply_outcome`**, `fulfillment_transition`, `shipment_open`; `ebim.assert_dispatch_payment` |
| 19 | `20260914191000_cart_open_concurrency.sql` | `511e68440f318c9ef1bd75896e286380fb405805d06b33ec0a64f6c01e19e4c6` | recrea `cart_open` (concurrente sin 409) |

Superficie anónima tras aplicar: **23** funciones (`security-baseline.test.ts`, `docs/SECURITY_BASELINE.md` §1.6).

Después: `npm run db:types` contra QAS **solo en lectura** y comparar con `src/shared/lib/database.types.ts`.

## 2 · Edge Functions (después de las migraciones)

Clasificación por cierre de imports de cada `index.ts` contra lo cambiado desde `5e3da4e`:

| Función | Código cambiado que arrastra | Cambio de comportamiento | Clasificación |
|---|---|---|---|
| `checkout` | `index.ts`, `_shared/checkout/{dbPorts,errors,pipeline,ports}`, `_shared/payments/{gateway,provider,culqi,sandbox}` | crédito bloqueado (403), simulacro solo con permiso | **REQUIRED** |
| `payments-webhook` | `_shared/payments/{provider,culqi,sandbox}` | adaptadores declaran `simulated` | **REQUIRED** (mismo bundle que `checkout`) |
| `integration-worker` | `index.ts`, `_shared/webhooks/dispatcher.ts` | `secret_ref` encerrado por sociedad | **REQUIRED** (+ re-aprovisionar secretos, §3) |
| `notifications-dispatch` | `_shared/notifications/templates.ts` | plantilla `cart.recovery` | **REQUIRED** si se enciende la recuperación de carritos |
| `catalog-copy` | `index.ts` | 404 con código `PRODUCTO_NO_ENCONTRADO` | **RECOMMENDED** |
| `create-user` | `_shared/userProvisioning.ts` | ninguno (firma de tipos) | **RECOMMENDED** |
| `auth-email-hook`, `notifications-test` | `_shared/notifications/templates.ts` | ninguno propio | **RECOMMENDED** (igualar bundle) |
| `api` | `_shared/checkout/ports.ts` (solo tipos) | ninguno | **UNCHANGED** (redeploy opcional) |
| resto | no | ninguno | **UNCHANGED** |

Orden: `checkout` **después** de la migración 1 (lee `credit_status`) y de la 18. `npm run check:edge` verde sobre
los 67 archivos del borde en `c5066af`.

## 3 · Secretos de Edge Functions

- [ ] `EBIM_PAYMENTS_ALLOW_SIMULATION=true` en **DEV/QAS/demo** si se sigue cobrando con `sandbox`. **Nunca** en
  producción. Sin ella, un conector simulado devuelve «pago no disponible».
- [ ] Webhooks salientes: renombrar cada secreto a `EBIM_WH_<company_id en hex, sin guiones>_<secret_ref>`. Hasta
  entonces esas entregas fallan con `SECRETO_NO_CONFIGURADO` (visible en Integraciones).
- Sin cambios en `EBIM_PAYMENT_SECRET_<PROVEEDOR>` ni en `EBIM_PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>`.

## 4 · Frontend (después de migraciones y functions)

- Build con Node 24. Variables públicas: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **No publicar antes de las migraciones 2, 3, 5 y 13**: las pestañas Cotizaciones, Aprobaciones, Programados y la
  columna de emisión llaman a sus funciones.
- Nuevo chunk `messages.es.backoffice-*.js` (se pide al entrar en `/app`): `customHttp.yml` ya sirve `/assets/**`.

## 5 · Auth y hosting

Sin cambios respecto al RC anterior: Redirect URLs y reescritura de SPA de Amplify siguen **pendientes y no
verificables desde el repo** (manifiesto `0395ca3` §4–§5).

## 6 · Verificación posterior (solo lectura)

1. `QAS_BASE_URL=… npm run smoke:qas` → PASS.
2. `node scripts/demo-preflight.mjs miquimica` → PASS. **Aviso:** su lista de migraciones esperadas termina en
   `20260913160000` y no conoce las 19 nuevas; comprobar sus objetos a mano (tabla de §1).
3. `select jobname, schedule from cron.job` → incluye `ecommerce-order-schedules` y `ecommerce-cart-recovery`.
4. `npx playwright test --project=escritorio --project=movil` contra QAS. **Nunca** `comercio-*` contra QAS: crean
   usuarios, pedidos y alteran el crédito de una cuenta.

## 7 · Si algo falla: roll-forward, nunca rollback destructivo

- Detener en el paso que falló; no publicar functions ni frontend con una migración a medias.
- Corregir con una migración **nueva posterior**; nunca editar una aplicada ni borrar tablas con datos
  (`order_schedule_runs`, `product_reviews`, `cart_recovery_*`, `invoice_issue_requests`).
- Candados de capacidad: si un tenant sincronizado pierde un módulo que usaba, la corrección es de datos (dar la
  capacidad en `tenant_entitlements` por el Hub/aprovisionamiento), no revertir la migración.
- `checkout` anterior: solo si la migración 1 no se aplicó (la anterior no conoce `CREDITO_BLOQUEADO`; el trigger
  de la base rechazaría igual, con un error genérico).
- Registrar el incidente en `docs/STATE.md`.
