# Freeze policy

```text
FEATURE_FREEZE = ON
Desde:  2026-09-13 (handoff de la demo, RC 23228c5)
Hasta:  después de la demo
Rama:   feature/demo-commerce-release-candidate
```

## No permitido

- Features nuevas.
- Upgrades de dependencias (incluidos React Router 7 y Vitest 4).
- Refactors.
- Migraciones nuevas.
- Cambios de theme / Theme Engine.
- Cambios de pricing, promociones, delivery, checkout u órdenes.
- Cambios de RLS o de aislamiento de tenant.
- Cambios UX cosméticos no críticos.
- Subir techos de bundle.
- Borrar, saltar (`skip`/`only`/`todo`) o rebajar tests.

## Permitido

- Documentación (typos, errores, completar `<DATO_DEMO_POR_CONFIRMAR>` con datos verificados).
- Scripts estrictamente documentales o de solo lectura.
- **Únicamente hotfix P0/P1 reproducible que afecte directamente la demo.**

| Prioridad | Ejemplos |
|---|---|
| P0 | La app no inicia · checkout no compila o no crea pedido · tenant isolation roto · precio cobrado incorrecto |
| P1 | Un bloque del guion no se puede completar en QAS con datos correctos (p. ej. OC no se guarda, portal no lista el pedido) |

Lo que **no** es hotfix: configuración de QAS (rewrite, Auth, Node, usuarios), datos de demo, gaps de roadmap.
Eso se resuelve fuera del código.

## Procedimiento de hotfix

```text
reproducirse  →  test  →  arreglarse  →  targeted tests  →  regression  →  documentarse
```

1. **Reproducirse**: pasos, rol, URL, entorno; confirmar que no es dato ni configuración.
2. **Test**: un test que falla con el código actual (RED).
3. **Arreglarse**: cambio mínimo, sin refactor alrededor.
4. **Targeted tests**: el test nuevo en verde (GREEN) + suites del área.
5. **Regression**: `typecheck`, `lint`, `test`, `test:db`, `build`, `bundle:report`, `scan:secrets` y E2E local.
6. **Documentarse**: entrada en `docs/release-candidate/EXECUTION_LOG.md` (o `docs/demo/`), commit local
   `fix: …` en español, sin push/PR/deploy sin orden explícita del operador.

Si se detecta un P0 y no hay autorización para arreglarlo: registrarlo como **`FREEZE_BLOCKER`** en
[`FINAL_HANDOFF_STATUS.md`](FINAL_HANDOFF_STATUS.md) y detenerse.
