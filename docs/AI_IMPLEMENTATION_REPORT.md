# Informe de implementación de IA — eCommerce by EBIM

> Cierre de la secuencia `EBIM_AI_SEQUENCE` (fases 00–12), 2026-09-22, rama `dev`, **sin versionar ni
> desplegar**. Arquitectura: [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) · checklist:
> [`AI_IMPLEMENTATION_STATE.md`](AI_IMPLEMENTATION_STATE.md) · seguridad:
> [`AI_SECURITY_REVIEW.md`](AI_SECURITY_REVIEW.md).

## 1. Qué se construyó

Una sola capa de IA, server-side, reutilizada por todos los módulos del backoffice y por la vitrina:

```
front (zod) ──► Edge Function (JWT → tenant del token, rol, módulo)
                   │  datasets reducidos SECURITY INVOKER con el JWT del usuario (RLS)
                   ▼
              ejecutarIA: ¿proveedor? → ai_consume (capacidad+módulo+rol+cuota) → pedirJson
                   (esquema + validarEsquema) → revisar (candados de dominio) → ai_record (traza)
                   ▼
              { data | null, motivo tipado, interaction_id } ──► pulgar en contexto
```

- **Una funcionalidad por módulo** (17: `assistant`, `catalog.copy`, `insights`, `orders`, `inventory`,
  `planning`, `customers`, `sales`, `quotes`, `credit`, `payments`, `fulfillment`, `operations`,
  `integrations`, `content`, `promotions`, `reviews`, `copilot`), con capacidad que paga, módulo exigido,
  roles, clase de modelo, `max_tokens` y timeout — en tres copias con paridad probada (TS, SQL, front).
- **Modelos por clase**: `rapido` Haiku 4.5 (vitrina, fichas), `redaccion` Sonnet 5 (explicaciones y
  borradores), `analisis` Opus 5 (dashboard, planificación, operaciones, integraciones, respuesta del
  Copilot). Override por entorno `EBIM_AI_MODEL_<FEATURE>` / `EBIM_AI_MODEL`; lista cerrada de IDs.
- **La IA explica, resume, clasifica y redacta borradores.** Precios, impuestos, stock, pagos, crédito,
  estados y autorizaciones los sigue calculando SQL; el modelo cita cifras por marcador (`{{clave}}`) que el
  front sustituye por el valor de la base. Ninguna salida del modelo escribe.

## 2. Migraciones (todas sin aplicar en QAS)

| Migración | Fase | Contenido |
|---|---|---|
| `20260921120000_ai_core.sql` | 01 (+12) | Registro de funcionalidades, `ai_tickets`, `ai_consume` con rol, `ai_record` por ticket con `error_kind`, `ai_feedback`, `ai_entitlement` con `features`, capacidad `ai.content`. **F12:** `p_units = 1` por JWT, freno 30/min por persona, purga de tickets, topes de tokens por JWT, freno por tienda de la vitrina (`ai_consume_for_store`). |
| `20260921130000_ai_dashboard_facts.sql` | 02 (+12) | `ai_dashboard_facts` (owner/admin). **F12:** filtro explícito de sociedad activa. |
| `20260921140000_ai_orders_facts.sql` | 04 | `ai_order_facts`, `ai_orders_search`, `ai_orders_attention`, guards `assert_ai_orders_*`. |
| `20260921150000_ai_inventory_planning_facts.sql` | 05 | `ai_inventory_facts`, `ai_forecast_facts`, `ai_suggestion_facts`. |
| `20260921160000_ai_customer_facts.sql` | 06 | `ai_customer_facts` (cartera del vendedor), `ai_visit_facts`. |
| `20260921170000_ai_quotes_assortments.sql` | 07 | `ai_quote_resolve`, `ai_assortment_facts`, `quote_create_from_draft` (re-precia en servidor). |
| `20260922100000_ai_credit_payments_fulfillment_facts.sql` | 08 | `ai_credit_facts`, `ai_payments_facts`, `ai_fulfillment_facts`. |
| `20260922120000_ai_promotions_reviews_facts.sql` | 09 (+12) | `ai_promotion_facts`, `ai_reviews_facts`, hechos de CMS. **F12:** contacto tapado en reseñas. |
| `20260922140000_ai_ops_integrations_facts.sql` | 10 | `ai_ops_facts`, `ai_integrations_facts` (redactados). |
| `20260922160000_ai_copilot.sql` | 11 | `copilot` en el registro, `ai_copilot_tools()`, `ai_copilot_products`, `ai_copilot_product`, `ai_copilot_sales_facts`. |

