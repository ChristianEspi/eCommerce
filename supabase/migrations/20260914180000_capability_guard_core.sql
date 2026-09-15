-- =============================================================================
-- Cierre · D3 (1/4) — El guard central de capacidad y el fallback LEGADO
--
-- ## Qué cierra esta serie (180000–180300)
--
-- ADR 017 dejó tres capacidades vendibles gateadas SOLO en la UI:
-- `catalog.advanced` (PIM), `payments` y `fulfillment`. Un miembro legítimo
-- del tenant que hablara PostgREST con su token escribía variantes, medios de
-- pago o zonas de entrega sin el addon. Esta serie pone el candado en la base:
--
--   180000  guard central + fallback legado (este archivo)
--   180100  catalog.advanced → policies de escritura de las once tablas del PIM
--   180200  payments         → policies de `payment_methods` + operador de cobro
--   180300  fulfillment      → policies de la red de entrega + comandos de
--                              despacho y devoluciones del backoffice
--
-- ## Por qué NO se cerró antes, y qué cambia ahora
--
-- ADR 017 lo dijo con precisión: encender el candado ANTES de que el hub pueda
-- conceder el entitlement apaga PIM, cobros y entregas a TODO tenant, incluido
-- el que ya los usa. Eso sigue siendo verdad hoy: `ecommerce` no está dado de
-- alta en el hub (SAAS_GAPS §4.1) y la inmensa mayoría de sociedades no tiene
-- ni una fila en `tenant_platform_context`.
--
-- Lo que cambia es que el fallback deja de ser implícito («no hay candado») y
-- pasa a ser una regla EXPLÍCITA, acotada y con fecha de caducidad natural:
--
--   > Una capacidad marcada `legacy_until_synced` se considera contratada por
--   > una sociedad que el hub (o el aprovisionamiento) NUNCA ha sincronizado.
--   > En cuanto existe su fila en `tenant_platform_context`, manda la lista de
--   > entitlements y el candado es estricto.
--
-- ## Por qué esta forma y no las alternativas
--
-- · **Sembrar entitlements para los tenants existentes en la migración.** ADR
--   017 la descartó y el motivo se sostiene: es duplicar localmente el catálogo
--   comercial (principio 2), y además no cubre a la sociedad que se da de alta
--   mañana por autoservicio — que tampoco pasa por el hub y se quedaría sin los
--   módulos que hoy sí tiene. Una semilla es una foto; la regla es una
--   condición.
-- · **Tratar «sin sincronizar» como «todo contratado».** Un candado global que
--   se abre solo. Aquí el fallback es POR CAPACIDAD (columna en el registro
--   técnico) y hoy solo lo llevan las tres que nacieron sin candado. Las ocho
--   que ya lo tenían no cambian de comportamiento ni un milímetro.
-- · **Reclasificar las tres como baseline.** Decide el empaquetado comercial
--   desde el repositorio; el pliego las trata como módulos diferenciados.
--
-- ## Por qué es compatible con el hub / Control Plane
--
-- La señal es la MISMA que ya usa todo el modelo: `sync_platform_context` es la
-- única puerta de escritura del contexto y siempre deja la fila. El día que el
-- hub sincroniza una sociedad, esa sociedad pasa a estricta sin tocar nada
-- aquí: si el hub no devuelve `ecommerce.payments`, cobros queda cerrado en la
-- misma transacción. Y cuando el operador dé por terminado el periodo de
-- transición, retirar el fallback es un UPDATE sobre el registro técnico
-- (`legacy_until_synced = false`), no una migración de datos de tenant.
--
-- ## Por qué es tenant-safe
--
-- · Nada sale del llamante: ni la sociedad ni la condición. La fila de contexto
--   solo la escribe `service_role` (160000: sin GRANT ni policy de escritura
--   para `authenticated`), así que un tenant no puede «des-sincronizarse».
-- · `company_is_entitled` es SECURITY INVOKER y lee bajo la RLS de quien
--   pregunta. Un `authenticated` NO puede distinguir «sociedad sin sincronizar»
--   de «fila que no me dejan ver», así que el fallback solo se aplica cuando la
--   fila es visible de verdad: el llamante es miembro de la sociedad
--   (`ebim.can_access`) o la consulta corre en contexto de servidor (una
--   función SECURITY DEFINER o `service_role`). Para la sociedad de al lado la
--   respuesta sigue siendo `false` por falta de filas, como garantizaba 160000.
-- · Los flags técnicos siguen restando: un flag a `false` corta también el
--   módulo concedido por el fallback.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · El registro técnico dice qué capacidad tiene fallback legado
-- ---------------------------------------------------------------------------
alter table public.app_capabilities
  add column if not exists legacy_until_synced boolean not null default false;

-- Lo baseline no necesita fallback (ya lo tiene todo tenant) y un vendible con
-- fallback y sin código de addon no tendría forma de cerrarse nunca.
alter table public.app_capabilities
  drop constraint if exists app_capabilities_legacy_only_sellable;
