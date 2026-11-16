# eCommerce · `lifecycle.v1` (estado operativo ordenado por EBIM MasterAdmin)

Contrato de suite: `LIFECYCLE_CONTRACT.md` de EBIM MasterAdmin (fuente de verdad). Este documento
dice cómo lo cumple eCommerce.

## 1. Qué hace

MasterAdmin suspende una cuenta por impago (o a mano, o por baja) y la reactiva al pagar. Por la
enmienda D-14, `appActive=false` de entitlements solo retira lo comercial (ADR-002); el apagado
operativo viaja por este canal aparte.

| Estado | Comportamiento en eCommerce |
|---|---|
| `SUSPENDED` | **Toda escritura** en tablas de negocio del tenant se rechaza en la base con `TENANT_SUSPENDED` (SQLSTATE `PT423`; PostgREST lo devuelve como HTTP 423, las Edge Functions y la API de socio también). La lectura y la exportación siguen; los datos no se tocan. El login sigue permitido. Backoffice: aviso fijo «Cuenta suspendida» (con `NON_PAYMENT`: «regularice el pago con su proveedor»). Vitrina: catálogo visible con «Tienda no disponible temporalmente»; carrito, checkout y pedido bloqueados. |
| `ACTIVE` | Todo se reanuda solo, sin perder datos; las colas entregan lo que quedó en pausa. |

No se usa `public.tenants.status`: `'suspended'` ahí cierra también la lectura y el login
(`ebim.member_role`, fijado por `rls-tenant-isolation.test.ts`). Tampoco `stores.status`, que es del
administrador del tenant (`set_store_status`). El estado vive en un registro propio.

## 2. Rutas (Edge Function `platform-provisioning`)

| Método y ruta | Scope | Respuestas |
|---|---|---|
| `PUT /platform-provisioning/tenants/{controlPlaneTenantId}/lifecycle` | `ecommerce:lifecycle:write` | `200` aplicado · `200 replayed:true` · `400 INVALID_LIFECYCLE \| PRODUCT_MISMATCH \| WRONG_ENVIRONMENT` · `401 UNAUTHENTICATED \| JTI_REPLAYED` · `403 INSUFFICIENT_SCOPE` · `404 TENANT_NOT_PROVISIONED` · `409 STALE_LIFECYCLE \| VERSION_CONFLICT` (con `appliedVersion`) · `500 LIFECYCLE_FAILED` · `503 LIFECYCLE_NOT_CONFIGURED` |
| `GET /platform-provisioning/tenants/{controlPlaneTenantId}/lifecycle` | `ecommerce:lifecycle:read` | `200 {controlPlaneTenantId, productCode, appliedVersion\|null, state, reason, appliedAt\|null}` (sin PUT previo: `ACTIVE`, versión `null`) · `401` · `403` · `404` · `503` |

- Misma verificación M2M que alta y entitlements (`_shared/platformProvisioning/m2m.ts`: ES256,
  emisor, audiencia `ecommerce.ebim`, sujeto `masteradmin-provisioning`, vida ≤ 300 s) y `jti` de un
  solo uso compartido con entitlements (`platform_entitlements_use_jti`).
- Cuerpo exacto del contrato §3; un campo desconocido o ausente, una causa incoherente con el estado,
  `Content-Type` distinto de JSON, `X-MasterAdmin-Contract` distinto de `lifecycle.v1` o un
  `Idempotency-Key` distinto del `idempotencyKey` del cuerpo → `400 INVALID_LIFECYCLE`.
- Versión: menor que la aplicada → `409 STALE_LIFECYCLE`; igual con el mismo estado y causa →
  repetición (`replayed: true`); igual con otro estado **u otra causa** → `409 VERSION_CONFLICT`.
- Errores: `{error, message, appliedVersion?}`; nunca trazas de Postgres ni el cuerpo recibido.
- Código: `supabase/functions/_shared/platformLifecycle/{config,contract,handler,repository}.ts`.

## 3. Configuración

Secretos de la función (`supabase secrets set`; solo NOMBRES aquí). Sin los dos scopes, las rutas
de lifecycle responden 503 (fail-closed) y las demás no cambian.

| Variable | Valor | Notas |
|---|---|---|
| `EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE` | `ecommerce:lifecycle:write` | nueva; distinta de los scopes de alta y entitlements |
| `EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE` | `ecommerce:lifecycle:read` | nueva |
| `EBIM_ENTITLEMENTS_ENVIRONMENT` | `DEV`/`QAS`/`DEMO`/`PRD` | reutilizada: el entorno de ESTE proyecto (`WRONG_ENVIRONMENT`) |
| `EBIM_ENTITLEMENTS_PRODUCT_CODE` | `ecommerce` (por defecto) | reutilizada (`PRODUCT_MISMATCH`) |
| `EBIM_MASTERADMIN_M2M_*` | — | las mismas de provisioning (clave pública, emisor, audiencia, sujeto…) |

