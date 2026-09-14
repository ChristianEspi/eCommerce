# Estado

**`HANDOFF_READY_QAS_PENDING`**

El código está congelado y re-verificado localmente; la documentación del operador está completa. La demo sobre QAS
depende de despliegue, configuración y datos que están fuera del repositorio y no se han verificado.

Sin `FREEZE_BLOCKER`: no se detectó ningún P0 (la app construye, checkout y pedidos verdes, aislamiento de tenant
verde, precio coherente).

# Release

| Dato | Valor |
|---|---|
| Branch | `feature/demo-commerce-release-candidate` |
| Commit funcional certificado | `23228c5` |
| HEAD al iniciar el handoff | `0395ca3` (solo documentación sobre `23228c5`: `FINAL_CERTIFICATION.md`, manifiesto, log) |
| Node | `v24.20.0` (mínimo ≥ 22.12, recomendado 24) |
| Working tree al iniciar | limpio salvo `docs/quality/` sin seguimiento (previo, no forma parte del RC ni de este handoff) |
| Cambios funcionales tras la certificación | ninguno (`git diff --stat 23228c5 HEAD` = 3 archivos de `docs/release-candidate/`) |

# Local Certification

Evidencia existente: [`FINAL_CERTIFICATION.md`](../release-candidate/FINAL_CERTIFICATION.md) — veredicto
`RC_GO_WITH_EXTERNAL_GAPS`, R10 en árbol limpio.

Re-ejecución en este handoff (2026-09-13, ejecutada ahora):

| Gate | R10 (certificación) | Handoff |
|---|---|---|
| `npm run typecheck` | PASS | PASS |
| `npm run lint` | PASS | PASS |
| `npm run test` | 207 · 3 940 ✓ · 0 ✗ | 207 · 3 940 ✓ · 0 ✗ |
| `npm run test:db` | 88 · 2 260 ✓ | 88 · 2 260 ✓ |
| `npm run build` | PASS · 1 700 módulos | PASS · 1 700 módulos |
| `npm run bundle:report` | 402,3 · 386,2 · 404,6 · 360,7 | 402,3 · 386,2 · 404,6 · 360,7 |
| `npm run scan:secrets` | PASS | PASS |
| E2E `npx playwright test` (pila local) | 56/56 | 56/56 |
| QA visual | 792/792 | no re-ejecutado (sin cambios de código ni de diseño) |
| `npm run smoke:qas` | NOT_RUN | NOT_RUN (sin `QAS_BASE_URL`) |
| Preflight (pila local) | FAIL solo por umbrales de catálogo del seed | idéntico |

# QAS Certification

| Ítem | Estado |
|---|---|
| RC desplegado / 7 migraciones / `checkout` / frontend | PENDING |
| Node 24 en Amplify | PENDING |
| SPA rewrite | PENDING |
| Auth Redirect URLs | PENDING |
| `smoke:qas` | PENDING (NOT_RUN) |
| `DEMO_PREFLIGHT_RC` | PENDING (NOT_RUN) |
| Consumer / Trade / Enterprise / Multiaccount / Mobile en QAS | PENDING |

Ningún ítem en PASS ni en BLOCKED: no hay evidencia de QAS en ningún sentido. Detalle en
[`QAS_CHECKLIST.md`](QAS_CHECKLIST.md).

# Demo Operator

- [`DEMO_HANDOFF.md`](DEMO_HANDOFF.md) — punto de entrada
- [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) — guion 15–20 min
- [`DEMO_CHEATSHEET.md`](DEMO_CHEATSHEET.md) — una página
- [`DEMO_RECOVERY.md`](DEMO_RECOVERY.md) — recuperación en vivo
- [`DEMO_DATA_CHECKLIST.md`](DEMO_DATA_CHECKLIST.md) — datos por rol
- [`QAS_CHECKLIST.md`](QAS_CHECKLIST.md) — despliegue y verificación
- [`FREEZE_POLICY.md`](FREEZE_POLICY.md) — congelación
- [`FINAL_HANDOFF_STATUS.md`](FINAL_HANDOFF_STATUS.md) — este documento

# Known gaps

Solo gaps reales, todos fuera del código:

| Gap | Cómo se cierra |
|---|---|
| Rama no fusionada en `dev` (sin push/PR) | PR revisado por orden del operador |
| QAS sin las 7 migraciones, `checkout` y frontend del RC | Manifiesto §1–§3 |
| Node 24 no fijado en el build de Amplify | `RUNTIME.md` |
| Reescritura SPA de Amplify no verificada (404 visto antes en QAS) | Manifiesto §5 + `smoke:qas` |
| Redirect URLs de Supabase Auth no configuradas/verificadas | Manifiesto §4 |
| Usuarios de demo (Consumer, Trade, Enterprise, Multi, Admin) no creados/verificados en QAS | Data Checklist + preflight |
| Productos principal y alternativo no confirmados en QAS | Preflight |
| Preflight y smoke contra QAS no ejecutados | Tras desplegar |
| Sin pasarela de pago real, sin correo transaccional verificado, sin `EBIM_AI_API_KEY` verificada | Operador; en demo: transferencia, no prometer correo, IA fuera del guion |
| Paridad de tipos de BD con QAS sin comprobar | `npm run db:types` en solo lectura tras migrar |
| Riesgos aceptados (no bloquean): 4 avisos moderados de `npm audit` no explotables; margen de portada 0,7 % | `DEPENDENCY_AUDIT.md`, `PERFORMANCE.md` |

# Freeze

**`ON`** — [`FREEZE_POLICY.md`](FREEZE_POLICY.md)
