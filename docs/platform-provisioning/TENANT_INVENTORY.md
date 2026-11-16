# eCommerce · `tenant-inventory.v1` (inventario y vínculo) con EBIM MasterAdmin

**Estado:** implementado en `dev` (2026-11-16), probado sobre PGlite. **No desplegado.**
Contrato de suite: `masteradmin/docs/platform-provisioning/TENANT_INVENTORY_CONTRACT.md` (§1–7
inventario, §8 vínculo). Consumidor: `masteradmin/supabase/functions/_shared/sync/readers.ts`.

## 1. Rutas

Mismo canal que el alta, el estado, entitlements y lifecycle: Edge Function `platform-provisioning`
(`verify_jwt = false`, JWT ES256 de MasterAdmin, mismo `iss`/`aud`/`sub`, TTL ≤ `MAX_TOKEN_LIFETIME`,
`jti` de un solo uso compartido con entitlements y lifecycle).

| Método y ruta | Scope | Respuestas |
| --- | --- | --- |
| `GET /platform-provisioning/tenants?limit=1..500&cursor=…` | `ecommerce:tenants:list` | `200` · `400 INVALID_INVENTORY_QUERY` · `401` · `403` · `500 INVENTORY_FAILED` · `503 INVENTORY_NOT_CONFIGURED` |
| `PUT /platform-provisioning/tenants/{controlPlaneTenantId}/link` | `ecommerce:tenants:link` | `200 LINKED / ALREADY_LINKED` · `400 INVALID_LINK_REQUEST` · `401` · `403` · `404 EXTERNAL_TENANT_NOT_FOUND` · `409 LINK_CONFLICT` · `500 TENANT_LINK_FAILED` · `503 TENANT_LINK_NOT_CONFIGURED` |

Choque de rutas: `GET /tenants` es el inventario, `POST /tenants` el alta y `GET /tenants/{id}` el
estado (`isInventoryRoute` despacha antes que provisioning). `/tenants` con otro método → `405`,
`Allow: GET, POST`.

## 2. Variables (solo nombres)

| Variable | Valor | Sin ella |
| --- | --- | --- |
| `EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE` | `ecommerce:tenants:list` | `GET /tenants` → 503 |
| `EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE` | `ecommerce:tenants:link` | `PUT …/link` → 503 |

Reutiliza `EBIM_MASTERADMIN_M2M_*` (clave, emisor, audiencia, sujeto) y `EBIM_ENTITLEMENTS_ENVIRONMENT`
/ `EBIM_ENTITLEMENTS_PRODUCT_CODE` (el `environment` y `productCode` de las respuestas). Un scope igual
al de alta, estado, entitlements, lifecycle o al del otro canal anula la configuración (503).
En MasterAdmin: `configure_inventory_integration('<integración>', '/tenants', 'ecommerce:tenants:list')`.

## 3. Inventario

`public.platform_list_tenants(p_after, p_limit)` (migración `20261116110000_tenant_inventory_and_link.sql`,
SECURITY DEFINER, solo `service_role`). Lista **todos** los `public.tenants` (demo, smoke e internos
incluidos), ordenados por `organization_id`, keyset: el cursor es opaco (base64url de `inv1:<último id>`).

| Campo | Valor |
| --- | --- |
| `externalTenantId`, `externalOrganizationId` | `organization_id` — el mismo `externalTenantId` que devuelve el alta |
| `externalCompanyId` | la sociedad del alta; si no la hay, la principal (`platform_provisioning.primary_company`: contexto del hub → owner activo más antiguo → cualquier miembro → tienda más antigua); `null` si no hay ninguna |
| `controlPlaneTenantId` | del registro ACTIVE de `platform_provisioning.requests` (alta o vínculo); si no, `null` |
| `code`, `name` | `tenants.slug`, `tenants.name` |
| `status` | `closed` → `INACTIVE`; `suspended` (bloqueo propio) o lifecycle.v1 `SUSPENDED` → `SUSPENDED`; resto → `ACTIVE` |

Sin usuarios, correos, importes ni datos fiscales.

## 4. Vínculo («adoptar un tenant existente»)

Cuerpo: `{"externalTenantId":"<uuid>","requestId":"<uuid>"}` (`Content-Type: application/json`;
`X-MasterAdmin-Contract`, si viene, `tenant-inventory.v1`). Se toleran campos extra, salvo `contract`,
`controlPlaneTenantId`, `productCode` o `environment` con otro valor (400).

`public.platform_link_tenant` escribe **solo** una fila en `platform_provisioning.requests`
(`status = ACTIVE`, `idempotency_key = link:<cpt>`, `request_payload.origin = LINKED`, `linked = true`)
y la bitácora `platform_provisioning.audit` (`operation = LINK_TENANT`, resultados `LINKED`,
`ALREADY_LINKED`, `REJECTED`, `CONFLICT`, `ERROR`). No toca el tenant, sus usuarios, módulos ni datos.

- Sociedad: la principal (§3); si no hay ninguna, la derivada del cpt con la misma regla que el alta
  (`uuid5(NS, "company:<cpt>")`).
- Administrador: si esa sociedad tiene un owner activo, el registro nace `ACTIVE` apuntando a él; si no,
  `PREPROVISIONED` con `tenants.admin_email` y el reclamo normal al primer ingreso.
- Idempotente: mismo cpt + mismo tenant → `ALREADY_LINKED` (también para un tenant que creó MasterAdmin).
- `409 LINK_CONFLICT`: el tenant ya tiene otro cpt, o el cpt ya apunta a otro tenant (incluido un alta
  cuyo tenant se borró: hay que resolverlo a mano, no se re-vincula solo).

Tras vincular, `GET /tenants/{cpt}`, entitlements.v1 y lifecycle.v1 resuelven el tenant igual que uno
creado por MasterAdmin (todos leen el mismo registro).

## 5. Altas cuyo tenant ya no existe

QAS tiene un registro ACTIVE (smoke del 2026-09-25) cuyo `public.tenants` se borró. El inventario no lo
lista (lista tenants, no registros). Desde esta migración el estado responde **404
`PROVISIONING_NOT_FOUND`** (antes `200` con `status: TENANT_MISSING`, que MasterAdmin rechaza: el
contrato GENERIC solo admite `ACTIVE`/`PENDING`) y lifecycle.v1 **404 `TENANT_NOT_PROVISIONED`**:
MasterAdmin lo ve como vínculo roto.

## 6. Pruebas

`supabase/tests/platform-inventory-contract.test.ts`: configuración fail-closed, 401/403/`jti`, despacho
de rutas, paridad de `externalTenantId` con el alta real, paginación y cursor, estados, alta huérfana,
`LINKED`/`ALREADY_LINKED`/404/409/400, estado y lifecycle tras vincular, permisos de las RPC y bitácora.

## 7. Al promover `dev` → `qas` (operador)

1. Migraciones `20261116100000_tenant_lifecycle.sql` y `20261116110000_tenant_inventory_and_link.sql`.
2. Secretos `EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE` y `EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE` (y los
   de lifecycle si aún no están) y redeploy de `platform-provisioning`.
3. En MasterAdmin: `configure_inventory_integration` y la configuración del vínculo (§8 del contrato).
