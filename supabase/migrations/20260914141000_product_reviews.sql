-- =============================================================================
-- Cierre · Reseñas y valoraciones de producto
--
-- ## Qué resuelve
--
-- Hasta aquí la ficha de producto no tenía voz de nadie más que del comercio.
-- Este módulo añade la del comprador: una valoración de 1 a 5, un título, un
-- texto y —lo que la hace creíble— la marca «compra verificada» cuando quien
-- opina compró de verdad ese producto en esa tienda.
--
-- ## Las cuatro decisiones que gobiernan el archivo
--
-- 1. **Moderación primero.** Toda reseña nace `pending` y no se ve en la
--    vitrina hasta que alguien del comercio con rol de catálogo (`owner`,
--    `admin`, `catalog`) la publica. Editarla la devuelve a `pending`: una
--    reseña aprobada que después se reescribe ya no es la que se aprobó.
--
-- 2. **`verified_purchase` lo calcula el servidor, siempre.** El navegador no
--    tiene forma de mandarlo: la función de envío acepta una lista cerrada de
--    campos (`rating`, `title`, `body`, `display_name`) y rechaza cualquier
--    otro con `CAMPO_NO_PERMITIDO` —no lo ignora: un campo que se ignora hoy es
--    un campo que alguien lee mañana—. La compra se comprueba contra
--    `order_buyers` (el vínculo pedido → usuario verificado que escribe el
--    cierre de compra, 20260913100000) y `order_items`: un pedido de ESA
--    tienda, de ESE producto, que no esté cancelado ni reembolsado. Un pedido
--    de invitado con el mismo correo NO cuenta: el correo no es identidad (ver
--    la cabecera de `order_buyers`).
--
-- 3. **Ni correos ni ids de usuario en la vitrina.** La lectura pública
--    devuelve un nombre para mostrar y nada más. Ese nombre lo elige el
--    comprador con validación estricta (sin arrobas, sin cifras, sin enlaces)
--    o, si no lo elige, lo deriva el servidor del nombre de su último pedido
--    vinculado como «Nombre I.». Sin ninguno de los dos, la vitrina pinta
--    «Cliente» en su idioma.
--
-- 4. **Sin capacidad vendible nueva.** Las reseñas cuelgan de `catalog`, que es
--    baseline (`src/domain/capabilities.ts`, `entitlement: null`). Crear
--    `reviews` como addon exigiría darlo de alta en el catálogo del hub antes
--    de encenderlo, y encender un candado de servidor sin entitlement que
--    conceder apagaría el módulo para todos los tenants (misma razón que
--    documenta `supabase/tests/capability-enforcement.test.ts`). Si mañana se
--    vende, el candado entra en estas funciones con `ebim.company_is_entitled`.
--
-- ## Texto plano, de verdad
--
-- Ni HTML ni nada que lo parezca: un CHECK rechaza `<` seguido de letra, `/`,
-- `!` o `?`, y los caracteres de control salvo salto de línea, retorno y
-- tabulador. La vitrina pinta el texto como texto (React escapa) y el
-- repositorio prohíbe el punto de inyección (`src/architecture.test.ts`); el
-- CHECK es la tercera red, la que aguanta a un `service_role` o a una consola.
--
-- ## Por qué la media se calcula y no se guarda
--
-- Un contador en tabla aparte necesita un trigger que lo mantenga y un test que
-- demuestre que no se desincroniza nunca — con publicar, rechazar, editar y
-- borrar en cascada. Contar las publicadas de UN producto con el índice
-- `(product_id, status)` cuesta milisegundos y no puede mentir.
-- =============================================================================

