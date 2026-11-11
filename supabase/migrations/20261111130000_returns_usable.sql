-- =============================================================================
-- Devoluciones utilizables de punta a punta.
--
-- Encontrado en la prueba de punta a punta (2026-11-11): el dominio existía
-- (`return_request_for_slug`, `return_open`, decidir, recibir, inspeccionar,
-- cerrar) pero no se podía INICIAR una devolución desde ningún sitio:
--
--   1. Ninguna tienda tenía motivos (`return_reasons` vacía en las tiendas
--      reales), y sin motivo `ebim.open_return` responde MOTIVO_NO_VALIDO.
--   2. La tienda no tenía de dónde sacar los ids de línea: `order_by_token` los
--      recorta a propósito.
--   3. «Mis pedidos» no enlazaba a la página del pedido: el token no sale de
--      las funciones de cuenta.
--
-- Esta migración cierra las tres piezas de base; las pantallas van en el front.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Motivos por defecto, para las tiendas de hoy y las de mañana
-- ---------------------------------------------------------------------------
create or replace function ebim.seed_default_return_reasons(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  insert into public.return_reasons
    (organization_id, company_id, store_id, code, label, description, requires_evidence, restock_default, position)
  select s.organization_id, s.company_id, s.id, d.code, d.label, d.description, d.evidence, d.restock, d.position
  from public.stores s
  cross join (values
    ('defectuoso',     'Llegó dañado o no funciona',   'El producto llegó roto, incompleto o falla al usarlo.', true,  false, 10),
    ('equivocado',     'Me enviaron otro producto',     'No es el modelo, color o medida que pedí.',             false, true,  20),
    ('no-corresponde', 'No es lo que esperaba',         'El producto no coincide con la descripción.',           false, true,  30),
    ('arrepentimiento','Ya no lo necesito',             'Cambié de opinión; el producto está sin usar.',         false, true,  40)
  ) as d(code, label, description, evidence, restock, position)
  where s.id = p_store_id
  on conflict (store_id, code) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke execute on function ebim.seed_default_return_reasons(uuid) from public, anon, authenticated;

create or replace function ebim.stores_seed_return_reasons()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform ebim.seed_default_return_reasons(new.id);
  return null;
end;
$fn$;

revoke execute on function ebim.stores_seed_return_reasons() from public, anon, authenticated;

drop trigger if exists stores_seed_return_reasons on public.stores;
create trigger stores_seed_return_reasons
  after insert on public.stores
  for each row execute function ebim.stores_seed_return_reasons();

-- Las tiendas que ya existen. Solo a las que no tienen NINGÚN motivo: si un
-- comercio ya configuró los suyos, no se le añaden los de serie.
do $$
declare v_store record;
begin
  for v_store in
    select s.id from public.stores s
    where not exists (select 1 from public.return_reasons r where r.store_id = s.id)
  loop
    perform ebim.seed_default_return_reasons(v_store.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Qué se puede devolver de un pedido, para el comprador
--
-- Misma guarda que `order_by_token` y `return_request_for_slug`: tienda activa
-- + número + token de 64, y el mismo mensaje para «no existe» y «token
-- incorrecto». Solo después de recibido: antes de la entrega, lo que procede
-- es cancelar. Cada línea dice cuánto queda por devolver, restando lo pedido en
-- devoluciones vivas (todas menos rechazadas y anuladas).
-- ---------------------------------------------------------------------------
create or replace function public.return_options_for_slug(
  p_store_slug   text,
  p_order_number text,
  p_token        text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_order      public.orders%rowtype;
  v_entregado  boolean;
begin
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con esos datos'
      using errcode = '22023';
  end if;

  select o.* into v_order
  from public.orders o
  join public.stores s       on s.id = o.store_id
  join public.order_tokens t on t.order_id = o.id
  where lower(s.slug) = lower(btrim(coalesce(p_store_slug, '')))
    and s.status = 'active'
    and o.order_number = btrim(coalesce(p_order_number, ''))
    and t.token = p_token;

  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con esos datos'
      using errcode = '22023';
  end if;

  v_entregado := v_order.status <> 'cancelled' and (
    v_order.fulfillment_status::text = 'fulfilled'
    or exists (select 1 from public.fulfillments f where f.order_id = v_order.id and f.state = 'delivered')
  );

  return jsonb_build_object(
    'returnable', v_entregado,
    'reason', case
      when v_order.status = 'cancelled' then 'cancelled'
      when not v_entregado then 'not_delivered'
      else null end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_item_id', oi.id,
               'sku',           oi.sku,
               'name',          oi.name,
               'variant_label', oi.variant_label,
               'quantity',      oi.quantity,
               'available',     greatest(oi.quantity - coalesce(r.pedido, 0), 0)
             ) order by oi.created_at, oi.id)
      from public.order_items oi
      left join lateral (
        select sum(ri.quantity)::int as pedido
        from public.return_items ri
        join public.return_requests rr on rr.id = ri.return_request_id
        where ri.order_item_id = oi.id and rr.state not in ('rejected', 'cancelled')
      ) r on true
      where oi.order_id = v_order.id
    ), '[]'::jsonb),
    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', rs.code, 'label', rs.label, 'description', rs.description,
               'requires_evidence', rs.requires_evidence
             ) order by rs.position, rs.code)
      from public.return_reasons rs
      where rs.store_id = v_order.store_id and rs.is_active
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rma_number', rr.rma_number, 'state', rr.state, 'reason_label', rr.reason_label,
               'created_at', rr.created_at
             ) order by rr.created_at desc)
      from public.return_requests rr
      where rr.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.return_options_for_slug(text, text, text) from public;
grant  execute on function public.return_options_for_slug(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · El enlace del pedido, para SU comprador
--
-- «Mis pedidos» no enlazaba al pedido: el token no sale de las funciones de
-- cuenta, y un número de pedido sin token no abre nada (bien). Aquí se entrega
-- el token solo a quien compró: el consumidor (`order_buyers`) o un usuario
-- ACTIVO de la cuenta B2B del pedido. A cualquier otro, «no encontrado».
-- ---------------------------------------------------------------------------
create or replace function public.my_order_token(p_store_slug text, p_order_number text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_token text;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select t.token into v_token
  from public.orders o
  join public.stores s       on s.id = o.store_id
  join public.order_tokens t on t.order_id = o.id
  where lower(s.slug) = lower(btrim(coalesce(p_store_slug, '')))
    and s.status = 'active'
    and o.order_number = btrim(coalesce(p_order_number, ''))
    and (
      exists (select 1 from public.order_buyers b where b.order_id = o.id and b.user_id = v_user)
      or exists (
        select 1 from public.business_account_users u
        where u.business_account_id = o.business_account_id
          and u.user_id = v_user and u.status = 'active'
      )
    );

  if v_token is null then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con esos datos'
      using errcode = '22023';
  end if;

  return v_token;
end;
$fn$;

revoke execute on function public.my_order_token(text, text) from public, anon;
grant  execute on function public.my_order_token(text, text) to authenticated;
