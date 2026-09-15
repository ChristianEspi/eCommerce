-- =============================================================================
-- Cierre · D3 (3/4) — `payments`: candado en la configuración y en los
--                      comandos del operador de cobro
--
-- Fallback y razonamiento general: cabecera de 20260914180000.
--
-- ## Qué cubre la capacidad, y qué no — la decisión
--
-- `payments` es «cobro en línea: autorización, captura, devolución y
-- conciliación» (src/domain/capabilities.ts). Del dominio de P09 hay tres
-- clases de escritura, y cada una recibe un trato distinto:
--
-- 1. **Configuración del comercio** — `payment_methods`, escrita por PostgREST
--    desde `/app/payments`. SE CIERRA en la policy: dar de alta o reactivar un
--    medio de pago es usar el módulo.
--
-- 2. **Comandos del operador** — `payment_refund_request`,
--    `payment_refund_settle` (rama de sesión), `payment_reconciliation_import`
--    y `payment_reconciliation_match`. Las cuatro autorizan con UNA función,
--    `ebim.assert_payment_operator`, escrita así «para que el día que una se
--    relaje se relajen todas o ninguna» (120100). SE CIERRA ahí, una vez, y las
--    cuatro heredan el candado sin reescribir su cuerpo. El guard de rol va
--    PRIMERO: un no-miembro sigue recibiendo SIN_PERMISO y no aprende nada
--    sobre los módulos de una sociedad ajena.
--
-- 3. **Camino del comprador y del proveedor** — `payment_intent_open`,
--    `payment_apply_outcome`, `payment_intent_attach_order`, la rama de
--    servidor de `payment_refund_settle` y la Edge Function `payments-webhook`.
--    NO SE CIERRA, y es deliberado:
--      · el checkout es de un único dueño (carril A) y la regla del cierre es
--        no tocar `_shared/checkout`, `create_order` ni `checkout_place_order`;
--      · el checkout ya se degrada solo: sin medio de pago (`payment_method_code`
--        null) la tienda vende con el pago pendiente, como antes de P09, y sin
--        el módulo no se pueden crear medios nuevos (punto 1);
--      · un aviso de pasarela o una devolución ya en curso son DINERO QUE YA SE
--        MOVIÓ. Rechazarlos porque el addon caducó ayer no evita el cobro:
--        solo borra su registro y descuadra la conciliación. La base tiene que
--        escuchar a la pasarela aunque el comercio haya dejado de pagar.
--
-- ## Lo que queda abierto (y está en el informe del carril)
--
-- Un tenant que TENÍA el módulo y lo pierde conserva sus medios activos, y el
-- checkout los sigue ofreciendo hasta que alguien los apague (puede: la policy
-- deja desactivar sin capacidad). Apagarlos solos al perder el entitlement
-- sería el mismo tratamiento que 140200 dio a la marca blanca, pero exige tocar
-- `sync_platform_context` y el camino de checkout; queda como decisión del
-- operador, no como efecto colateral de este candado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · payment_methods — alta y reactivación exigen el módulo
-- ---------------------------------------------------------------------------
drop policy if exists payment_methods_insert_admin on public.payment_methods;
drop policy if exists payment_methods_update_admin on public.payment_methods;

create policy payment_methods_insert_admin on public.payment_methods
  for insert to authenticated
  with check (
    ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[])
    and (not is_active or ebim.has_capability(organization_id, company_id, 'payments'))
  );

-- `using` sin capacidad: el tenant sin addon tiene que poder APAGAR el medio
-- que ya tiene, igual que la marca blanca en 160000. `with check` es lo que
-- impide dejarlo encendido.
create policy payment_methods_update_admin on public.payment_methods
  for update to authenticated
  using (ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[]))
  with check (
    ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[])
    and (not is_active or ebim.has_capability(organization_id, company_id, 'payments'))
  );

-- `payment_methods_delete_admin` no cambia: retirar configuración no concede
-- nada del módulo.

-- ---------------------------------------------------------------------------
-- 2 · El operador de cobro exige, además del rol, el módulo
--
-- Mismo cuerpo que 120100 más la última línea. `stable` y sin SECURITY DEFINER,
-- como estaba: la llaman funciones definer.
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_payment_operator(
  p_organization_id uuid,
  p_company_id      uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  -- Regla de suite: el super admin no es actor de negocio de un tenant. Aqui y
  -- no solo en el borde, porque un guard que vive en la Edge Function se salta
  -- llamando a la funcion por PostgREST.
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el super admin de suite no mueve dinero de un tenant'
      using errcode = '42501';
  end if;

  if not ebim.has_role(
       p_organization_id, p_company_id,
       array['owner','admin','orders']::public.app_role[])
  then
    raise exception 'SIN_PERMISO: hace falta rol de pedidos sobre este tenant'
      using errcode = '42501';
  end if;

  -- D3: el rol dice QUIÉN puede; la capacidad dice si la sociedad TIENE el
  -- módulo. Después del rol, para no informar a un no-miembro.
  perform ebim.assert_capability(p_organization_id, p_company_id, 'payments');
end;
$fn$;

revoke execute on function ebim.assert_payment_operator(uuid, uuid) from public, anon, authenticated;