## 3. Edge Functions

| Función | Estado | Funcionalidad |
|---|---|---|
| `shopping-assistant` | modificada | `assistant` (vitrina anónima; **F12:** freno por tienda, respuesta filtrada, consulta saneada) |
| `catalog-copy` | modificada | `catalog.copy` (PIM: ficha, SEO, categoría, atributos) |
| `dashboard-insights` | nueva (02) | `insights` (**F12:** sin datos ⇒ `vacia` sin modelo) |
| `orders-assistant` | nueva (04) | `orders` |
| `inventory-assistant`, `planning-assistant` | nuevas (05) | `inventory`, `planning` |
| `customers-assistant`, `sales-assistant` | nuevas (06) | `customers`, `sales` |
| `quotes-assistant` | nueva (07) | `quotes` |
| `credit-assistant`, `payments-assistant`, `fulfillment-assistant` | nuevas (08) | `credit`, `payments`, `fulfillment` |
| `promotions-assistant`, `content-assistant`, `reviews-assistant` | nuevas (09) | `promotions`, `content`, `reviews` |
| `operations-assistant`, `integrations-assistant` | nuevas (10) | `operations`, `integrations` |
| `copilot` | nueva (11) | `copilot` (**F12:** el plan usa la clase `redaccion`) |

Todas con `verify_jwt = true` explícito en `supabase/config.toml`.

Piezas compartidas: `_runtime/anthropic.ts` (transporte), `_runtime/aiMeter.ts` (medidores de usuario y
de tienda), `_shared/aiCore.ts` (registro, errores, modelos, frontera, validador), `_shared/aiPipeline.ts`
(orden), `_shared/aiExplain.ts` y `_shared/aiTechnical.ts` (explicación sobre señales del sistema), un
módulo puro por dominio (`aiInsights`, `aiPim`, `aiOrders`, `aiInventory`, `aiPlanning`, `aiCustomers`,
`aiQuotes`, `aiCredit`, `aiPayments`, `aiFulfillment`, `aiPromotions`, `aiContent`, `aiReviews`,
`aiOperations`, `aiIntegrations`, `aiCopilot`) y `_shared/observability/redact.ts` (saneado para el modelo).

## 4. Front

- Núcleo: `src/features/ai/` — `features.ts` (roles por funcionalidad, disponibilidad), `result.ts`
  (`parseAiResult`, motivos tipados), `hooks.ts` (`useAiFeature`), `AiFeedbackButtons.tsx`,
  `explain/` (`ExplainPanel` reutilizable), `content/`, `copilot/` (`CopilotProvider`, `CopilotDrawer`,
  `copilot.ts`, `copilot-context.ts`).
- Por módulo: `admin/dashboard/AiAnalystPanel`, `catalog/ProductAiAssistant`,
  `catalog/reviews/ai/*`, `content/ai/*`, `credit/ai/*`, `customers/ai/*`, `fulfillment/ai/*`,
  `integrations/ai/*`, `inventory/ai/*`, `ops/ai/*`, `orders/ai/*`, `payments/ai/*`, `planning/ai/*`,
  `promotions/ai/*`, `sales/ai/*`, `trade/ai/*`, montados en sus páginas y cajones.
