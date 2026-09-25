# eCommerce · contrato GENERIC v1 con EBIM MasterAdmin

**Estado:** implementado y certificado en LOCAL (2026-09-24). No desplegado. Pendiente de QAS
(ver §9). Referencias: `masteradmin/docs/platform-provisioning/ADAPTERS.md` (cuerpo y respuesta),
`M2M.md` (JWT), `masteradmin/supabase/functions/_shared/provisioning/response.ts` (validación de la
respuesta), implementación hermana de eChange (`20260922055042`).

eCommerce habla **el contrato GENERIC de la suite sin codec propio**: en MasterAdmin es una fila de
`product_integrations` con `adapter_key = 'GENERIC'`.

## 1. Qué es un tenant de eCommerce (decisión y evidencia)

| Pieza | Dónde vive | Evidencia |
| --- | --- | --- |
| **Raíz del tenant** = organización | `public.tenants`, PK `organization_id` | `supabase/migrations/20260827090100_tenants_and_members.sql:16-17` |
| Sociedad | **sin tabla**: `company_id` en la membresía y en cada fila de negocio | `…090100…:42` (`tenant_members.company_id`), `20260827090200_stores.sql:13`; no existe `create table public.companies` |
| Acceso | `tenant_members (organization_id, company_id, user_id NOT NULL, role)` | `…090100…:39-51`; `user_id` = `sub` del JWT (`:43`) |
| Tiendas | de la **sociedad**, N por sociedad, las crea owner/admin con `public.create_store` | `docs/adr/018-stores-product-master-company-scope.md:33,39`; `20260917100000_store_management.sql:319` |
| Backoffice sin tienda | admitido: `activeStore: StoreSummary \| null`, acciones deshabilitadas sin tienda | `src/features/tenant/workspace.ts:99` |
| Productos | maestro de la **sociedad**, publicado por tienda (`store_products`) | ADR 018 decisiones 5-6 |

**Decisión:** MasterAdmin aprovisiona `public.tenants` (organización) + la sociedad (UUID derivado,
sin fila propia) + el **owner PREPROVISIONED**. **No crea tienda**: la arquitectura no la exige
(ADR 018, `workspace.ts`) y el contrato GENERIC no trae slug ni nombre de tienda; inventarlos sería
decidir la URL pública de la vitrina del cliente. El owner crea la primera con «Tiendas → Nueva».

## 2. Endpoints

Edge Function `platform-provisioning`, `verify_jwt = false` (la autentica el JWT ES256 de MasterAdmin,
no uno de Supabase), sin CORS.

| Método y ruta | Scope | Respuestas |
| --- | --- | --- |
| `GET /platform-provisioning/health` | ninguno | `200 {"status":"ok"}` · `503 {"status":"unavailable"}` si está apagada o la clave no importa |
| `POST /platform-provisioning/tenants` | `ecommerce:tenant:create` | `201` creado · `200 replayed:true` · `400` · `401` · `403` · `409` · `413` · `415` · `500` · `503` |
| `GET /platform-provisioning/tenants/{controlPlaneTenantId}` | `ecommerce:tenant:read` | `200` · `400` · `401` · `403` · `404 PROVISIONING_NOT_FOUND` · `503` |

Cabeceras del POST: `Authorization: Bearer <JWT>`, `Content-Type: application/json`,
`Idempotency-Key` (obligatoria, `^[A-Za-z0-9._:-]{8,200}$`), `X-MasterAdmin-Contract: v1` (si viene,
tiene que ser `v1`), `X-Correlation-Id` (solo se acepta si es UUID). Cuerpo máximo 64 KiB.

## 3. JWT M2M

ES256 exacto (`none`, HS256, RS256 → 401), firma con la clave pública de MasterAdmin, `iss =
masteradmin.ebim`, `aud = ecommerce.ebim` (o `[ecommerce.ebim]`), `sub = masteradmin-provisioning`
**exacto**, `iat`/`exp` enteros, no caducado, `exp − iat ≤ MAX_TOKEN_LIFETIME` (120), `jti` obligatorio,
`scope` obligatorio, sin claim `role` (un JWT de Supabase nunca pasa). Los motivos
(`INVALID_ISSUER`, `INVALID_AUDIENCE`) solo se revelan tras verificar la firma. `actor_id` /
`actor_role` se guardan en la bitácora y **no autorizan**. Scope insuficiente con firma válida → 403
auditado; token inválido → 401 **no** auditado.