alter table public.app_capabilities
  add constraint app_capabilities_legacy_only_sellable
  check (not legacy_until_synced or (not is_baseline and entitlement_code is not null));

comment on column public.app_capabilities.legacy_until_synced is
  'Fallback de transición (D3, 20260914180000): la capacidad se considera contratada por una sociedad que el hub/aprovisionamiento nunca sincronizó (sin fila en tenant_platform_context). Con la fila, manda tenant_entitlements. Retirar: UPDATE a false.';

-- Solo las tres que nacieron sin candado de servidor (ADR 017). Idempotente.
update public.app_capabilities
   set legacy_until_synced = true
 where code in ('catalog.advanced', 'payments', 'fulfillment')
   and not legacy_until_synced;

-- ---------------------------------------------------------------------------
-- 2 · ebim.company_is_entitled — la misma composición, con el fallback
--
-- Regla efectiva:
--   app activa AND (
--       baseline
--    OR ( (entitlement activo OR fallback legado) AND flag distinto de false )
--   )
-- donde fallback legado = capacidad marcada AND sociedad sin fila de contexto
-- AND la ausencia de fila es observable (miembro o contexto de servidor).
--
-- `current_user` y no `session_user`: dentro de una función SECURITY DEFINER
-- el rol efectivo es el dueño, que ve todas las filas — es exactamente el caso
-- en que la ausencia de fila significa «nunca sincronizada».
-- ---------------------------------------------------------------------------
create or replace function ebim.company_is_entitled(
  p_organization_id uuid,
  p_company_id uuid,
  p_capability text
)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
           (select ctx.app_active
              from public.tenant_platform_context ctx
             where ctx.organization_id = p_organization_id
               and ctx.company_id      = p_company_id),
           true)
     and exists (
       select 1
         from public.app_capabilities cap
        where cap.code = p_capability
          and (
            cap.is_baseline
            or (
              (
                exists (
                  select 1
                    from public.tenant_entitlements ent
                   where ent.organization_id  = p_organization_id
                     and ent.company_id       = p_company_id
                     and ent.entitlement_code = cap.entitlement_code
                     and ent.is_active
                )
                or (
                  cap.legacy_until_synced
                  and not exists (
                    select 1
                      from public.tenant_platform_context ctx
                     where ctx.organization_id = p_organization_id
                       and ctx.company_id      = p_company_id
                  )
                  and (
                    current_user not in ('anon', 'authenticated')
                    or ebim.can_access(p_organization_id, p_company_id)
                  )
                )
              )
              and coalesce(
                (select flag.is_enabled
                   from public.tenant_feature_flags flag
                  where flag.organization_id = p_organization_id
                    and flag.company_id      = p_company_id
                    and flag.flag_key        = cap.code),
                true)
            )
          )
     );
$fn$;

comment on function ebim.company_is_entitled(uuid, uuid, text) is
  '¿La sociedad tiene el módulo? app activa AND (baseline OR ((entitlement activo OR fallback legado de sociedad nunca sincronizada) AND flag <> false)). SECURITY INVOKER: para una sociedad ajena devuelve false.';

-- ---------------------------------------------------------------------------
-- 3 · ebim.assert_capability — EL guard de servidor para comandos
--
-- 160000 escribió y retiró un `assert_capability` porque nadie lo llamaba.
-- Ahora lo llaman los operadores de cobro, entrega y devolución (180200 y
-- 180300), así que vuelve con sus llamadores y sus tests.
--
-- No comprueba pertenencia A PROPÓSITO: se llama DESPUÉS del guard de rol del
-- comando (`assert_order_operator`, `assert_payment_operator`), que ya la
-- exige. Si la comprobara antes, un no-miembro recibiría «módulo no
-- contratado» sobre una sociedad ajena, que es contarle algo de ella. Delega
-- en `company_is_entitled`: una sola composición, no una segunda copia.
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_capability(
  p_organization_id uuid,
  p_company_id      uuid,
  p_capability      text
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not ebim.company_is_entitled(p_organization_id, p_company_id, p_capability) then
    raise exception 'MODULO_NO_CONTRATADO: el modulo % no esta activo en esta sociedad', p_capability
      using errcode = '42501';
  end if;
end;
$fn$;

-- Lo llaman funciones SECURITY DEFINER (corren como su dueño). Ninguna sesión
-- lo necesita directamente: preguntar por una capacidad ya tiene su RPC
-- (`effective_capabilities`).
revoke execute on function ebim.assert_capability(uuid, uuid, text) from public, anon, authenticated;
grant execute on function ebim.assert_capability(uuid, uuid, text) to service_role;

comment on function ebim.assert_capability(uuid, uuid, text) is
  'Guard central de capacidad para comandos de servidor. Levanta MODULO_NO_CONTRATADO (42501). Llamar DESPUÉS del guard de rol.';
