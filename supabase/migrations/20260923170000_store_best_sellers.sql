-- =============================================================================
-- Storefront V2 · P08 — «Lo más vendido», cuando de verdad se ha vendido.
--
-- ## El problema, dicho exacto
--
-- La portada pintaba una sección titulada «Lo más vendido», con el antetítulo
-- «Lo que mas sale» y la bajada «Los productos que mas repiten nuestros
-- clientes». Los productos salían de esto:
--
--     masVendido: tomar(products, 12)
--
-- donde `products` es la PRIMERA PÁGINA del catálogo ordenada por RELEVANCIA de
-- búsqueda. Ni una consulta de pedidos, ni un agregado de ventas, ni nada que
-- se parezca. Tres afirmaciones sobre el comportamiento de los compradores
-- sostenidas por el orden de un índice de texto.
--
-- No es un matiz de redacción. Una tienda recién abierta, sin un solo pedido,
-- anunciaba sus superventas; y un comercio que mirara esa sección para decidir
-- qué reponer estaría leyendo ruido.
--
-- ## Qué hace esta función
--
-- Devuelve el ranking REAL de una tienda: qué productos han salido más, por
-- unidades, en los últimos noventa días. Si no hay ventas devuelve cero filas,
-- y entonces la vitrina NO dice «lo más vendido»: dice «Recomendados», que es
-- lo que de verdad está enseñando.
--
-- ## Qué cuenta como una venta, y por qué
--
-- `paid` y `fulfilled`. Y no los demás, uno por uno:
--
--   · `pending` es un pedido puesto que todavía no se ha cobrado. Puede no
--     cobrarse nunca —una transferencia que no llega, un pago abandonado—, así
--     que contarlo convierte una intención en una venta;
--   · `cancelled` es un pedido que se deshizo. El encargo lo dice con esas
--     palabras: no contar cancelados;
--   · `refunded` se vendió y se devolvió. Sumarlo diría que un producto que
--     todos devuelven es el que más se vende, que es lo contrario de lo que la
--     sección promete.
--
-- Noventa días porque «lo más vendido» es una afirmación sobre el presente. Con
-- todo el histórico, un producto descatalogado que arrasó hace tres años
-- seguiría encabezando la lista de una tienda que ya no lo vende.
--
-- ## Qué NO sale de aquí
--
-- Ni un dato de nadie. La función devuelve `product_id` y su orden (`sort_order`,
-- que no se llama `position` porque en Postgres esa palabra es una función), y nada
-- más: ni correos, ni nombres, ni direcciones, ni importes, ni el número de
-- unidades. Las unidades se quedan dentro a propósito —son volumen de negocio
-- de otro, y el comprador no las necesita para ver una fila de productos—; lo
-- único que sale es el orden, que es inseparable de la idea de «ranking».
--
-- Y `anon` NO gana acceso a `orders` ni a `order_items`: sigue sin un solo
-- GRANT sobre esas tablas. Lo que hay es esta puerta, que responde una pregunta
-- concreta con una respuesta anónima.
--
-- ## Por qué SECURITY DEFINER, y qué autoriza por dentro
--
-- Porque el llamante legítimo es el comprador ANÓNIMO —es la portada de la
-- tienda— y `anon` no puede leer pedidos, que es justo como tiene que seguir
-- siendo. La autorización va escrita en el cuerpo, como exige el contrato:
--
--   · la tienda se resuelve por SLUG y tiene que estar ACTIVA. El cliente no
--     pasa un `store_id`: si lo pasara, podría pedir el ranking de la tienda de
--     otra sociedad escribiendo un uuid;
--   · solo cuentan las líneas de pedidos de ESA tienda;
--   · y solo los productos que siguen PUBLICADOS en ella, porque un ranking con
--     ids que la vitrina no puede pintar deja huecos, y porque lo que se
--     despublicó no se está vendiendo.
-- =============================================================================

create or replace function public.store_best_sellers_for_slug(
  p_slug  text,
  p_limit integer default 12
)
returns table (product_id uuid, sort_order integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  with tienda as (
    select s.id
    from public.stores s
    where s.slug = btrim(lower(coalesce(p_slug, '')))
      and s.status = 'active'
  ),
  ventas as (
    select oi.product_id, sum(oi.quantity)::bigint as unidades
    from public.order_items oi
    join public.orders o  on o.id = oi.order_id
    join tienda t         on t.id = oi.store_id
    where o.status in ('paid', 'fulfilled')
      and o.placed_at >= now() - interval '90 days'
      and oi.product_id is not null
      and exists (
        select 1
        from public.store_products sp
        where sp.product_id = oi.product_id
          and sp.store_id   = oi.store_id
          and sp.status     = 'published'
          and sp.published_at is not null
          and sp.published_at <= now()
      )
    group by oi.product_id
  )
  select
    v.product_id,
    -- El desempate por `product_id` no es cosmético: sin él, dos productos con
    -- las mismas unidades se alternan entre dos cargas de la misma portada y la
    -- fila parece barajarse sola.
    (row_number() over (order by v.unidades desc, v.product_id))::integer as sort_order
  from ventas v
  order by v.unidades desc, v.product_id
  -- El tope se acota aquí y no se confía al cliente: una petición con
  -- `p_limit = 100000` no puede convertir una fila de portada en un volcado.
  limit least(greatest(coalesce(p_limit, 12), 1), 24);
$fn$;

revoke execute on function public.store_best_sellers_for_slug(text, integer) from public;
grant  execute on function public.store_best_sellers_for_slug(text, integer)
  to anon, authenticated, service_role;

comment on function public.store_best_sellers_for_slug(text, integer) is
  'Ranking real de una tienda ACTIVA por unidades vendidas (paid|fulfilled, 90 dias, producto aun publicado). Devuelve product_id y sort_order: ni PII, ni importes, ni unidades. Definer porque el llamante es el comprador anonimo y anon no lee pedidos.';
