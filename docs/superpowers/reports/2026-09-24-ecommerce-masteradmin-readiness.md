# eCommerce · preparación para EBIM MasterAdmin (GENERIC v1) — 2026-09-24

**Veredicto:** `CERTIFIABLE_PENDING_REMOTE` — contrato implementado y verde en local (unit, PGlite,
pgTAP sobre Supabase local recién creado y HTTP de punta a punta por el edge runtime local). Falta
todo lo remoto, que este trabajo no hace por regla (sin push, sin deploy, sin secretos, sin SQL de
escritura remota).

Contrato detallado: [`docs/platform-provisioning/MASTERADMIN_GENERIC_CONTRACT.md`](../../platform-provisioning/MASTERADMIN_GENERIC_CONTRACT.md).

## 1. Rama

- Rama `feat/masteradmin-generic-provisioning`, desde `origin/dev` @ `0de6d50` (fetch del
  2026-09-24). `origin/dev` es la rama de integración vigente: `origin/qas` (`c17318b`) es `dev` + un
  merge commit y **el árbol es idéntico** (`git diff origin/dev origin/qas` vacío); incluye ya los
  hotfixes `20260923100000/110000` que `docs/MIGRACIONES_QAS_DEV.md` daba como solo-QAS.
- Worktree: `EBIM/eCommerce-worktrees/masteradmin-generic-provisioning`. El checkout principal
  (`feature/demo-commerce-release-candidate`) no se tocó.

## 2. Auditoría de arquitectura (re-verificada)

| Pregunta | Respuesta | Evidencia |
| --- | --- | --- |
| Raíz del tenant | `public.tenants`, PK = `organization_id` (el del hub por diseño) | `20260827090100_tenants_and_members.sql:14-17` |
| Sociedad | uuid del hub sin tabla local; `company_id` en toda fila de negocio | `CLAUDE.md:26`; no hay `public.companies` |
| Organización → tiendas | N sociedades × N tiendas; tienda de la sociedad | ADR 018 §1-3 |
| Productos compartidos | maestro por **sociedad**, publicado por tienda (`store_products`); dos sociedades nunca comparten | ADR 018 §5-6 |
| Onboarding hoy | `bootstrap-tenant` (clave estática `x-ebim-provisioning-key` o JWT propio) → `bootstrap_tenant` atómico, solo `service_role`; exige `owner_user_id`; `TENANT_YA_EXISTE` si se repite | `supabase/functions/bootstrap-tenant/index.ts`, `_shared/bootstrap.ts`, `20260827090700_server_operations.sql:51,63` |
| Hub de identidad | JWT con `org_id`, `companies[]`, `active_company`; el hub **no** conoce `ecommerce` todavía; DEV/QAS usa un hook que copia `app_metadata` | `docs/architecture.md:1102`, `20260827121000_dev_demo_auth_hook_strict.sql` |
| ¿Requiere tienda inicial? | **No**: `activeStore` puede ser `null` y la primera tienda la crea el owner con `create_store` | `src/features/tenant/workspace.ts:99`, ADR 018 §3 |
| Catálogo MasterAdmin | eCommerce no estaba en él | — |

**TENANT_ROOT:** organización (`public.tenants.organization_id`) + sociedad derivada + owner
PREPROVISIONED; **sin tienda inicial**.

## 3. Qué se implementó

| Archivo | Qué |
| --- | --- |
| `supabase/migrations/20260924120000_masteradmin_generic_provisioning.sql` | esquema privado `platform_provisioning` (requests + audit append-only), 3 RPC M2M solo service_role, `claim_provisioned_tenant()` para authenticated |
| `supabase/functions/_shared/platformProvisioning/{m2m,contract,errors,repository,handler}.ts` | verificador ES256, contrato GENERIC, errores estables, repositorio RPC, orquestación HTTP (portables, los prueba Vitest) |
| `supabase/functions/platform-provisioning/index.ts` | entrada Deno (service_role solo aquí) |
| `supabase/config.toml` | `[functions.platform-provisioning] verify_jwt = false` |
| `src/shared/lib/db-schema.ts`, `src/features/tenant/workspace.ts` | reclamo del owner al primer ingreso (solo sin membresía) |
| Tests | `supabase/tests/platform-provisioning-contract.test.ts`, `platform-provisioning-db.test.ts`, `supabase/tests/database/platform_provisioning.test.sql` (pgTAP), `src/features/tenant/workspace-claim.test.ts` |

