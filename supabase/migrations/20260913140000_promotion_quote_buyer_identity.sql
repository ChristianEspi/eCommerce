-- =============================================================================
-- Hardening multi-commerce v2 · N04 — promociones dirigidas: lo que se ENSEÑA
-- en el carrito es lo que se COBRA en el pedido.
--
-- ## El fallo (hallazgo A2)
--
-- `promotion_quote_for_slug` —la cotización del carrito, del checkout y de la
-- etapa 4 del pipeline— ya cotizaba el PRECIO con la identidad del JWT (P19,
-- dentro de `ebim.build_quote`), pero evaluaba las PROMOCIONES así:
--
--     ebim.apply_promotions(tienda, canal, cotizacion, cupones,
--                           null, null, null, null, now(), false)
--                           ^^^^  ^^^^  ^^^^
--                         cliente segmento cuenta
--
-- Y `create_order` las evalúa con el cliente y la cuenta reales. Una campaña
-- dirigida a un segmento, a un cliente o a una cuenta B2B no aparecía en el
-- carrito y sí en el pedido: el comprador leía un total y se le cobraba otro.
--
-- ## La respuesta
--
-- La cotización deriva la identidad comercial en el SERVIDOR, de la misma
-- regla que fija el precio y firma el pedido (N01):
--
--     cuenta   = ebim.effective_business_account(ebim.user_id(), org, sociedad)
--     cliente  = business_accounts.customer_id de esa cuenta (activo)
--     segmento = customers.segment_id de ese cliente
--
-- y se las pasa a `ebim.apply_promotions`. La firma pública NO cambia: sigue
-- siendo `(slug, items, cupones)` y no hay dónde escribir una identidad.
--
-- Invitado, consumidor sin cuenta y sesión sin cuenta en ESTA sociedad siguen
-- con los tres nulos: exactamente el comportamiento anterior.
--
-- ## Lo que NO cambia
--
--  · el techo de sondeo de cupones (`promotions.coupon_probe`), idéntico;
--  · `create_order` y sus cerrojos: sigue siendo la autoridad final del cobro;
--  · el correo: la cotización no lo conoce (se teclea en el checkout), así que
--    los topes de uso POR CLIENTE que se cuentan por correo siguen decidiéndose
--    al crear el pedido, como antes.
-- =============================================================================

create or replace function public.promotion_quote_for_slug(
  p_store_slug   text,
  p_items        jsonb,
  p_coupon_codes text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store    public.stores%rowtype;
  v_channel  public.channels%rowtype;
  v_slug     text := lower(btrim(coalesce(p_store_slug, '')));
  v_quote    jsonb;
  v_codes    text[] := p_coupon_codes;
  v_result   jsonb;
  v_misses   integer;
  -- N04: quién compra, derivado de la sesión con la regla única de N01.
  v_account  uuid;
  v_customer uuid;
  v_segment  uuid;
begin
  if v_slug = '' then
    raise exception 'TIENDA_NO_DISPONIBLE: falta la tienda de la cotizacion'
      using errcode = '22023';
  end if;

  select * into v_store
  from public.stores s
  where lower(s.slug) = v_slug and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda "%" no existe o no esta activa', v_slug
      using errcode = '22023';
  end if;

  select * into v_channel
  from public.channels c
  where c.store_id = v_store.id and c.is_default and c.is_active;

  if not found then
    raise exception 'CANAL_NO_DISPONIBLE: la tienda % no tiene canal por defecto activo', v_store.slug
      using errcode = '22023';
  end if;

  if v_channel.requires_auth then
    raise exception 'CANAL_NO_PUBLICO: el canal por defecto de % exige sesion', v_store.slug
      using errcode = '22023';
  end if;

  -- P16-SaaS. Con el contador de FALLOS por encima del techo, la cotizacion se
  -- calcula igual y sin cupones: el oraculo se apaga, el carrito no.
  if v_codes is not null
     and array_length(v_codes, 1) > 0
     and ebim.public_rate_exceeded(v_store.id, 'promotions.coupon_probe', 100) then
    v_codes := null;
  end if;

  v_quote := ebim.build_quote(v_store.id, v_channel.id, p_items, null, null, now(), true);

  -- N04 · La identidad comercial, del JWT y de la regla única. Ningún parámetro
  -- la aporta. Sin sesión o sin cuenta válida en esta sociedad, los tres nulos.
  v_account := ebim.effective_business_account(ebim.user_id(), v_store.organization_id, v_store.company_id);
  if v_account is not null then
    select c.id, c.segment_id into v_customer, v_segment
    from public.business_accounts a
    join public.customers c on c.id = a.customer_id
    where a.id = v_account
      and c.is_active
      and c.organization_id = v_store.organization_id
      and c.company_id      = v_store.company_id;
  end if;

  v_result := ebim.apply_promotions(
    v_store.id, v_channel.id, v_quote, v_codes,
    v_customer, v_segment, v_account, null, now(), false);

  -- Se anota UN intento por codigo que no existe (P16-SaaS, sin cambios).
  select count(*)::integer into v_misses
  from jsonb_array_elements(
         coalesce(v_result -> 'promotions' -> 'coupons', '[]'::jsonb)) as c(value)
  where c.value ->> 'status' = 'no_existe';

  if coalesce(v_misses, 0) > 0 then
    perform ebim.public_rate_record(v_store.id, 'promotions.coupon_probe', v_misses, 100);
  end if;

  return v_result;
end;
$fn$;

comment on function public.promotion_quote_for_slug(text, jsonb, text[]) is
  'Cotizacion publica con promociones. Desde N04 evalua las campanas dirigidas con la cuenta B2B efectiva de la sesion (ebim.effective_business_account), su cliente y su segmento; sin sesion o sin cuenta, como antes. Techo de sondeo de cupones intacto (P16-SaaS).';

revoke execute on function public.promotion_quote_for_slug(text, jsonb, text[]) from public;
grant  execute on function public.promotion_quote_for_slug(text, jsonb, text[])
  to anon, authenticated, service_role;