Variables (solo nombres; mismos que eChange):

| Variable | Valor QAS |
| --- | --- |
| `EBIM_MASTERADMIN_M2M_ENABLED` | `true` (cualquier otro → 503 a todo) |
| `EBIM_MASTERADMIN_M2M_ISSUER` | `masteradmin.ebim` |
| `EBIM_MASTERADMIN_M2M_AUDIENCE` | `ecommerce.ebim` |
| `EBIM_MASTERADMIN_M2M_SUBJECT` | `masteradmin-provisioning` |
| `EBIM_MASTERADMIN_M2M_ALGORITHM` | `ES256` |
| `EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME` | `120` (1..300) |
| `EBIM_MASTERADMIN_M2M_CREATE_SCOPE` | `ecommerce:tenant:create` |
| `EBIM_MASTERADMIN_M2M_READ_SCOPE` | `ecommerce:tenant:read` |
| `EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64` | Base64 del PEM `BEGIN PUBLIC KEY` (P-256) de MasterAdmin |

## 4. Cuerpo: REQUERIDO / OPCIONAL / IGNORADO

| Campo GENERIC | Uso en eCommerce | |
| --- | --- | --- |
| `masterAdmin.tenantId` | `controlPlaneTenantId` (UUID), llave del mapeo e idempotencia | REQUERIDO |
| `masterAdmin.productCode` | tiene que ser `ecommerce` | REQUERIDO |
| `masterAdmin.contractVersion` | si viene, `v1` | OPCIONAL |
| `tenantCode` | `tenants.slug` (minúsculas; `^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$`) | REQUERIDO |
| `organization.displayName` | `tenants.name` (≤ 200) | REQUERIDO |
| `adminEmail` | `tenants.admin_email` + owner PREPROVISIONED; `@ebim.pe` → 400 (contrato §13) | REQUERIDO |
| `deploymentMode` | `SHARED` / `PARTNER_DEDICATED` / `TENANT_DEDICATED` — contexto, no infraestructura | REQUERIDO |
| `tenantName`, `tenantType`, `environment`, `organization.code`, `company.code`, `company.name`, `company.currency`, `plan.code`, `masterAdmin.requestId` | se guardan como `context` (rastro), **fuera del hash** | OPCIONAL |
| `organization.legalName`, `countryCode`, `taxId`, `company.taxId`, `plan.name`, `masterAdmin.correlationId` | no se usan | IGNORADO |

El catálogo comercial (plan, addons) **no** se toca: es del hub (Platform Context, contrato §5/§6).

## 5. Ids deterministas

`organization_id = uuid5(NS, "organization:<cpt>")`, `company_id = uuid5(NS, "company:<cpt>")`, con
`NS = e9b4cc1e-6540-5856-b56d-73d220a346ac = uuid5(URL, "https://ecommerce.ebim/platform-provisioning/v1")`.
**No cambiar nunca** con tenants aprovisionados. `externalTenantId = externalOrganizationId =
organization_id`; `externalCompanyId = company_id`.

## 6. Respuesta

```json
{
  "provisioningId": "…", "status": "ACTIVE", "controlPlaneTenantId": "…",
  "externalTenantId": "<organization_id>", "externalOrganizationId": "<organization_id>",
  "externalCompanyId": "<company_id>",
  "resources": { "tenantSlug": "alpha-shop", "backofficePath": "/app",
                 "adminProvisioningStatus": "PREPROVISIONED", "storeCount": 0,
                 "initialStore": "CREATED_BY_OWNER" },
  "adminProvisioningStatus": "PREPROVISIONED", "deploymentMode": "SHARED",
  "rawReference": "<provisioningId>", "createdAt": "…", "completedAt": "…",
  "replayed": false, "correlationId": "…"
}
```

`resources` solo lleva escalares (lo que acepta `response.ts`). El GET devuelve lo mismo sin `replayed`.
Errores: `{ code, message, error: { code, message, details? }, correlationId }` — `code` arriba porque
MasterAdmin lo lee primero.

