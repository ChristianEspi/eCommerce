-- =============================================================================
-- Cierre · Relaciones de producto en la vitrina — la puerta pública de lectura
--
-- ## El hueco
--
-- `product_relations` existe desde P03 (20260827170000): el comercio dice «este
-- producto sugiere aquel» con un tipo —relacionado, venta cruzada, mejora,
-- accesorio, sustituto, repuesto— y un orden. Pero la tabla es SOLO del
-- backoffice: la policy de lectura es de miembros, `anon` no tiene GRANT y no
-- había función pública. La ficha de producto, en consecuencia, se inventaba
-- los relacionados con «el resto de su categoría», y lo que el comercio curó a
-- mano no llegaba nunca al comprador.
--
-- ## Por qué una función y no una policy anónima sobre la tabla
--
-- Una policy `to anon` sobre `product_relations` expondría la fila entera:
-- tenant, tienda y —lo que importa— el enlace a productos que NO están
-- publicados. «El accesorio de la silla es la mesa que sale el mes que viene»
-- es información comercial que el comercio no ha decidido contar. La vitrina
-- necesita otra cosa: los ids de los relacionados que el comprador SÍ puede
-- ver, en su orden. Eso es exactamente lo que devuelve esta función, y nada
-- más: ni precio, ni existencia, ni nombre. La ficha de cada relacionado la
-- sirve `public_products`, que ya sabe resolver precio y disponibilidad; una
-- segunda copia de esos campos aquí acabaría discrepando.
--
-- ## Qué cuenta como «visible»
--
-- Las TRES condiciones que ya aplica la vitrina, evaluadas por el servidor:
--
--  1. La tienda se resuelve por su slug y tiene que estar ACTIVA
--     (`ebim.active_store_by_slug`). El `store_id` que se usa después sale de
--     ahí; ningún parámetro del cliente lo decide.
--  2. Producto de origen y relacionado: `status = 'published'` con
--     `published_at` ya cumplido, y los dos de ESA tienda. Es el mismo filtro
--     que `public_products`.
--  3. Canal: el canal público de la tienda (por defecto, activo, sin sesión),
--     con la regla de `price_quote_for_slug` / `cart_open`: si el canal tiene
--     surtido declarado en `product_channels`, solo cuenta lo que está en él.
--     Sugerir un producto que el carrito va a rechazar con
--     `PRODUCTO_FUERA_DE_CANAL` es enseñar un botón que no funciona.
--
-- Una tienda sin canal público no devuelve NADA en vez de lanzar: la ficha
-- sigue pintándose con su relleno por categoría, y el error de «no hay canal»
-- ya lo da el carrito, que es donde tiene consecuencia.
--
-- Un producto de origen que no se ve devuelve lista vacía, igual que uno que
-- no existe o que es de otra tienda: distinguirlos le contaría al visitante
-- qué tiene el comercio en preparación.
-- =============================================================================

create or replace function public.product_relations_for_slug(
  p_store_slug text,
  p_product_id uuid,
  p_kinds      text[]  default null,
  p_limit      integer default 8
)
returns table (
  related_product_id uuid,
  relation_kind      text,
  "position"         integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_channel public.channels%rowtype;
  v_scoped  boolean;
  -- Techo duro: la ficha pinta dos o tres filas de cuatro. Veinticuatro da
  -- margen para repartir por tipo sin que una llamada sirva de volcado del
  -- grafo de relaciones de la tienda.
  v_limit   integer := least(greatest(coalesce(p_limit, 8), 1), 24);
begin
  v_store := ebim.active_store_by_slug(p_store_slug);

  -- Los tipos se validan y no se ignoran: un tipo mal escrito que devolviera
  -- «nada» parecería un producto sin relaciones, y el fallo se buscaría en el
  -- backoffice en vez de en la llamada.
  if p_kinds is not null and exists (
    select 1
    from unnest(p_kinds) as k(kind)
    where k.kind is null
       or k.kind not in ('related', 'cross_sell', 'up_sell', 'accessory', 'substitute', 'spare_part')
  ) then
    raise exception 'TIPO_RELACION_INVALIDO: tipo de relacion desconocido'
      using errcode = '22023';
  end if;

  if p_product_id is null then
    return;
  end if;

  -- El canal público, sin lanzar (ver cabecera): mismo criterio que
  -- `ebim.public_channel`, que sí lanza porque lo usa el carrito.
  select * into v_channel
  from public.channels c
  where c.store_id = v_store.id
    and c.is_default
    and c.is_active
    and not c.requires_auth;

  if not found then
    return;
  end if;

  select exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel.id
  ) into v_scoped;

  -- El producto de ORIGEN también tiene que verse: si no, la función serviría
  -- para preguntar por el grafo de un borrador.
  if not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.store_id = v_store.id
      and p.status = 'published'
      and p.published_at is not null
      and p.published_at <= now()
      and (not v_scoped or exists (
        select 1 from public.product_channels pc
        where pc.channel_id = v_channel.id and pc.product_id = p.id))
  ) then
    return;
  end if;

  return query
  select r.related_product_id,
         r.relation_kind::text,
         r.position
  from public.product_relations r
  join public.products p
    on p.id = r.related_product_id
   and p.store_id = r.store_id
  where r.store_id   = v_store.id
    and r.product_id = p_product_id
    and (p_kinds is null or r.relation_kind::text = any (p_kinds))
    and p.status = 'published'
    and p.published_at is not null
    and p.published_at <= now()
    and (not v_scoped or exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_channel.id and pc.product_id = p.id))
  -- El orden es el del comercio (`position`), y el desempate es estable: sin
  -- él, dos relacionados con la misma posición bailarían entre visitas.
  order by r.position asc, r.created_at asc, r.id asc
  limit v_limit;
end;
$fn$;

revoke execute on function public.product_relations_for_slug(text, uuid, text[], integer) from public;
-- `anon` SÍ: es la ficha pública, y el comprador anónimo es la mayoría de sus
-- visitas. `authenticated` también: el comprador con sesión mira la misma
-- ficha, y un GRANT solo a `anon` le dejaría sin sugerencias al entrar.
grant execute on function public.product_relations_for_slug(text, uuid, text[], integer)
  to anon, authenticated, service_role;

comment on function public.product_relations_for_slug(text, uuid, text[], integer) is
  'Vitrina: ids de los productos relacionados con uno publicado, en el orden del comercio. Solo lo publicado, de la tienda activa del slug y visible en su canal publico. Sin precio, sin existencia, sin tenant.';
