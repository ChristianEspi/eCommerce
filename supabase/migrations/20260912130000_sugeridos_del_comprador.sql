-- =============================================================================
-- El sugerido de pedido, visto y decidido por el COMPRADOR.
--
-- ## El hueco que cierra
--
-- La pantalla de Planificación generaba un sugerido y lo marcaba «Enviado» o
-- «Aceptado», pero el cliente no lo veía en ningún sitio: «Enviar» no enviaba
-- nada y «Aceptar» no creaba ni un carrito. El aviso «tienes un pedido sugerido»
-- que añade el núcleo de notificaciones habría llevado a una pantalla vacía.
--
-- ## Lo que añade
--
--  · `my_order_suggestions()` — los sugeridos ENVIADOS a la empresa del
--    comprador, con sus líneas y su motivo.
--  · `accept_order_suggestion(id)` — lo marca aceptado y devuelve las líneas
--    para ponerlas en el carrito. El pedido sale por el checkout de siempre:
--    «la sugerencia NO crea pedidos» sigue siendo la regla de esta frontera.
--  · `discard_order_suggestion(id)` — el comprador lo descarta.
--
-- ## Autorización dentro, sin oráculo
--
-- Las tres son SECURITY DEFINER porque el comprador no es miembro del tenant y
-- la RLS de `order_suggestions` es de personal. La autorización es explícita:
-- estar vinculado ACTIVO, como comprador o administrador, a una cuenta B2B del
-- cliente del sugerido. Un sugerido que no existe y uno que no es tuyo
-- responden el MISMO error: distinguirlos permitiría averiguar ids ajenos.
-- =============================================================================

create or replace function ebim.can_decide_suggestion(p_suggestion public.order_suggestions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.business_account_users u
    join public.business_accounts a on a.id = u.business_account_id
    where u.user_id = ebim.user_id()
      and u.status = 'active'
      and u.role in ('admin', 'buyer')
      and a.is_active
      and a.customer_id = p_suggestion.customer_id
      and a.organization_id = p_suggestion.organization_id
      and a.company_id = p_suggestion.company_id
  );
$fn$;

revoke execute on function ebim.can_decide_suggestion(public.order_suggestions) from public;

create or replace function public.my_order_suggestions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(item order by item ->> 'generated_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',            s.id,
      'store_id',      s.store_id,
      'generated_at',  s.generated_at,
      'customer_name', c.name,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'product_id', i.product_id,
                 'variant_id', i.variant_id,
                 'name',       p.name,
                 'sku',        p.sku,
                 'quantity',   i.suggested_quantity::text,
                 'reason',     i.reason)
               order by i.position)
        from public.order_suggestion_items i
        join public.products p on p.id = i.product_id
        where i.suggestion_id = s.id
      ), '[]'::jsonb)
    ) as item
    from public.order_suggestions s
    join public.customers c on c.id = s.customer_id
    where s.status = 'sent'
      and ebim.can_decide_suggestion(s)
  ) sugeridos;
$fn$;

create or replace function public.accept_order_suggestion(p_suggestion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sugg public.order_suggestions%rowtype;
begin
  select * into v_sugg
  from public.order_suggestions s
  where s.id = p_suggestion_id
  for update;

  if not found or not ebim.can_decide_suggestion(v_sugg) then
    raise exception 'SUGERIDO_NO_DISPONIBLE: ese sugerido no está disponible' using errcode = '42501';
  end if;
  if v_sugg.status <> 'sent' then
    raise exception 'SUGERIDO_YA_DECIDIDO: ese sugerido ya fue decidido' using errcode = '22023';
  end if;

  update public.order_suggestions
     set status = 'accepted', updated_at = now()
   where id = v_sugg.id;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'product_id', i.product_id,
             'variant_id', i.variant_id,
             'quantity',   i.suggested_quantity::text)
           order by i.position)
    from public.order_suggestion_items i
    where i.suggestion_id = v_sugg.id
  ), '[]'::jsonb);
end;
$fn$;

create or replace function public.discard_order_suggestion(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sugg public.order_suggestions%rowtype;
begin
  select * into v_sugg
  from public.order_suggestions s
  where s.id = p_suggestion_id
  for update;

  if not found or not ebim.can_decide_suggestion(v_sugg) then
    raise exception 'SUGERIDO_NO_DISPONIBLE: ese sugerido no está disponible' using errcode = '42501';
  end if;
  if v_sugg.status <> 'sent' then
    raise exception 'SUGERIDO_YA_DECIDIDO: ese sugerido ya fue decidido' using errcode = '22023';
  end if;

  update public.order_suggestions
     set status = 'discarded', updated_at = now()
   where id = v_sugg.id;
end;
$fn$;

revoke execute on function public.my_order_suggestions() from public, anon;
revoke execute on function public.accept_order_suggestion(uuid) from public, anon;
revoke execute on function public.discard_order_suggestion(uuid) from public, anon;
grant  execute on function public.my_order_suggestions() to authenticated;
grant  execute on function public.accept_order_suggestion(uuid) to authenticated;
grant  execute on function public.discard_order_suggestion(uuid) to authenticated;