- i18n ES/EN completo (4967 claves por idioma), tokens de tema (claro/oscuro, acento del tenant),
  cajones responsive, `aria-live` en respuestas y errores.

## 5. Tests

| Capa | Archivos |
|---|---|
| Postgres real (PGlite, migraciones reales) | `ai-core-db`, `ai-metering`, `ai-dashboard-facts`, `ai-orders-facts`, `ai-inventory-planning-facts`, `ai-customer-facts`, `ai-quotes-facts`, `ai-credit-payments-fulfillment-facts`, `ai-promotions-reviews-facts`, `ai-ops-integrations-facts`, `ai-copilot-facts` |
| Lógica pura del borde | `ai-contract`, `ai-copy`, `ai-core`, `ai-insights`, `ai-pim`, `ai-orders`, `ai-inventory-planning`, `ai-customers`, `ai-quotes`, `ai-credit-payments-fulfillment`, `ai-promotions-content-reviews`, `ai-ops-integrations`, `ai-copilot`, **`ai-security` (F12, transversal)** |
| Front | `ai-core-front`, `AiAnalystPanel`, `ProductAiAssistant`, `OrdersAi`, `InventoryAi`, `PlanningAi`, `CustomersAi`, `QuotesAi`, `CreditPaymentsFulfillmentAi`, `PromotionsCmsReviewsAi`, `OpsIntegrationsAi`, `copilot-front` |
| Gates | `secret-scan.test.mjs` (F12: archivos nuevos + clave del proveedor), `observability-edge.test.ts` (F12: redacción de logs), `schema-invariants.test.ts` |

## 6. Validaciones de la fase 12

Ver la sección «Fase 12» de [`AI_IMPLEMENTATION_STATE.md`](AI_IMPLEMENTATION_STATE.md) para los
resultados exactos (typecheck, lint, check:edge, build + presupuesto de bundle, scan de secretos, suite
completa de Vitest).

## 7. Riesgos y deuda pendientes

1. **Despliegue**: 10 migraciones y 18 Edge Functions pendientes. Aplicar en orden de timestamp y
   desplegar las funciones en el mismo paso (las funciones llaman a `ai_record` con `p_error_kind`, y el
   Copilot depende de todos los datasets). Configurar `EBIM_AI_API_KEY`, `EBIM_ADMIN_ORIGINS` y
   `EBIM_STOREFRONT_ORIGINS`. El hub debe dar de alta `ecommerce.ai.content`.
2. **Calidad no medida contra el proveedor real** (sin clave en local): los candados pueden vaciar
   respuestas legítimas; medir tasa de `bloqueada`/`esquema` por funcionalidad en la traza tras desplegar
   y ajustar modelo por `EBIM_AI_MODEL_<FEATURE>` (p. ej. operaciones/integraciones a Sonnet si la calidad
   se sostiene).
3. **Medición por JWT desde el navegador** (R1 de la revisión): mover `ai_consume`/`ai_record` a
   `service_role` en el borde.
4. **PII en texto libre hacia el proveedor** (R2), **CORS `*` sin variable** (R3), **sin tope de cuerpo**
   (R4), **500 tras gastar** en búsqueda de pedidos y borrador de cotización (R5), **coste de respuestas
   descartadas por longitud y reintento de timeouts** (R6), **`ai_usage_by_feature` visible a todo
   miembro** (R7).
5. **Front menor**: resultados correctos fuera de la región `aria-live` en contenido/promociones/reseñas
   (el pendiente y los errores sí se anuncian); ids DOM fijos en `OrderAiPanel`/`ProductAiAssistant`/
   `OrdersAiBar` (duplicarían si se montan dos); la traza de Diagnóstico muestra el id técnico de la
   funcionalidad.