En MasterAdmin (`platform.configure_lifecycle_integration`), sobre la integración `HTTP_M2M` de
eCommerce cuyo `base_url` ya es `https://<ref>.supabase.co/functions/v1/platform-provisioning`:
`lifecycle_path = /tenants/{controlPlaneTenantId}/lifecycle` (igual que `entitlements_path`),
`lifecycle_write_scope = ecommerce:lifecycle:write`, `lifecycle_read_scope = ecommerce:lifecycle:read`.

## 4. Base de datos (migración `20261116100000_tenant_lifecycle.sql`)

| Objeto | Qué es |
|---|---|
| `platform_lifecycle.tenant_state` | último estado aplicado por tenant (`control_plane_tenant_id`, `organization_id`, `state`, `reason`, `applied_version`, `applied_at`…) |
| `platform_lifecycle.events` | bitácora append-only de cada PUT verificado (aplicado, repetido, stale, conflicto, 404, inválido) |
| `platform_lifecycle.exempt_tables` | tablas de `public` con `organization_id` SIN guardián, con su porqué (≥ 40 caracteres) |
| `public.platform_apply_lifecycle` / `public.platform_get_lifecycle` | RPC M2M, solo `service_role` |
| `ebim.enforce_tenant_lifecycle()` + trigger `a_tenant_lifecycle_guard` | el guardián: `BEFORE INSERT OR UPDATE OR DELETE` por fila en **166** tablas |
| `platform_lifecycle.ensure_guards()` | instala el guardián donde falte (idempotente) |
| `public.my_tenant_lifecycle()` | `state`, `reason`, `applied_at` del tenant del JWT (miembro), para el aviso del backoffice |
| `public.store_operational_for_slug(slug)` | `{operational}` para la vitrina (anon), sin la causa |
| `ebim.tenant_is_suspended(org)` | la pregunta del guardián, los reclamadores y la policy de Storage |

Esquema privado (no lo expone PostgREST), sin `USAGE` para anon/authenticated, tablas con RLS
forzada y sin GRANT a nadie (tampoco a service_role: solo las RPC `SECURITY DEFINER`).

### 4.1 El guardián y sus tres modos

El trigger lee `organization_id` de la fila vieja y la nueva y, si la organización está suspendida,
lanza `TENANT_SUSPENDED` con `PT423`. Lo disparan por igual RLS, RPC `SECURITY DEFINER`,
`service_role`, la API de socio y los webhooks de pagos/envíos. Se llama `a_…` para disparar antes
que cualquier otro `BEFORE`. El modo se fija por función (`SET ebim.lifecycle_guard`), nunca por el
cliente (PostgREST no expone `set_config`):

| Modo | Funciones | Por qué |
|---|---|---|
| `platform` | `platform_provision_tenant`, `platform_apply_entitlements`, `platform_set_entitlement_enforcement_mode`, `platform_reconcile_entitlements`, `sync_platform_context` | los canales de plataforma siguen abiertos: MasterAdmin gobierna (y reactiva) una cuenta suspendida; entitlements escribe `tenant_platform_context`, `tenant_entitlements`, `ai_quotas`, `store_settings.white_label` |
| `access` | `claim_provisioned_tenant` | **login permitido**: es la única escritura del camino de entrada (el primer ingreso del administrador PREPROVISIONED crea su membresía `owner`). El resto del login solo lee (`tenants`, `tenant_members`, `stores`, `my_tenant_lifecycle`); Supabase Auth escribe en `auth.*`, que no tiene guardián; el hook de token solo lee. |
| `skip` | purgas (`purge_*`), caducidades (`expire_carts`, `expire_inventory_reservations`, `expire_gift_cards`), rescates (`integration_reclaim_stale`, `reclaim_stale_domain_events`, `ebim.cart_recovery_guard_queue`) y los reclamadores de colas (incluido `connector_claim`) | recorren filas de TODOS los tenants en una sentencia: la fila del suspendido se salta en silencio (queda intacta) y el resto se procesa. Sin esto una sola fila suspendida tumbaría el trabajo de todos. |

Los reclamadores con límite (`integration_claim`, `claim_domain_events`, `notification_email_claim`,
`ebim.enqueue_cart_recovery`, `ebim.run_order_schedules`, `connector_claim`) además **filtran** lo suspendido al elegir:
si solo lo saltaran, esas filas ocuparían el lote para siempre. Lo del suspendido queda `pending`
(correos, integraciones, eventos, pedidos programados, flujos del conector de lectura) y sale al reactivar.