## 7. Idempotencia y conflictos

El hash es SHA-256 del comando **normalizado** (correo en minúsculas, trims, claves ordenadas, sin
contexto). Todo en una transacción con `pg_advisory_xact_lock` (clave → tenant → slug) y `UNIQUE` como
garantía final.

| Caso | Resultado |
| --- | --- |
| Misma clave + mismo hash | `200 replayed:true`, mismos ids |
| Misma clave + otro hash | `409 IDEMPOTENCY_CONFLICT` |
| Mismo `tenantId`, otra clave, mismo hash | `409 TENANT_ALREADY_PROVISIONED` |
| Mismo `tenantId`, otra clave, otro hash | `409 TENANT_CONFLICT` |
| Slug u organización ya existentes (p. ej. de `bootstrap-tenant`), o sociedad ya usada | `409 TENANT_CONFLICT`, sin tocar lo existente |
| Error inesperado | `500 PROVISIONING_FAILED`, sin detalle de Postgres; nada persistido |

## 8. El owner PREPROVISIONED y su reclamo

`tenant_members.user_id` es NOT NULL y MasterAdmin **no crea usuarios de Auth**. Cambio de esquema
mínimo: el administrador pendiente vive en `platform_provisioning.requests` (`admin_email`,
`admin_provisioning_status`, `admin_user_id`, `admin_activated_at`). Al entrar por primera vez,
`fetchWorkspace` (solo si no tiene membresía) llama a `public.claim_provisioned_tenant()`, **sin
argumentos**. La base crea la membresía `owner` solo si coinciden: `org_id` del JWT = organización
aprovisionada, la sociedad está en `companies[]`, `email` del JWT = `adminEmail`, tenant `active`.
Idempotente; otro usuario no puede reclamar después; los intentos que no coinciden se auditan
(`CLAIM_ADMIN / REJECTED`). El GET pasa a `adminProvisioningStatus: ACTIVE`.

**Condición operativa:** el JWT del administrador tiene que traer esa organización y esa sociedad. En
DEV/QAS lo pone el hook de demo desde `app_metadata` (solo lo escribe el servidor; ver
`docs/integracion-hub/ALTA_DE_NEGOCIO_EN_DEV.md` pasos 2-3, con los ids del GET). En producción lo
emitirá el hub — ver §10.

## 9. Datos y seguridad

- `platform_provisioning.requests` (idempotencia, mapeo, admin pendiente) y
  `platform_provisioning.audit` (append-only: UPDATE/DELETE/TRUNCATE lanzan `AUDITORIA_INMUTABLE`).
  Esquema no expuesto por PostgREST, RLS activada y forzada, sin policies, **cero GRANT** a
  anon/authenticated/service_role, sin USAGE del esquema.
- `platform_provision_tenant`, `platform_get_provisioning`, `platform_record_provisioning_audit`:
  SECURITY DEFINER, `search_path = ''`, EXECUTE solo `service_role`.
- `claim_provisioned_tenant`: SECURITY DEFINER sin parámetros, EXECUTE `authenticated` (nunca anon).
- Nunca se loguea Authorization, JWT, service-role ni el cuerpo.
- `bootstrap-tenant` / `bootstrap_tenant` **sin cambios**.

## 10. Pendiente fuera del código

- **Alineación con el hub de identidad.** `tenants.organization_id` es, por diseño, el `org_id` del
  JWT del hub (`…090100…:14`). El hub no conoce todavía `ecommerce` (`docs/architecture.md:1102`),
  así que hoy los ids los genera eCommerce (igual que `ALTA_DE_NEGOCIO_EN_DEV.md` paso 1) y se
  devuelven como `external*Id` para que el operador/hub los registre. Cuando el hub emita tokens para
  eCommerce, tendrá que emitir **estos** ids para el tenant (o MasterAdmin tendrá que mandar el id del
  hub en el contrato, que es un cambio de contrato de suite). No bloquea QAS; sí el SSO de producción.
- Despliegue y secretos QAS: ver el informe de preparación (`docs/superpowers/reports/`).