create table public.product_reviews (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null,
  company_id        uuid        not null,
  store_id          uuid        not null,
  product_id        uuid        not null,
  -- `sub` del JWT de quien opina. Lo pone la función desde `ebim.user_id()`;
  -- no hay forma de declararlo desde el navegador y no sale nunca a la vitrina.
  user_id           uuid        not null,
  display_name      text,
  rating            smallint    not null,
  title             text,
  body              text        not null,
  status            text        not null default 'pending',
  -- Calculado por `submit_product_review` en cada envío. Ver cabecera.
  verified_purchase boolean     not null default false,
  moderated_by      uuid,
  moderated_at      timestamptz,
  rejection_reason  text,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Una reseña por persona, producto y tienda. Volver a enviar la EDITA.
  constraint product_reviews_one_per_user unique (store_id, product_id, user_id),
  constraint product_reviews_rating_range check (rating between 1 and 5),
  constraint product_reviews_status_valid check (status in ('pending', 'published', 'rejected')),
  constraint product_reviews_title_len
    check (title is null or char_length(title) between 1 and 120),
  constraint product_reviews_body_len check (char_length(body) between 10 and 2000),
  constraint product_reviews_display_name_fmt
    check (display_name is null
           or (char_length(display_name) between 2 and 40
               and display_name !~ '[@<>/\:;{}0-9\x01-\x1F\x7F]')),
  constraint product_reviews_plain_text check (
    body !~ '<[A-Za-z/!?]'
    and body !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    and (title is null or (title !~ '<[A-Za-z/!?]' and title !~ '[\x01-\x1F\x7F]'))
  ),
  -- El motivo acompaña al rechazo y SOLO al rechazo: una reseña publicada con
  -- un motivo de rechazo colgando es un estado que nadie sabría leer.
  constraint product_reviews_reason_when_rejected
    check ((status = 'rejected') = (rejection_reason is not null)),
  constraint product_reviews_reason_len
    check (rejection_reason is null or char_length(rejection_reason) between 3 and 500),
  constraint product_reviews_published_at_when_published
    check ((status = 'published') = (published_at is not null)),
  -- Lo que salió de `pending` lo decidió alguien, y se sabe quién y cuándo.
  constraint product_reviews_moderation_trace
    check (status = 'pending' or (moderated_by is not null and moderated_at is not null)),

  constraint product_reviews_product_fk foreign key (product_id, store_id)
    references public.products (id, store_id) on delete cascade,
  constraint product_reviews_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index product_reviews_tenant_idx on public.product_reviews (organization_id, company_id);
-- La vitrina: las publicadas de un producto, las más recientes primero.
create index product_reviews_product_status_idx
  on public.product_reviews (product_id, status, published_at desc);
-- La cola de moderación del backoffice.
create index product_reviews_queue_idx
  on public.product_reviews (organization_id, company_id, status, created_at desc);
-- El techo por persona.
create index product_reviews_user_idx on public.product_reviews (user_id, updated_at desc);

create trigger product_reviews_set_updated_at
  before update on public.product_reviews
  for each row execute function ebim.set_updated_at();

alter table public.product_reviews enable row level security;
alter table public.product_reviews force  row level security;

-- Lectura del backoffice: la cola de moderación de SU tenant. Cualquier miembro
-- la ve —leer lo que opinan de tu catálogo no es un privilegio—; decidir sobre
-- ella exige rol, y eso lo comprueba `moderate_product_review`.
--
-- No hay policy para el comprador: lee lo suyo por `my_product_review`, que no
-- le enseña quién le moderó. Y no hay policy de escritura para NADIE: se
-- escribe por las funciones de abajo o no se escribe.
create policy product_reviews_select_member on public.product_reviews
  for select to authenticated
  using (ebim.can_access(organization_id, company_id));

revoke all on public.product_reviews from public, anon, authenticated;
grant select on public.product_reviews to authenticated;
grant all    on public.product_reviews to service_role;

comment on table public.product_reviews is
  'Reseñas de producto. Nacen pending; las publica o rechaza el rol de catálogo por moderate_product_review. verified_purchase lo calcula el servidor desde order_buyers + order_items. Sin escritura directa para anon ni authenticated.';

-- ---------------------------------------------------------------------------
-- ebim.review_display_name — normaliza y valida un nombre para mostrar.
--
-- Devuelve el nombre limpio o `null` si no pasa. Es PURA (no lee tablas) y no
-- la alcanza el cliente: la usan las funciones DEFINER de abajo.
-- ---------------------------------------------------------------------------
create or replace function ebim.review_display_name(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_name text := btrim(regexp_replace(coalesce(p_raw, ''), '\s+', ' ', 'g'));
begin
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    return null;
  end if;
  -- Sin arroba (un correo), sin cifras (un teléfono o un documento), sin
  -- barras ni dos puntos (un enlace), sin marcado y sin control.
  if v_name ~ '[@<>/\:;{}0-9\x01-\x1F\x7F]' then
    return null;
  end if;
  return v_name;
end;
$fn$;

revoke execute on function ebim.review_display_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ebim.review_product — el producto reseñable: publicado y de la tienda.
-- ---------------------------------------------------------------------------
create or replace function ebim.review_product(p_store_id uuid, p_product_id uuid)
returns public.products
language sql
stable
set search_path = ''
as $fn$
  select p.*
  from public.products p
  where p.id = p_product_id
    and p.store_id = p_store_id
    and p.status = 'published'
    and p.published_at is not null
    and p.published_at <= now();
$fn$;

revoke execute on function ebim.review_product(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ebim.review_json — la forma de UNA reseña para su autor.
-- ---------------------------------------------------------------------------
create or replace function ebim.review_json(p_review public.product_reviews)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select case when p_review.id is null then null else jsonb_build_object(
    'review_id',         p_review.id,
    'rating',            p_review.rating,
    'title',             p_review.title,
    'body',              p_review.body,
    'display_name',      p_review.display_name,
    'status',            p_review.status,
    'verified_purchase', p_review.verified_purchase,
    'rejection_reason',  p_review.rejection_reason,
    'created_at',        p_review.created_at,
    'updated_at',        p_review.updated_at
  ) end;
$fn$;

revoke execute on function ebim.review_json(public.product_reviews) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit_product_review — la única puerta de escritura del comprador.
--
-- Crea o edita SU reseña de un producto publicado de la tienda del slug. El
-- tenant sale de la tienda; el autor, del JWT; la compra verificada, de sus
-- pedidos. Del navegador solo llegan cuatro campos.
-- ---------------------------------------------------------------------------
create or replace function public.submit_product_review(
  p_store_slug text,
  p_product_id uuid,
  p_review     jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user     uuid := ebim.user_id();
  v_store    public.stores%rowtype;
  v_product  public.products%rowtype;
  v_rating   integer;
  v_title    text;
  v_body     text;
  v_name     text;
  v_verified boolean;
  v_row      public.product_reviews%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hay que iniciar sesion para opinar' using errcode = '42501';
  end if;

  v_store := ebim.active_store_by_slug(p_store_slug);

  if p_review is null or jsonb_typeof(p_review) <> 'object' then
    raise exception 'DATOS_INVALIDOS: se espera un objeto {rating, title, body, display_name}'
      using errcode = '22023';
  end if;

  -- Lista cerrada. `verified_purchase`, `status`, `user_id`, `organization_id`
  -- o `published_at` no se «ignoran»: se rechazan.
  if exists (
    select 1 from jsonb_object_keys(p_review) as k(key)
    where k.key not in ('rating', 'title', 'body', 'display_name')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: la resena lleva solo rating, title, body y display_name'
      using errcode = '22023';
  end if;

  v_product := ebim.review_product(v_store.id, p_product_id);
  if v_product.id is null then
    raise exception 'PRODUCTO_NO_DISPONIBLE: no hay ningun producto publicado con ese id en esta tienda'
      using errcode = '22023';
  end if;

  -- Quien opera el comercio no opina sobre su propio catálogo: sería una
  -- reseña que se modera a sí misma.
  if ebim.can_access(v_store.organization_id, v_store.company_id) then
    raise exception 'RESENA_NO_PERMITIDA: el personal de la tienda no puede resenar su catalogo'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_review -> 'rating') is distinct from 'number'
     or (p_review ->> 'rating') !~ '^[1-5]$' then
    raise exception 'CALIFICACION_INVALIDA: la valoracion es un entero de 1 a 5'
      using errcode = '22023';
  end if;
  v_rating := (p_review ->> 'rating')::integer;

  if jsonb_typeof(p_review -> 'body') is distinct from 'string' then
    raise exception 'RESENA_TEXTO_INVALIDO: falta el texto de la resena' using errcode = '22023';
  end if;
  v_body := btrim(p_review ->> 'body');

  if p_review ? 'title' and jsonb_typeof(p_review -> 'title') not in ('string', 'null') then
    raise exception 'RESENA_TEXTO_INVALIDO: el titulo es texto' using errcode = '22023';
  end if;
  v_title := nullif(btrim(coalesce(p_review ->> 'title', '')), '');

  if char_length(v_body) < 10 or char_length(v_body) > 2000
     or (v_title is not null and char_length(v_title) > 120)
     or v_body ~ '<[A-Za-z/!?]'
     or v_body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
     or (v_title is not null and (v_title ~ '<[A-Za-z/!?]' or v_title ~ '[\x01-\x1F\x7F]')) then
    raise exception 'RESENA_TEXTO_INVALIDO: texto plano, titulo hasta 120 y resena de 10 a 2000 caracteres'
      using errcode = '22023';
  end if;

  if p_review ? 'display_name' and jsonb_typeof(p_review -> 'display_name') not in ('string', 'null') then
    raise exception 'NOMBRE_INVALIDO: el nombre para mostrar es texto' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_review ->> 'display_name', '')), '') is not null then
    v_name := ebim.review_display_name(p_review ->> 'display_name');
    if v_name is null then
      raise exception 'NOMBRE_INVALIDO: de 2 a 40 letras, sin arrobas, cifras ni enlaces'
        using errcode = '22023';
    end if;
  else
    -- Derivado del nombre de su último pedido vinculado: «Nombre I.». Si ese
    -- nombre no pasa la misma validación, no se inventa otro.
    select ebim.review_display_name(
             split_part(btrim(o.customer_name), ' ', 1)
             || case when split_part(btrim(o.customer_name), ' ', 2) <> ''
                     then ' ' || upper(left(split_part(btrim(o.customer_name), ' ', 2), 1)) || '.'
                     else '' end)
      into v_name
    from public.order_buyers b
    join public.orders o on o.id = b.order_id and o.store_id = b.store_id
    where b.user_id = v_user
      and b.store_id = v_store.id
      and nullif(btrim(coalesce(o.customer_name, '')), '') is not null
    order by o.placed_at desc
    limit 1;
  end if;

  -- Techo por persona: diez envíos por hora. Editar la misma reseña cuenta una
  -- sola vez (se miran filas por `updated_at`, no llamadas).
  if (select count(*) from public.product_reviews r
       where r.user_id = v_user and r.updated_at > now() - interval '1 hour') >= 10 then
    raise exception 'LIMITE_DE_TASA: demasiadas resenas en poco tiempo; intentalo mas tarde'
      using errcode = '22023';
  end if;
  -- Y techo por tienda, con el contador compartido de P16: crear cuentas de
  -- consumidor es barato, y una tienda no puede recibir cientos de reseñas en
  -- una hora sin que el comercio lo decida (`store_settings.config.rate_limits`).
  if ebim.public_rate_exceeded(v_store.id, 'reviews.submit', 200) then
    raise exception 'LIMITE_DE_TASA: la tienda recibe demasiadas resenas; intentalo mas tarde'
      using errcode = '22023';
  end if;

  -- La compra verificada, calculada aquí y solo aquí.
  select exists (
    select 1
    from public.order_buyers b
    join public.orders o      on o.id = b.order_id and o.store_id = b.store_id
    join public.order_items i on i.order_id = o.id
    where b.user_id    = v_user
      and b.store_id   = v_store.id
      and i.product_id = v_product.id
      and o.status::text not in ('cancelled', 'refunded')
  ) into v_verified;

  insert into public.product_reviews as r (
    organization_id, company_id, store_id, product_id, user_id,
    display_name, rating, title, body, status, verified_purchase
  ) values (
    v_store.organization_id, v_store.company_id, v_store.id, v_product.id, v_user,
    v_name, v_rating, v_title, v_body, 'pending', v_verified
  )
  on conflict on constraint product_reviews_one_per_user do update
    set display_name      = excluded.display_name,
        rating            = excluded.rating,
        title             = excluded.title,
        body              = excluded.body,
        -- Editar devuelve a la cola: lo aprobado era OTRO texto.
        status            = 'pending',
        verified_purchase = excluded.verified_purchase,
        moderated_by      = null,
        moderated_at      = null,
        rejection_reason  = null,
        published_at      = null,
        updated_at        = now()
  returning r.* into v_row;

  perform ebim.public_rate_record(v_store.id, 'reviews.submit', 1, 200);

  return ebim.review_json(v_row);
end;
$fn$;

revoke execute on function public.submit_product_review(text, uuid, jsonb) from public, anon;
grant  execute on function public.submit_product_review(text, uuid, jsonb) to authenticated, service_role;

comment on function public.submit_product_review(text, uuid, jsonb) is
  'Crea o edita la resena del comprador con sesion sobre un producto publicado de la tienda del slug. Nace/vuelve a pending. Campos: rating, title, body, display_name; cualquier otro -> CAMPO_NO_PERMITIDO. verified_purchase lo calcula el servidor.';

-- ---------------------------------------------------------------------------
-- my_product_review — la reseña del comprador sobre un producto, en cualquier
-- estado, para que el formulario sepa si edita y enseñe «pendiente».
-- ---------------------------------------------------------------------------
create or replace function public.my_product_review(
  p_store_slug text,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_store public.stores%rowtype;
  v_row   public.product_reviews%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  v_store := ebim.active_store_by_slug(p_store_slug);

  select r.* into v_row
  from public.product_reviews r
  where r.store_id = v_store.id
    and r.product_id = p_product_id
    and r.user_id = v_user;

  return ebim.review_json(v_row);
end;
$fn$;

revoke execute on function public.my_product_review(text, uuid) from public, anon;
grant  execute on function public.my_product_review(text, uuid) to authenticated, service_role;

comment on function public.my_product_review(text, uuid) is
  'La resena del comprador con sesion sobre un producto de la tienda del slug, en cualquier estado, o null. Sin datos del moderador.';

-- ---------------------------------------------------------------------------
-- product_reviews_for_slug — la lectura PÚBLICA: resumen + una página.
--
-- Solo publicadas, de un producto publicado de una tienda activa. El resumen
-- (cuántas, media, reparto por estrellas) sale de las MISMAS filas publicadas:
-- una media que contara las pendientes anunciaría una nota que nadie puede
-- leer. La media va como TEXTO con dos decimales, igual que el dinero: el
-- redondeo lo decide la base y no el float del navegador.
-- ---------------------------------------------------------------------------
create or replace function public.product_reviews_for_slug(
  p_store_slug text,
  p_product_id uuid,
  p_page       integer default 1,
  p_page_size  integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_product public.products%rowtype;
  v_size    integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  v_page    integer := least(greatest(coalesce(p_page, 1), 1), 1000);
  v_summary jsonb;
  v_rows    jsonb;
begin
  v_store   := ebim.active_store_by_slug(p_store_slug);
  v_product := ebim.review_product(v_store.id, p_product_id);

  -- Producto que no se ve: respuesta vacía, igual que uno que no existe. No se
  -- distingue «no hay reseñas» de «ese producto está en borrador».
  if v_product.id is null then
    return jsonb_build_object(
      'summary', jsonb_build_object(
        'count', 0, 'average', null,
        'distribution', jsonb_build_object('1', 0, '2', 0, '3', 0, '4', 0, '5', 0)),
      'reviews', '[]'::jsonb,
      'page', v_page, 'page_size', v_size, 'total', 0);
  end if;

  select jsonb_build_object(
           'count', count(*)::int,
           'average', case when count(*) = 0 then null
                           else to_char(round(avg(r.rating)::numeric, 2), 'FM0.00') end,
           'distribution', jsonb_build_object(
             '1', count(*) filter (where r.rating = 1),
             '2', count(*) filter (where r.rating = 2),
             '3', count(*) filter (where r.rating = 3),
             '4', count(*) filter (where r.rating = 4),
             '5', count(*) filter (where r.rating = 5)))
    into v_summary
  from public.product_reviews r
  where r.product_id = v_product.id
    and r.store_id   = v_store.id
    and r.status     = 'published';

  select coalesce(jsonb_agg(x.row order by x.published_at desc, x.id desc), '[]'::jsonb)
    into v_rows
  from (
    select r.id, r.published_at,
           jsonb_build_object(
             'review_id',         r.id,
             'display_name',      r.display_name,
             'rating',            r.rating,
             'title',             r.title,
             'body',              r.body,
             'verified_purchase', r.verified_purchase,
             'published_at',      r.published_at) as row
    from public.product_reviews r
    where r.product_id = v_product.id
      and r.store_id   = v_store.id
      and r.status     = 'published'
    order by r.published_at desc, r.id desc
    offset (v_page - 1) * v_size
    limit v_size
  ) x;

  return jsonb_build_object(
    'summary',   v_summary,
    'reviews',   v_rows,
    'page',      v_page,
    'page_size', v_size,
    'total',     (v_summary ->> 'count')::int);
end;
$fn$;

revoke execute on function public.product_reviews_for_slug(text, uuid, integer, integer) from public;
grant  execute on function public.product_reviews_for_slug(text, uuid, integer, integer)
  to anon, authenticated, service_role;

comment on function public.product_reviews_for_slug(text, uuid, integer, integer) is
  'Vitrina: resumen (count, average como texto, distribution) y una pagina de resenas PUBLICADAS de un producto publicado de la tienda activa del slug. Sin usuario, sin correo, sin tenant.';

-- ---------------------------------------------------------------------------
-- moderate_product_review — publicar o rechazar, con rastro.
--
-- La autorización va DENTRO: la reseña tiene que ser del tenant del JWT
-- (`can_access`) —si no, «no existe», sin confirmar que existe en otro— y el
-- rol tiene que ser de catálogo. Deja quién y cuándo en la fila y un hecho en
-- `audit_log` por `ebim.audit`, que deriva el actor del JWT.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_product_review(
  p_review_id uuid,
  p_decision  text,
  p_reason    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user   uuid := ebim.user_id();
  v_row    public.product_reviews%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_to     text;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select r.* into v_row
  from public.product_reviews r
  where r.id = p_review_id
  for update;

  if v_row.id is null or not ebim.can_access(v_row.organization_id, v_row.company_id) then
    raise exception 'RESENA_NO_ENCONTRADA: no hay ninguna resena con ese id' using errcode = '22023';
  end if;

  if not ebim.has_role(v_row.organization_id, v_row.company_id,
                       array['owner', 'admin', 'catalog']::public.app_role[]) then
    raise exception 'SIN_PERMISO: moderar resenas exige rol de catalogo' using errcode = '42501';
  end if;

  if p_decision = 'publish' then
    v_to := 'published';
    v_reason := null;
  elsif p_decision = 'reject' then
    v_to := 'rejected';
    if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500
       or v_reason ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
      raise exception 'MOTIVO_REQUERIDO: rechazar exige un motivo de 3 a 500 caracteres'
        using errcode = '22023';
    end if;
  else
    raise exception 'DECISION_INVALIDA: publish o reject' using errcode = '22023';
  end if;

  if v_row.status = v_to then
    raise exception 'SIN_CAMBIOS: la resena ya esta en ese estado' using errcode = '22023';
  end if;

  update public.product_reviews r
     set status           = v_to,
         moderated_by     = v_user,
         moderated_at     = now(),
         rejection_reason = v_reason,
         published_at     = case when v_to = 'published' then now() end
   where r.id = v_row.id
  returning r.* into v_row;

  perform ebim.audit(
    p_organization_id => v_row.organization_id,
    p_company_id      => v_row.company_id,
    p_action          => 'product_review.' || v_to,
    p_entity_type     => 'product_review',
    p_entity_id       => v_row.id,
    p_store_id        => v_row.store_id,
    p_changes         => jsonb_build_object('status', jsonb_build_object('to', v_to)),
    p_metadata        => jsonb_build_object('product_id', v_row.product_id, 'rating', v_row.rating));

  return jsonb_build_object(
    'review_id',        v_row.id,
    'status',           v_row.status,
    'moderated_at',     v_row.moderated_at,
    'rejection_reason', v_row.rejection_reason);
end;
$fn$;

revoke execute on function public.moderate_product_review(uuid, text, text) from public, anon;
grant  execute on function public.moderate_product_review(uuid, text, text) to authenticated, service_role;

comment on function public.moderate_product_review(uuid, text, text) is
  'Publica o rechaza (con motivo) una resena del tenant del JWT. Exige rol owner/admin/catalog. Deja moderated_by/at en la fila y un hecho en audit_log.';