`bootstrap-tenant` no cambia (probado: sigue creando tenant + owner + tienda, y un tenant suyo bloquea
un alta M2M con el mismo slug → 409).

## 4. Pruebas

| Comando | Resultado |
| --- | --- |
| `npx vitest run supabase/tests/platform-provisioning-*.test.ts` | 64/64 (token malo, iss/aud/sub/scope, caducado, vida>120, alg none/HS256, claim `role`, health 200/503, create 201, replay 200 mismos ids, GET 200/404, 409 ×4, sin usuario de Auth, privilegios, append-only, reclamo) |
| `npx vitest run src/features/tenant` | 29/29 (4 nuevos del reclamo) |
| `npm test` (suite completa) | **317 archivos, 6386/6386** |
| `npm run typecheck` · `npm run lint` · `npm run build` | verdes |
| `DENO_BIN=~/.deno/bin/deno npm run check:edge` | 111 archivos, sin errores |
| `supabase test db` sobre stack local recién creado (Postgres 15.8, 211 migraciones) | pgTAP **32/32** |
| HTTP E2E por el edge runtime local (`supabase functions serve`, clave de prueba efímera) | health 200 · sin token 401 · aud ajena 401 `INVALID_AUDIENCE` · scope de lectura 403 · create 201 PREPROVISIONED · replay 200 `replayed:true` mismos ids · misma clave otro cuerpo 409 · GET 200 · GET desconocido 404; bitácora con 6 filas; `auth.users` = 0 |

El stack local fue un proyecto efímero propio (`ecommerce-m2m-cert`, puertos 574xx) en el scratchpad,
detenido al terminar solo con `supabase stop --workdir <ese dir>`; los stacks de otros proyectos no se
tocaron. La clave privada de prueba se borró.

## 5. Clasificación de `ehxlxbhtlmfgneiagdcj`

Solo `SELECT` de conteos (sin datos de clientes):

| Señal | Valor |
| --- | --- |
| Proyecto | «eCommerce», sa-east-1, Postgres 17, creado 2026-08-27; único proyecto de eCommerce (`docs/MIGRACIONES_QAS_DEV.md`) |
| Config del repo | `supabase/config.toml:1-3` «Proyecto DEV/QAS de eCommerce» |
| Tenants / tiendas | 3 / 5 (`biel`, `miquimica`, `bata-store`, `tienda-tenant-b`, `botica-cerrada`: nombres de demo y de pruebas) |
| Usuarios Auth | 18, 4 con `ebim_demo = true` (hook DEV/QAS), 8 con correos de prueba/suite |
| Pedidos | 47 (27 con correos de prueba; 20 con dominios comunes, sin prueba de ser clientes reales) |
| Pagos | 96 `captured`, **todos** Culqi con referencia `clq-auth-…`, el formato del **simulacro** sin clave secreta (`_shared/payments/culqi.ts:145,215-221`); ningún `chr_…` de cargo real |
| Migraciones remotas | 210, última `20260924100000`; `platform_provisioning` **no existe** aún |

**Clasificación:** **DEV/QAS compartido (no PRD)** — confianza **alta**. **Clientes reales:** no hay
evidencia de cobros ni clientes reales (pagos simulados) — confianza **media-alta**; 20 pedidos con
correos de dominios comunes no se pueden descartar como pruebas del equipo sin mirar datos personales,
lo que no se hizo.

## 6. Pasos remotos pendientes (exactos, con autorización del operador)

1. Merge/PR de `feat/masteradmin-generic-provisioning` → `dev` → `qas` (este trabajo no empuja).
2. Aplicar la migración en QAS desde la rama promovida:
   `supabase db push --project-ref ehxlxbhtlmfgneiagdcj` (debe aplicar solo `20260924120000`; remoto
   hoy en `20260924100000`).
