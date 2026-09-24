# Dos migraciones que viven solo en `qas` — y por qué muerde

**Fecha del diagnóstico:** 2026-09-24 · **Proyecto Supabase:** `ehxlxbhtlmfgneiagdcj` (eCommerce, el único)

## El síntoma

`supabase db push` se niega a trabajar y responde:

```
Remote migration versions not found in local migrations directory.

Make sure your local git repo is up-to-date. If the error persists, try repairing the
migration history table:
supabase migration repair --status reverted 20260923100000 20260923110000

And update local migrations to match remote database:
supabase db pull
```

## La causa

Dos hotfixes del **2026-09-23**, escritos para un incidente de QAS, están **aplicados en la base** y
sus archivos existen **solo en `origin/qas`**:

| Versión | Migración | Commit | Qué arregla |
|---|---|---|---|
| `20260923100000` | `rls_membership_initplan` | `3a07d25` | Rendimiento de RLS. `ai_dashboard_facts` tardaba ~26 s en una sociedad con ~3 800 filas de inventario y el `statement_timeout` de 8 s la cancelaba (57014) → la Edge Function respondía `ERROR_INTERNO`. 154 policies llamaban `ebim.can_access(organization_id, company_id)` y 243 `ebim.has_role(...)` recibiendo columnas de la fila, así que Postgres las ejecutaba **fila a fila**. Ahora la membresía se resuelve una vez por consulta (InitPlan). Añade `ebim.member_companies()` y `ebim.has_role_companies()`. |
| `20260923110000` | `ai_dashboard_recent_orders` | `8171b68` | El analista IA del dashboard no sabía cuál fue la última venta: el dataset solo traía agregados y la cola de pedidos ordenada del más antiguo. Añade `orders.recent` (los 5 últimos) a `public.ai_dashboard_facts`. |

Nunca llegaron a `dev`. Cualquier rama que salga de `dev` no los tiene, y al hacer `db push` el CLI
encuentra en la base dos versiones que su carpeta local no conoce y se detiene.

`git branch -a --contains 3a07d25` → `remotes/origin/qas`, y nada más.

## Lo que NO hay que hacer

**`supabase migration repair --status reverted 20260923100000 20260923110000`** — es lo que sugiere
el CLI y borraría del registro dos migraciones que **sí están aplicadas**. El servidor pasaría a
afirmar que nunca se ejecutaron; quien se traiga `qas` y haga push volvería a lanzarlas, y el
historial quedaría mintiendo sobre el estado real de la base. Comprobado que están aplicadas: sus
objetos (`ebim.member_companies`, `ebim.has_role_companies`, `public.ai_dashboard_facts` con
`orders.recent`) están vivos, y el propio registro conserva su SQL.

**`supabase db pull`** — generaría una migración gigante de «esquema remoto» duplicando las 210 que
ya están en `supabase/migrations`.

## Lo que sí

**Mergear `qas` hacia `dev`.** Es el arreglo de raíz y cierra las dos consecuencias:

1. El `db push` deja de fallar desde cualquier rama nueva.
2. Y la importante: **el arreglo de RLS llega a producción**. Mientras siga solo en `qas`, una
   promoción desde `dev` se lleva el `statement_timeout` de vuelta.

Si hace falta aplicar base **antes** de ese merge, dos salidas:

- Hacer el PR a `qas` primero: allí los dos archivos ya están, así que el resultado del merge es un
  superconjunto del registro del servidor y `db push` aplica solo lo que falta.
- O `git cherry-pick 3a07d25 8171b68` en la rama desde la que se empuja. Comprobado que no colisiona
  con Storefront V3: esos commits tocan `docs/STATE.md`, `supabase/tests/rls-initplan.test.ts`,
  `src/features/admin/dashboard/aiAnalyst.ts` y `supabase/functions/_shared/aiInsights.ts`, y V3 no
  toca ninguno.

## Estado al cerrar el diagnóstico

Reconciliación exacta entre el repo y el servidor:

| | |
|---|---|
| Versiones aplicadas en la base | **210** |
| Versiones presentes en alguna rama del repo | **210** |
| Pendientes de aplicar | **0** |
| Aplicadas que no existen en ninguna rama | **0** |

Las tres migraciones de Storefront V3 —`20260923180000_store_identity_v3`,
`20260923190000_theme_contract_v3` y `20260924100000_home_layout_v2`— quedaron aplicadas **por el
CLI** (el registro conserva 25, 4 y 12 sentencias respectivamente; una aplicación por SQL directo
habría dejado ese campo vacío). El mensaje de arriba era una advertencia sobre las otras dos, no un
fallo de estas.

Verificado además objeto por objeto: las 5 columnas en `store_settings`, las 5 en `public_stores`,
los 6 validadores de `ebim`, los 4 CHECK, los permisos (`anon` solo SELECT, `PUBLIC` sin nada,
`execute` revocado a `public`) y el comportamiento del contrato —acepta el estilo V3 y el layout V2,
rechaza versión 3, contraste en familias, CSS colado y HTML en un aviso—.
