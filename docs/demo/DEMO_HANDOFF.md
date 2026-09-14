# eCommerce by EBIM — handoff de la demo

```text
Release:                    eCommerce Release Candidate (RC_GO_WITH_EXTERNAL_GAPS)
Branch:                     feature/demo-commerce-release-candidate
Commit funcional certificado: 23228c5
Estado:                     LOCAL_RC_READY_QAS_PENDING
QAS:                        NO desplegado · smoke NOT_RUN · preflight NOT_RUN
Fecha:                      2026-09-13
```

- `23228c5` es el árbol de código certificado en [`FINAL_CERTIFICATION.md`](../release-candidate/FINAL_CERTIFICATION.md).
  Después solo hay documentación (`0395ca3`, y este handoff). Último commit que toca código de runtime: `6c9eb87`
  (tipos de BD) / `99adc5b` (fix de entrega); último que toca scripts: `f2a5927` (preflight).
- Node: mínimo ≥ 22.12, recomendado **24** (`.nvmrc`); handoff verificado con `v24.20.0`.
- **FEATURE FREEZE = ON** — ver [`FREEZE_POLICY.md`](FREEZE_POLICY.md).

> Quien lea esto no necesita haber participado en la implementación. Si solo vas a presentar, lee en este orden:
> este archivo → [`QAS_CHECKLIST.md`](QAS_CHECKLIST.md) → [`DEMO_DATA_CHECKLIST.md`](DEMO_DATA_CHECKLIST.md) →
> [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) → imprime [`DEMO_CHEATSHEET.md`](DEMO_CHEATSHEET.md) y ten abierto
> [`DEMO_RECOVERY.md`](DEMO_RECOVERY.md).

## Qué estamos demostrando

Una plataforma SaaS de comercio digital **multitenant y multirrubro** que usa **un mismo motor** de catálogo, pricing,
promociones, carrito, checkout y órdenes para atender distintos modelos comerciales. No es una tienda hecha para un
cliente: la tienda, su catálogo, su marca, su portada y su tema son configuración y datos del tenant.

### Consumer B2C — persona natural

Precio público · promociones · compra como invitado · registro dentro de la tienda · «Mi cuenta» · pedidos ·
direcciones · favoritos.

### Trade / Reseller — negocio minorista

Cuenta comercial · precio especial calculado por el servidor · precio comercial visible en el catálogo · promociones
dirigidas · checkout común · pedido.

### Enterprise B2B — empresa corporativa

Varias cuentas por comprador («Comprando para») · convenio de precios · promociones segmentadas · entrega calculada con
el contexto de la cuenta · orden de compra (OC) obligatoria cuando la cuenta la exige · portal empresarial.

### Theme Engine

Cuatro temas sobre el mismo código: **Universal, Retail, Premium, Catalog**. Se eligen en el backoffice
(Configuración → Diseño de tienda) con vista previa antes de guardar.

## Lo que garantiza el código (evidencia)

Resumen; detalle y cifras en [`FINAL_CERTIFICATION.md`](../release-candidate/FINAL_CERTIFICATION.md).

| Área | Garantía | Evidencia |
|---|---|---|
| Precio | Lo decide el servidor con la **cuenta efectiva**; el navegador no envía importes ni identidad comercial | `commerce-audience-guard`, `effective-business-account` 23, E2E trade/enterprise/multi |
| Promociones | Lo que se ve en el carrito = lo que cobra el pedido (también dirigidas) | `targeted-promotions` 8, E2E |
| Entrega | Cotizado = cobrado para invitado, Trade, Enterprise y multi-cuenta | `delivery-buyer-pricing` 8 (RED/GREEN en R01) |
| OC | Exigida en servidor antes de cobrar (`422 ORDEN_COMPRA_REQUERIDA`) | `purchase-order` 13, E2E |
| Tenant | RLS forzada en todo `public`, aislamiento por tenant/tienda/usuario | `schema-invariants`, `rls-tenant-isolation`, `security-baseline` |
| Temas | 4 temas × 3 audiencias × 3 viewports sin defectos | QA visual 792/792 |

### Re-verificación en este handoff (2026-09-13, ejecutada ahora, Node 24.20.0, árbol = `0395ca3`)

