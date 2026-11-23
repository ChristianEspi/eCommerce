-- =============================================================================
-- Seguimiento de un pedido para el comprador (2026-11-22)
-- =============================================================================
--
-- «¿Dónde está mi pedido?» / «¿por qué se retrasó?» en el chat de la vitrina.
-- Por cada entrega del pedido: estado, fecha prometida, días de retraso (hoy
-- pasado la fecha prometida y sin entregar), el ÚLTIMO estado canónico del
-- seguimiento del operador y cuántos intentos de entrega fallaron.
--
-- Lo que NO devuelve: dirección, guía, URL, descripción o ubicación del
-- operador (texto libre de un tercero), datos de quien recibió. El chat explica
-- con estados y fechas; no inventa causas.
--
-- SECURITY DEFINER como `my_business_order_detail`: el comprador no tiene
-- SELECT sobre entregas. Autorización explícita: sesión + tienda activa + el
-- pedido es SUYO (comprador del pedido o miembro activo de la cuenta de empresa
-- del pedido). Otro pedido ⇒ null, sin distinguir «no existe» de «no es tuyo».
-- =============================================================================

create or replace function public.my_order_tracking(p_store_slug text, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := ebim.user_id();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.stores s on s.id = o.store_id and s.status = 'active'
   where o.id = p_order_id
     and s.slug = lower(btrim(coalesce(p_store_slug, '')))
     and (
       exists (select 1 from public.order_buyers b where b.order_id = o.id and b.user_id = v_uid)
       or exists (select 1
                    from public.business_account_users u
                    join public.business_accounts a on a.id = u.business_account_id and a.is_active
                   where u.business_account_id = o.business_account_id
                     and u.user_id = v_uid
                     and u.status = 'active')
     );
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'order_number',       v_order.order_number,
    'status',             v_order.status,
    'fulfillment_status', v_order.fulfillment_status,
    'entregas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'metodo',          f.method_name,
               'estado',          f.state,
               'prometido_desde', f.promised_from,
               'prometido_hasta', f.promised_to,
               'enviado',         f.shipped_at::date,
               'entregado',       f.delivered_at::date,
               'dias_retraso',    case
                                    when f.promised_to is not null
                                     and f.state not in ('delivered', 'cancelled')
                                     and current_date > f.promised_to
                                    then current_date - f.promised_to
                                    else 0
                                  end,
               'ultimo_evento',   (select jsonb_build_object('estado', te.status, 'fecha', te.occurred_at::date)
                                     from public.tracking_events te
                                     join public.shipments sh on sh.id = te.shipment_id
                                    where sh.fulfillment_id = f.id
                                    order by te.occurred_at desc
                                    limit 1),
               'intentos_fallidos', (select count(*)::int
                                       from public.tracking_events te
                                       join public.shipments sh on sh.id = te.shipment_id
                                      where sh.fulfillment_id = f.id
                                        and te.status = 'delivery_attempted'))
             order by f.sequence)
        from public.fulfillments f
       where f.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.my_order_tracking(text, uuid) from public, anon;
grant  execute on function public.my_order_tracking(text, uuid) to authenticated;

comment on function public.my_order_tracking(text, uuid) is
  'Seguimiento de UN pedido del comprador: por entrega, estado, fecha prometida, días de retraso, último estado del operador e intentos fallidos. Sin dirección, guía ni texto del operador.';