6. **`src/shared/lib/database.types.ts` sin regenerar** (las funciones nuevas solo las llama el borde).
7. **Presupuesto de la portada de la vitrina** al límite (404,9/405 kB gzip): la IA vive en chunks del
   backoffice, pero cualquier crecimiento del núcleo compartido lo rebasa.
8. **Mascota «Bebim»** en pausa por contrato (§4.6): no integrada.

## Revisión final del supervisor

**Fecha:** 2026-09-22 · **Fase:** 99 (reintento 1 de reparación) · sin commits, push ni despliegue.

### Validaciones finales

| Validación | Resultado |
|---|---|
| `git diff --check` | exit 0 (solo avisos LF→CRLF) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 (re-ejecutado tras la reparación) |
| `npm run scan:secrets` | exit 0 — sin hallazgos (versionado + sin versionar + `dist/`) |
| `npm run check:edge` | exit 0 — 105 archivos, sin errores (re-ejecutado tras la reparación) |
| `npm test` (suite completa) | **exit 0 — 281/281 archivos**, 477 s (antes 855 s y rojo) |

### Problema encontrado y corregido

`npm test` fallaba con **timeouts por contención de CPU**, no por aserciones: cada uno de los 104 archivos
de BD aplicaba las ~200 migraciones desde cero sobre PGlite (≈13 s por archivo) y, con la suite en
paralelo, los `beforeAll` pasaban de 30 s en un archivo distinto en cada corrida (`carts`,
`checkout-pipeline`, `ai-core-db`, `my-stores`…); el gate de `secret-scan` se quedaba sin CPU detrás.
Aislados, todos pasaban.

Causa raíz atacada:

- `supabase/tests/harness.ts`: `createTestDatabase()` sin `before` carga una **instantánea** de la base
  ya migrada (tar sin comprimir, ≈3 s) en lugar de migrar (≈13 s). La instantánea se nombra por el hash
  del preludio y de todas las migraciones (nombre + contenido): cualquier cambio invalida la vieja. Si
  no existe, se migra como antes; `createTestDatabase({ before })` y `applyMigrations` no cambian. Se usa
  el `Blob` de `node:buffer` porque el de jsdom no trae `arrayBuffer`. Escritura atómica (`rename`).
- `supabase/tests/global-setup.ts` (nuevo) + `vite.config.ts` (`globalSetup`): migra UNA vez por
  ejecución y deja la instantánea en `os.tmpdir()/ebim-pglite-snapshots/`.
- Márgenes explícitos en esperas sensibles a carga (sin tocar aserciones): editor `lazy` de bloques
  (`content-ui.test.tsx`) y resultado del simulador (`promotions-ui.test.tsx`) a 15 s; el gate
  repo-completo de `secret-scan.test.mjs` a 60 s.

### Revisión de la capa de IA (sin hallazgos bloqueantes nuevos)

- Sin claves del proveedor, `service_role` ni llamadas a Anthropic en `src/` (solo comentarios); el
  escáner lo confirma también en `dist/`.
- Sin `any` en `src/features` ni `supabase/functions`; sin TODO/stub accidentales en el código de IA.
- Una sola capa (`aiCore`/`aiPipeline`/`_runtime/anthropic.ts`); la IA no escribe precios, stock,
  pagos, crédito ni estados (ver §1 y `AI_SECURITY_REVIEW.md`).

### Pendientes reales

Los de §7 siguen vigentes (despliegue de 10 migraciones y 18 funciones, R1–R7 de la revisión de
seguridad, calidad sin medir contra el proveedor real, presupuesto de la portada al límite). Ninguno
bloquea las validaciones locales.

### Estado final verificable

Todas las validaciones locales en verde. Archivos tocados por el supervisor:
`supabase/tests/harness.ts`, `supabase/tests/global-setup.ts` (nuevo), `vite.config.ts`,
`src/features/content/content-ui.test.tsx`, `src/features/promotions/promotions-ui.test.tsx`,
`scripts/secret-scan.test.mjs`, este informe.