> **Rebase 2026-11-16.** La migración nació como `20261013100000` y chocaba en versión con
> `20261013100000_product_detail_extras` de `origin/dev`; pasó a `20261116100000`, después de la
> última migración de `dev` (`20261115140000`). Al aplicarse la última, `ensure_guards()` cubre también
> las tablas nuevas de esos 46 commits (`connector_sources`, `connector_feeds`, `connector_runs`,
> `connector_rejects`…: 166 en total) y `connector_claim` (cron `ecommerce-connector-pull`) se
> redefine con el filtro y el modo `skip`. Los secretos en `ebim.connector_secrets` y
> `ebim.payment_method_secrets` no llevan guardián (esquema `ebim`), pero solo se escriben junto con
> `connector_sources`/`payment_methods`, que sí lo llevan.

### 4.2 Exenciones (y por qué)

| Tabla | Por qué |
|---|---|
| `api_requests` | registro de acceso y ventana de tasa de la API de socio: **cada GET** inserta aquí (`api_rate_limit_hit`). Bloquearla cortaría la lectura por API, que el contrato exige mantener. No guarda datos de negocio. |

Los canales de plataforma viven fuera de `public` (`platform_provisioning`, `platform_entitlements`,
`platform_usage` —outbox de uso—, `platform_lifecycle`) o escriben en `public` con el modo `platform`.

Decisiones explícitas (sin exención):

- **Analítica anónima** (`analytics_events`, `public_rate_events`): bloqueada. La vitrina ya envía
  la analítica en modo «disparar y olvidar» (`analytics.ts`), así que el catálogo no se rompe; una
  tienda que no vende no necesita medir.
- **Observabilidad** (`ops_events`): bloqueada; `ebim.record_ops_event` nunca lanza (traga el error).
- **IA** (`ai_usage`, `ai_interactions`, `ai_tickets`): bloqueada; consume créditos y es operación.
- **Baja de recordatorios** (`cart_recovery_unsubscribe`, anónima): bloqueada mientras dure la
  suspensión; ningún recordatorio sale en ese tiempo (el reclamador lo filtra). Riesgo abierto §7.
- **Webhooks de pago/envío** de pedidos previos: el guardián los rechaza (500/423 al proveedor), que
  reintenta; tras reactivar se aplican.

### 4.3 Storage

`storage.objects` no admite el trigger. Tres policies **restrictivas** (`ebim_objects_lifecycle_*`)
impiden a `authenticated` subir, reemplazar o borrar objetos bajo `{organization_id}/…` de una cuenta
suspendida (error de RLS → 403 en la API de Storage). La lectura no cambia.

## 5. Vitrina y backoffice (solo UX)

- Backoffice: `TenantLifecycleNotice` en `AdminLayout` (junto a `WatchModuleNote`), con
  `useTenantLifecycle()` → `my_tenant_lifecycle` (refresco 5 min y al volver a la pestaña).
- Vitrina: `StoreUnavailableNotice` en `StorefrontLayout` → `store_operational_for_slug`. Ante la
  duda (sin cliente, error), se calla.
- Errores: `TENANT_SUSPENDED`/`PT423` se clasifica `forbidden` (no reintentable); todo `UiError` con
  ese código muestra `tenantLifecycle.error`; el checkout usa `tenantLifecycle.error.store`. Edge
  Functions (`_shared/errors.ts`), checkout (`_shared/checkout/errors.ts`) y API de socio
  (`_shared/api/contract.ts`) lo devuelven como **423**. La primera escritura del checkout (intento /
  reserva) va antes de autorizar el cobro, así que no se cobra un pedido que no puede nacer.
- Los botones de escritura no se deshabilitan uno a uno: la autoridad es la base.

## 6. Cómo probar

Sin Docker, con el banco PGlite del repo (todas las migraciones):

```bash
npx vitest run supabase/tests/tenant-lifecycle-db.test.ts       # estructura, RPC, bloqueo, login, reactivación
npx vitest run supabase/tests/platform-lifecycle-contract.test.ts # handler real con JWT ES256
npx vitest run src/features/tenant/lifecycle.test.ts             # mapeo de errores en la UI
npm test && npm run lint && npm run typecheck && npm run check:edge && npm run build
```

La prueba estructural exige el guardián en toda tabla de `public` con `organization_id` salvo las de
`exempt_tables`. **Toda migración que cree una tabla de negocio termina con
`select platform_lifecycle.ensure_guards();`** (o la añade a `exempt_tables` con su porqué).

Certificación en DEV/QAS: contrato §7 (configurar la integración, suspender desde el Centro de la
suite, comprobar 423 en una escritura + aviso + lectura, registrar el pago y comprobar que vuelve).

## 7. Riesgos abiertos

- Una función futura que recorra filas de varios tenants sin modo `skip` fallará con `PT423` al
  tocar una fila suspendida (lo verá el primer tenant suspendido). La prueba fija la lista actual.
- La baja de un clic de recordatorios de carrito no funciona durante la suspensión.
- `api_requests` es la única tabla de `public` con `organization_id` sin guardián.
- El aviso y el bloqueo dependen de que MasterAdmin entregue el PUT (≤ 5 min con el job de sync).