3. Secretos (valores fuera del repo; la pública es la de MasterAdmin QAS para `ecommerce.ebim`):
   `supabase secrets set --project-ref ehxlxbhtlmfgneiagdcj EBIM_MASTERADMIN_M2M_ENABLED=true
   EBIM_MASTERADMIN_M2M_ISSUER=masteradmin.ebim EBIM_MASTERADMIN_M2M_AUDIENCE=ecommerce.ebim
   EBIM_MASTERADMIN_M2M_SUBJECT=masteradmin-provisioning EBIM_MASTERADMIN_M2M_ALGORITHM=ES256
   EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME=120 EBIM_MASTERADMIN_M2M_CREATE_SCOPE=ecommerce:tenant:create
   EBIM_MASTERADMIN_M2M_READ_SCOPE=ecommerce:tenant:read` y
   `EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64=$(base64 < masteradmin-ecommerce-qas-public.pem | tr -d '\n')`
   (por `--env-file <(…)`, sin la clave en `argv`).
4. `supabase functions deploy platform-provisioning --project-ref ehxlxbhtlmfgneiagdcj --no-verify-jwt`.
5. MasterAdmin QAS: generar el par P-256 para eCommerce, cargar la privada como secreto (p. ej.
   `ECOMMERCE_QAS_M2M_PRIVATE_KEY`, PKCS#8), crear el credential profile e integración `HTTP_M2M` /
   `adapter_key GENERIC` con base `https://ehxlxbhtlmfgneiagdcj.supabase.co/functions/v1/platform-provisioning`,
   `create_path_template /tenants`, `status_path_template /tenants/{controlPlaneTenantId}`,
   `health /health`, `aud ecommerce.ebim`, scopes `ecommerce:tenant:create` / `ecommerce:tenant:read`,
   TTL 120; registrar el producto `ecommerce` en el catálogo de MasterAdmin.
6. Certificar en QAS: Test Connection (`/health` 200), GET_STATUS sobre una solicitud no aprovisionada
   (404 = firma/iss/aud/scope aceptados), alta real, `REPLAY_CERTIFICATION` (200 `replayed:true`).
7. Activación del owner en QAS: crear su usuario y fijar `app_metadata` (`ebim_demo`, `org_id` =
   `externalOrganizationId`, `companies` con `externalCompanyId`) como en
   `docs/integracion-hub/ALTA_DE_NEGOCIO_EN_DEV.md` pasos 2-3; al entrar, el reclamo lo hace owner.

## 7. Hallazgos

1. **Identidad hub ↔ MasterAdmin (abierto, no bloquea QAS):** `tenants.organization_id` es por diseño
   el `org_id` del hub, pero el contrato GENERIC no trae un id del hub. Se derivan ids UUIDv5 y se
   devuelven como `external*Id`; el hub tendrá que emitir esos ids en los JWT del tenant, o la suite
   añadir el id del hub al contrato. Bloquea el SSO de producción, no QAS.
2. **Un `supabase db reset`/stack local nuevo falla en `20260827090600_storage_buckets.sql`**
   (`alter table storage.objects enable row level security` → `must be owner of table objects` en
   las imágenes actuales de Supabase). Para certificar se comentó esa línea **solo en la copia
   efímera**; el repo no se tocó. Conviene una migración/guard aparte (fuera de este alcance).
3. `docs/MIGRACIONES_QAS_DEV.md` está desactualizado: los dos hotfixes ya están en `dev`.
4. `bootstrap-tenant` sigue con clave estática de larga vida (`EBIM_PROVISIONING_KEY`); el camino
   M2M no la usa. Retirarla es decisión del operador una vez certificado GENERIC.
5. El owner PREPROVISIONED no tiene invitación por correo (la app no envía invitaciones a quien no
   tiene cuenta, `20260911120000_invite_by_email.sql`); la activación depende de que su JWT traiga la
   organización (§6 paso 7).
