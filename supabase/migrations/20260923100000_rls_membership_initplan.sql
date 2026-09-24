-- =============================================================================
-- Rendimiento de la RLS: la membresía se resuelve UNA vez por consulta.
--
-- Síntoma (QAS, 2026-09-23): `ai_dashboard_facts` de una sociedad con ~3 800
-- filas de inventario tardaba ~26 s y el `statement_timeout` de 8 s de
-- `authenticated` la cancelaba (57014) → la Edge Function respondía
-- `ERROR_INTERNO`. No era volumen: `select count(*) from inventory_levels`
-- como miembro tardaba ~4 s y con el predicado de abajo ~0,14 s, mismas filas.
--
-- Causa: 154 policies usan `ebim.can_access(organization_id, company_id)` y
-- 243 `ebim.has_role(organization_id, company_id, ARRAY[...])`. Reciben
-- columnas de la fila, así que Postgres las ejecuta FILA A FILA, y cada
-- ejecución vuelve a leer los claims y consulta `tenant_members` (~1 ms).
--
-- Arreglo: la misma regla escrita como el contrato la enuncia
--   organization_id = jwt.org_id AND company_id = ANY(sociedades del usuario)
-- con las dos partes como subconsultas SIN correlación. Postgres las evalúa
-- una sola vez (InitPlan) y compara cada fila contra el resultado.
--
-- Equivalencia con `can_access` (que NO cambia y sigue siendo el guard de las
-- funciones): `member_companies()` devuelve exactamente las sociedades para las
-- que `can_access(org_id(), company)` es verdadero — `sub` presente, la sociedad
-- en `companies[]` del token, membresía `active` en `org_id()` y tenant
-- `active`. `has_role_companies(roles)` añade `role = any(roles)`, que es lo que
-- `has_role` añade a `can_access`. Lo prueba `rls-initplan.test.ts`.
--
-- Las funciones nuevas son SECURITY DEFINER por el mismo motivo que
-- `member_role`: leen `tenant_members` sin recursión de RLS y solo responden
-- sobre el `sub` del token — no aceptan tenant ni usuario como parámetro.
-- =============================================================================

create or replace function ebim.member_companies()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(m.company_id), '{}'::uuid[])
    from public.tenant_members m
    join public.tenants t on t.organization_id = m.organization_id
   where ebim.user_id()    is not null
     and m.organization_id = ebim.org_id()
     and m.company_id      = any (ebim.companies())
     and m.user_id         = ebim.user_id()
     and m.status          = 'active'
     and t.status          = 'active';
$fn$;

comment on function ebim.member_companies() is
  'Sociedades de org_id() donde el usuario del token tiene membresía activa (y que el token declara). Para policies: company_id = any ((select ebim.member_companies())::uuid[]) — se evalúa una vez por consulta. Equivale a can_access fila a fila.';

create or replace function ebim.has_role_companies(p_roles public.app_role[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(m.company_id), '{}'::uuid[])
    from public.tenant_members m
    join public.tenants t on t.organization_id = m.organization_id
   where ebim.user_id()    is not null
     and m.organization_id = ebim.org_id()
     and m.company_id      = any (ebim.companies())
     and m.user_id         = ebim.user_id()
     and m.status          = 'active'
     and t.status          = 'active'
     and m.role            = any (p_roles);
$fn$;

comment on function ebim.has_role_companies(public.app_role[]) is
  'Como member_companies() pero solo donde el rol del usuario está en p_roles. Equivale a has_role fila a fila.';

-- Mismos permisos que `can_access`/`has_role`: las policies afectadas son todas
-- `to authenticated` (lección esupplier-030: nada de `public`/`anon`).
revoke execute on function
  ebim.member_companies(),
  ebim.has_role_companies(public.app_role[])
from public, anon;

grant execute on function
  ebim.member_companies(),
  ebim.has_role_companies(public.app_role[])
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reescritura de las policies existentes.
--
-- Se trabaja sobre el texto que Postgres ya normalizó (`pg_policies`), así que
-- la forma exacta es conocida: `ebim.can_access(organization_id, company_id)` y
-- `ebim.has_role(organization_id, company_id, ARRAY[...])` con lista literal.
-- Solo se tocan esas dos formas con las columnas de la PROPIA fila; las
-- llamadas sobre otras columnas (p. ej. `r.organization_id` en una subconsulta)
-- se quedan como están. El resto del predicado no cambia.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_access     constant text := 'ebim.can_access(organization_id, company_id)';
  v_access_new constant text :=
    '(organization_id = (select ebim.org_id()) and company_id = any ((select ebim.member_companies())::uuid[]))';
  v_role_re    constant text := 'ebim\.has_role\(organization_id, company_id, (ARRAY\[[^]]*\])\)';
  v_role_new   constant text :=
    '(organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(\1))::uuid[]))';
  v_pattern    constant text := 'ebim\.(can_access|has_role)\(organization_id, company_id';
  r            record;
  v_sql        text;
  v_left       integer;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ v_pattern or coalesce(with_check, '') ~ v_pattern)
  loop
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      v_sql := v_sql || format(' using (%s)',
        regexp_replace(replace(r.qual, v_access, v_access_new), v_role_re, v_role_new, 'g'));
    end if;
    if r.with_check is not null then
      v_sql := v_sql || format(' with check (%s)',
        regexp_replace(replace(r.with_check, v_access, v_access_new), v_role_re, v_role_new, 'g'));
    end if;
    execute v_sql;
  end loop;

  -- Nada a medias: si quedó alguna forma que la reescritura no entendió, la
  -- migración entera se deshace en vez de dejar policies lentas sin avisar.
  select count(*) into v_left
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ v_pattern or coalesce(with_check, '') ~ v_pattern);
  if v_left > 0 then
    raise exception 'RLS_INITPLAN: % policies conservan la evaluacion por fila', v_left;
  end if;
end;
$do$;