| Gate | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test` | 207 archivos · 3 940 ✓ · 0 ✗ |
| `npm run test:db` | 88 archivos · 2 260 ✓ |
| `npm run build` | PASS · 1 700 módulos (sin `VITE_*` en esta máquina: no genera `_headers`/CSP, igual que en la certificación) |
| `npm run bundle:report` | 402,3 / 386,2 / 404,6 / 360,7 kB — dentro de techos 405 / 400 / 430 / 430 |
| `npm run scan:secrets` | PASS, sin hallazgos |
| `npx playwright test` (pila Supabase local desechable, puerto 5199) | **56/56** (fixtures locales repuestas y función `checkout` sincronizada; los pedidos/usuarios creados quedan solo en esa pila) |
| `npm run smoke:qas` | `QAS_READ_ONLY_SMOKE = NOT_RUN` (no hay `QAS_BASE_URL`) |
| `demo-preflight.mjs` (pila local) | `FAIL` solo por los 6 umbrales de catálogo del seed local (8 productos); B2C, TRADE, ENTERPRISE, OC, migraciones: OK. Mismo resultado que R07 |

Coinciden con R10. No hay regresiones ni cambios funcionales posteriores a la certificación.

## Qué está listo y qué no

| Listo en código (repositorio) | Depende de QAS / operador (fuera del repo) |
|---|---|
| Las tres experiencias hasta pedido, E2E 56/56 | Fusionar la rama en `dev` por PR revisado |
| 7 migraciones con SHA-256 y orden | Aplicarlas en QAS ([manifiesto §1](../release-candidate/DEPLOYMENT_MANIFEST.md)) |
| Edge Function `checkout` (REQUIRED), `create-order` (RECOMMENDED) | Desplegarlas después de las migraciones |
| Frontend construible con Node 24 | Build en Amplify con Node 24 y `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` |
| Rutas SPA | Reescritura SPA en Amplify (sin ella, F5 en `/s/<slug>/…` = 404) |
| Alta y recuperación con vuelta a la tienda | Redirect URLs de Supabase Auth: `https://<host>/**` |
| Preflight y smoke de solo lectura | Ejecutarlos contra QAS y obtener PASS |
| — | Crear usuarios de demo (Consumer, Trade, Enterprise, Multi, Admin) |
| — | Pasarela de pago real, correo transaccional, clave de IA (no configurados; ver Recovery) |

Mientras la columna derecha no esté cerrada con evidencia, el estado es **`LOCAL_RC_READY_QAS_PENDING`**. No se
declara `QAS_READY_FOR_DEMO` sin `smoke:qas = PASS` y `DEMO_PREFLIGHT_RC = PASS` contra QAS.

## Datos de demo

- Tienda documentada: **`miquimica`** → vitrina `/s/miquimica`, backoffice `/app`.
- **Ninguna credencial está en el repositorio** ni en estos documentos. Los usuarios `*@hardening.test` existen solo
  en la pila local desechable.
- Nota histórica (2026-09-08, [`DEMO_WEDNESDAY_README.md`](../../DEMO_WEDNESDAY_README.md)): DEV y QAS compartían la
  misma base Supabase y había un login B2B de demo (cuenta «Policlinico Andino SAC», segmento `clinicas`). Debe
  **reconfirmarse** con el preflight antes de usarlo: es anterior a este RC.

## Fuera del alcance de esta demo

No son bugs. **No deben arreglarse justo antes de la demo.**

- Employee Commerce (solo mencionable como roadmap que la arquitectura soporta).
- True Channel Resolver (B2C/B2B/Internal por canal).
- Alta self-service de Trade/Reseller (las cuentas B2B las crea el comercio).
- PDF adjunto de OC (existe el número de OC, no el archivo).
- WYSIWYG real en Diseño de tienda.
- Migración a React Router 7.
- Migración a Vitest 4.
- Optimizaciones mayores de bundle (portada con 0,7 % de margen; ver `PERFORMANCE.md`).
- Quinto tema.

## Documentos

| Documento | Para qué |
|---|---|
| [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) | Guion exacto de 15–20 min, bloque a bloque |
| [`DEMO_CHEATSHEET.md`](DEMO_CHEATSHEET.md) | Una página para tener al lado |
| [`DEMO_RECOVERY.md`](DEMO_RECOVERY.md) | Qué hacer si algo falla en vivo |
| [`DEMO_DATA_CHECKLIST.md`](DEMO_DATA_CHECKLIST.md) | Datos por rol que deben existir |
| [`QAS_CHECKLIST.md`](QAS_CHECKLIST.md) | Qué debe estar desplegado y verificado |
| [`FREEZE_POLICY.md`](FREEZE_POLICY.md) | Qué se puede tocar hasta después de la demo |
| [`FINAL_HANDOFF_STATUS.md`](FINAL_HANDOFF_STATUS.md) | Estado de cierre |
| [`../release-candidate/DEPLOYMENT_MANIFEST.md`](../release-candidate/DEPLOYMENT_MANIFEST.md) | Despliegue exacto a QAS |
