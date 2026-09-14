# Checklist de QAS

**Estado a 2026-09-13: nada verificado en QAS.** Ningún paso se ejecutó contra DEV/QAS/PRD desde la rama del RC.
Una casilla solo se marca con **evidencia** (salida de comando, captura o log de consola) anotada en la columna.

Procedimiento exacto: [`../release-candidate/DEPLOYMENT_MANIFEST.md`](../release-candidate/DEPLOYMENT_MANIFEST.md).

```text
[ ] RC correcto desplegado
[ ] 7 migraciones
[ ] checkout actualizado
[ ] frontend actualizado
[ ] Node 24
[ ] SPA rewrite
[ ] Auth redirect URLs
[ ] smoke:qas PASS
[ ] DEMO_PREFLIGHT_RC PASS
[ ] Consumer PASS
[ ] Trade PASS
[ ] Enterprise PASS
[ ] Multiaccount PASS
[ ] Mobile PASS
```

## Detalle y evidencia requerida

| # | Ítem | Estado | Cómo se verifica | Evidencia |
|---|---|---|---|---|
| 1 | RC correcto desplegado | PENDING | Rama fusionada en `dev` por PR revisado; el build de QAS sale de un commit que contiene `23228c5` (`git merge-base --is-ancestor 23228c5 <commit-desplegado>`) | — |
| 2 | 7 migraciones | PENDING | SHA-256 coincide con el manifiesto §1; aplicadas **en orden** `20260913100000` … `20260913160000`; preflight STORE «Migraciones…» OK; `npm run db:types` contra QAS (solo lectura) sin diferencias de objetos | — |
| 3 | `checkout` actualizado | PENDING | Desplegada **después** de las migraciones 4 y 6; `create-order` recomendada | — |
| 4 | Frontend actualizado | PENDING | Publicado **después** de la migración 6; `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` definidas (si faltan no hay `_headers`/CSP) | — |
| 5 | Node 24 | PENDING | Log del build de Amplify: `node --version` → `v24.x` (`RUNTIME.md`) | — |
| 6 | SPA rewrite | PENDING | Amplify *Rewrites and redirects* → `/index.html` 200 (manifiesto §5); F5 en `/s/<slug>/cart` no da 404 | — |
| 7 | Auth redirect URLs | PENDING | Supabase QAS → *URL Configuration* incluye `https://<host>/**` (manifiesto §4); alta y recuperación vuelven a la tienda | — |
| 8 | `smoke:qas` PASS | NOT_RUN | `QAS_BASE_URL=https://<host> QAS_STORE_SLUG=<slug> npm run smoke:qas` → `QAS_READ_ONLY_SMOKE = PASS` | — |
| 9 | `DEMO_PREFLIGHT_RC` PASS | NOT_RUN | Ver [`DEMO_DATA_CHECKLIST.md`](DEMO_DATA_CHECKLIST.md) → `DEMO_PREFLIGHT_RC = PASS` | — |
| 10 | Consumer PASS | PENDING | Manual: Bloque B del runbook (invitado + registrado) completo en QAS | — |
| 11 | Trade PASS | PENDING | Manual: Bloque C completo; precio Trade < público | — |
| 12 | Enterprise PASS | PENDING | Manual: Bloque D completo con OC y portal | — |
| 13 | Multiaccount PASS | PENDING | Manual: «Cambiar cuenta» A → B cambia precio y pedido queda con B | — |
| 14 | Mobile PASS | PENDING | `npx playwright test --project=escritorio --project=movil` contra QAS (**nunca** `comercio-*`: crean usuarios y pedidos) + recorrido manual a 390 px | — |

## Reglas

- Los ensayos manuales 10–13 **crean pedidos reales** en QAS: hacerlos con los usuarios de demo y apuntar los números.
- Ante un fallo en 2–4: detener, **roll-forward** (manifiesto §7), nunca editar una migración aplicada ni `drop` de
  tablas con datos.
- Nota histórica (2026-09-08): DEV y QAS compartían la misma base Supabase. Si sigue siendo así, aplicar las
  migraciones «a QAS» también las aplica a DEV. Confirmarlo antes de empezar.
- Solo con las 14 casillas marcadas con evidencia el estado pasa a **`QAS_READY_FOR_DEMO`**.
