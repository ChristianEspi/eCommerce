-- ---------------------------------------------------------------------------
-- Storefront V3 · P02 · La lista blanca del estilo, ampliada
--
-- ## Qué cambia
--
-- El contrato de vitrina gana tres valores y una clave:
--
--   · `headerVariant` acepta `brand` — la cabecera de marca, con el logotipo al
--     centro y la navegación en su propia fila;
--   · `productCardVariant` acepta `editorial` — la tarjeta que suelta el
--     recuadro y deja mandar a la fotografía;
--   · `categoryVariant` acepta `mosaic` — azulejos de tamaños distintos, que es
--     lo que dice cuál familia manda;
--   · y entra `productMediaFit` (`cover` | `contain`), que hasta V3 estaba
--     CABLEADO en `ProductCard` como `contain`.
--
-- Ese cableado era la decisión correcta para un catálogo de referencias
-- fotografiadas sobre fondo claro —recortar una caja de medicamento se come el
-- principio activo; recortar un tornillo, la métrica— y la equivocada para una
-- tienda de moda, donde el encuadre completo deja franjas vacías arriba y abajo
-- de cada prenda. Con la decisión dentro del componente no había forma de tener
-- las dos sin un `if` por tema dentro de la tarjeta.
--
-- ## Lo que NO cambia
--
--   · La migración `20260910220000` no se toca: una migración aplicada es
--     inmutable. Esto la SUSTITUYE con un `create or replace` en su sitio.
--   · Se siguen rechazando las claves desconocidas. Es la mitad del valor de
--     esta función: sin ella, un `{"css": "…"}` guardado por cualquier camino
--     acabaría en la vitrina de un tenant.
--   · Se siguen aceptando objetos PARCIALES. Lo que la tienda no dice lo hereda
--     de su preset, y guardar el estilo completo convertiría «heredo de mi tema»
--     en siete valores fijos.
--   · Los valores de V2 siguen siendo válidos, así que ninguna fila existente
--     deja de pasar el CHECK.
--   · Mismos grants y mismo `search_path` vacío.
--
-- ## Por qué no hay que revalidar las filas
--
-- Porque la lista solo CRECE. Una función más permisiva no puede invalidar lo
-- que ya pasaba, así que el CHECK sigue cumpliéndose para todo lo guardado sin
-- necesidad de revisar ni una fila — Postgres tampoco lo re-verifica, y aquí no
-- hace falta que lo haga.
-- ---------------------------------------------------------------------------
create or replace function ebim.storefront_style_is_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  -- `coalesce(..., false)` y no la expresión a secas: un CHECK que se evalúa a
  -- NULL **pasa**. Como cualquier `->` sobre una clave ausente devuelve NULL,
  -- sin este envoltorio un objeto al que le faltara una clave obligatoria
  -- entraría por la puerta de atrás. Es la clase de fallo que no se ve leyendo
  -- el código: el CHECK está escrito, se aplica, y no rechaza nada.
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'object'
     and not exists (
       select 1
       from jsonb_each(p_value) as e(clave, valor)
       where jsonb_typeof(e.valor) <> 'string'
          or not (
               (e.clave = 'headerVariant'
                  and e.valor #>> '{}' in ('standard', 'compact', 'brand'))
            or (e.clave = 'heroVariant'
                  and e.valor #>> '{}' in ('product', 'statement'))
            or (e.clave = 'productCardVariant'
                  and e.valor #>> '{}' in ('comfortable', 'compact', 'editorial'))
            or (e.clave = 'categoryVariant'
                  and e.valor #>> '{}' in ('tiles', 'pills', 'mosaic'))
            or (e.clave = 'contentWidth'
                  and e.valor #>> '{}' in ('lg', 'xl'))
            or (e.clave = 'imageRatio'
                  and e.valor #>> '{}' in ('square', 'portrait', 'landscape'))
            or (e.clave = 'sectionSpacing'
                  and e.valor #>> '{}' in ('compact', 'comfortable', 'spacious'))
            -- Storefront V3 · P02
            or (e.clave = 'productMediaFit'
                  and e.valor #>> '{}' in ('cover', 'contain'))
          )
     )
  ), false);
$fn$;

revoke execute on function ebim.storefront_style_is_valid(jsonb) from public;
grant  execute on function ebim.storefront_style_is_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.storefront_style_is_valid(jsonb) is
  'Lista blanca del estilo de vitrina (V3): ocho claves cerradas, con brand, editorial, mosaic y productMediaFit. Lo que no esta nombrado no entra, sin heuristica de strings.';
