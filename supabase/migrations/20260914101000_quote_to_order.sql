-- =============================================================================
-- Cierre P0 · A3 — la cotizacion se convierte en pedido, y el comprador la pide.
--
-- ## El hueco
--
-- `quotes` existia con estados, vigencia y un `order_id` que nadie escribia. El
-- backoffice podia marcarla `accepted` con un `update` directo, y ahi terminaba
-- todo: no habia forma de que el precio negociado llegara a un pedido, ni de que
-- el comprador viera o pidiera una cotizacion.
--
-- ## La decision: carrito + acuerdo de precio, NO pedido directo
--
-- La cabecera de `trade_quotes` pedia que convertir fuera «copiar, no traducir».
-- Ese deseo choca con una regla posterior y mas importante: `create_order` NUNCA
-- acepta un precio del llamante y SIEMPRE re-precia con el motor. Copiar los
-- importes de la cotizacion al pedido obligaria a abrir en `create_order` una
-- puerta para precios declarados, y esa puerta es exactamente la que el motor
-- existe para cerrar. Y un pedido creado desde SQL se saltaria el pipeline
-- oficial: surtido, existencias, credito, orden de compra y aprobacion.
--
-- Asi que aceptar una cotizacion hace dos cosas, y ninguna es crear el pedido:
--
--  1. **Convierte su precio en un ACUERDO que el motor ya sabe leer**: una lista
--     de precios con alcance `customer` (el de mayor precedencia), vigente hasta
--     `valid_until`. La cabecera de `pricing_resolution` define ese alcance como
--     «un precio negociado con un cliente», que es literalmente lo que es una
--     cotizacion aceptada. No hay segundo motor de precio: hay un renglon mas en
--     el unico que existe.
--  2. **Devuelve las lineas para el carrito.** El comprador compra por el
--     checkout de siempre, con su sesion, y el pipeline aplica todas sus reglas.
--
-- ## Por que el precio no se escapa
--
--  - `min_quantity` del renglon = cantidad cotizada, en unidades base. El precio
--    de 1.000 unidades no vale para comprar 5: por debajo, el motor cae al
--    precio de siempre.
--  - La lista se CIERRA en cuanto un pedido la usa (trigger diferido, abajo). Una
--    cotizacion se convierte UNA vez.
--  - La vigencia de la lista es la de la cotizacion. Vencida, deja de aplicar
--    sin que haga falta ningun proceso.
--
-- ## Por que el enlace pedido <-> cotizacion es un trigger DIFERIDO
--
-- `create_order` resuelve el precio linea a linea dentro de su bucle (lo dice
-- `pricing_resolution` en `resolve_price`). Cerrar la lista al insertar la
-- PRIMERA linea haria que la segunda ya se cobrara a precio de catalogo. Por eso
-- el trigger es `deferrable initially deferred`: corre al COMMIT, con el pedido
-- entero escrito. Y bloquea la cotizacion `for update`, de modo que si dos
-- checkouts del mismo comprador la usaran a la vez, el segundo aborta al
-- confirmar en vez de llevarse el precio dos veces.
--
-- ## Dependencia de modulo
--
-- Las listas de precio las gobierna `pricing.lists`. Una lista NACIDA de una
-- cotizacion la gobierna `trade.quotes`: un tenant que vende con cotizaciones
-- pero no tiene listas contratadas no puede quedarse con cotizaciones que se
-- aceptan y luego se cobran a precio de catalogo sin que nadie lo note.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · El vinculo lista <-> cotizacion, y la firma de la aceptacion.
-- ---------------------------------------------------------------------------
alter table public.price_lists
  add column if not exists source_quote_id uuid;

do $$ begin
  alter table public.price_lists
    add constraint price_lists_source_quote_fk
    foreign key (source_quote_id, organization_id, company_id)
    references public.quotes (id, organization_id, company_id)
    on delete set null (source_quote_id);
exception when duplicate_object then null; end $$;

-- Una cotizacion genera, como mucho, UNA lista. Es la red de seguridad de la
-- idempotencia: aunque dos aceptaciones llegaran a la vez, la segunda choca aqui.
create unique index if not exists price_lists_source_quote_unique
  on public.price_lists (source_quote_id)
  where source_quote_id is not null;

comment on column public.price_lists.source_quote_id is
  'Cotizacion de la que nace esta lista (A3). Gobernada por trade.quotes, se cierra al convertirse en pedido.';

alter table public.quotes
  add column if not exists accepted_at    timestamptz,
  add column if not exists accepted_by    uuid,
  add column if not exists accepted_email text,
  add column if not exists price_list_id  uuid,
  add column if not exists request_key    text,
  add column if not exists requested_by   uuid;

do $$ begin
  alter table public.quotes
    add constraint quotes_request_key_fmt
    check (request_key is null or request_key ~ '^[A-Za-z0-9_.:-]{8,120}$');
exception when duplicate_object then null; end $$;

-- La idempotencia de la SOLICITUD: la misma clave dentro de la sociedad es la
-- misma cotizacion, no otra.
create unique index if not exists quotes_request_key_unique
  on public.quotes (organization_id, company_id, request_key)
  where request_key is not null;

-- ---------------------------------------------------------------------------
-- 2 · Las listas VIVAS, con las de cotizacion gobernadas por su propio modulo.
--
-- Mismas columnas, en el mismo orden, que en `20260827180100_pricing_resolution`:
-- `resolve_prices` y `public_unit_prices` la leen tal cual. Lo unico que cambia
-- es QUE capacidad hace falta: `trade.quotes` para una lista nacida de una
-- cotizacion, `pricing.lists` para todas las demas.
-- ---------------------------------------------------------------------------
create or replace view ebim.active_price_lists as
select
  pl.id              as price_list_id,
  pl.store_id,
  pl.organization_id,
  pl.company_id,
  pl.code            as price_list_code,
  pl.name            as price_list_name,
  pl.currency,
  pl.priority,
  pl.valid_from,
  pl.valid_to,
  a.id               as assignment_id,
  a.scope,
  a.channel_id,
  a.segment_id,
  a.customer_id,
  case a.scope
    when 'customer' then 40
    when 'segment'  then 30
    when 'channel'  then 20
    else 10
  end                as scope_rank
from public.price_lists pl
join public.price_list_assignments a
  on a.price_list_id = pl.id
 and a.store_id      = pl.store_id
 and a.is_active
join public.app_capabilities cap
  on cap.code = case when pl.source_quote_id is null then 'pricing.lists' else 'trade.quotes' end
join public.tenant_entitlements ent
  on ent.organization_id  = pl.organization_id
 and ent.company_id       = pl.company_id
 and ent.entitlement_code = cap.entitlement_code
 and ent.is_active
left join public.tenant_platform_context ctx
  on ctx.organization_id = pl.organization_id
 and ctx.company_id      = pl.company_id
left join public.tenant_feature_flags flag
  on flag.organization_id = pl.organization_id
 and flag.company_id      = pl.company_id
 and flag.flag_key        = cap.code
where pl.is_active
  and coalesce(ctx.app_active, true)
  and coalesce(flag.is_enabled, true);

revoke all on ebim.active_price_lists from public, anon, authenticated;
grant select on ebim.active_price_lists to service_role;

comment on view ebim.active_price_lists is
  'Listas vivas de tenants con el modulo contratado: pricing.lists, o trade.quotes si la lista nace de una cotizacion (A3). Definer: no se concede a anon.';

-- ---------------------------------------------------------------------------
-- 3 · Quien es el comprador de una cotizacion.
--
-- Una sola regla, usada por las tres funciones de abajo: la cotizacion es de la
-- persona si su cuenta EFECTIVA en esa sociedad es del mismo cliente —y, si la
-- cotizacion nombra una cuenta, es ESA cuenta—. La efectiva y no cualquiera de
-- sus cuentas: el checkout precia con la efectiva, y aceptar con una cuenta para
-- comprar con otra dejaria el acuerdo sin aplicar.
--
-- Devuelve la cuenta y el rol, o nada. Nunca dice por que no: saber que una
-- cotizacion EXISTE ya es informacion de otro cliente.
-- ---------------------------------------------------------------------------
create or replace function ebim.quote_buyer(p_quote public.quotes, p_user uuid)
returns table (business_account_id uuid, customer_id uuid, role public.business_role)
language sql
stable
security definer
set search_path = ''
as $fn$
  select a.id, a.customer_id, u.role
  from public.business_accounts a
  join public.business_account_users u
    on u.business_account_id = a.id
   and u.user_id = p_user
   and u.status  = 'active'
  where a.id = ebim.effective_business_account(p_user, p_quote.organization_id, p_quote.company_id)
    and a.is_active
    and a.customer_id = p_quote.customer_id
    and (p_quote.business_account_id is null or p_quote.business_account_id = a.id)
  limit 1;
$fn$;

revoke execute on function ebim.quote_buyer(public.quotes, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · public.my_quotes — las cotizaciones del comprador en esta tienda.
--
-- Sin id de cuenta ni de cliente: salen de la sesion. Los borradores del
-- vendedor NO se ven —son trabajo interno sin precio firme—, salvo las
-- solicitudes que hizo la propia persona, que se ven como `requested`.
--
-- `sent` con la vigencia pasada se devuelve como `expired`: no hay proceso que
-- las venza, y ensenar «vigente» una cotizacion que ya no se puede aceptar es
-- mandar al comprador a un error.
-- ---------------------------------------------------------------------------
create or replace function public.my_quotes(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user    uuid := ebim.user_id();
  v_store   public.stores%rowtype;
  v_account uuid;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return '[]'::jsonb;
  end if;

  v_account := ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);
  if v_account is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(q.item order by q.issued_at desc, q.quote_number desc)
    from (
      select
        qt.issued_at,
        qt.quote_number,
        jsonb_build_object(
          'quote_id',     qt.id,
          'quote_number', qt.quote_number,
          'status',       case
                            when qt.status = 'draft' then 'requested'
                            when qt.status = 'sent' and qt.valid_until < current_date then 'expired'
                            else qt.status::text
                          end,
          'currency',     qt.currency,
          'issued_at',    qt.issued_at,
          'valid_until',  qt.valid_until,
          'subtotal',     qt.subtotal::text,
          'tax_total',    qt.tax_total::text,
          'grand_total',  qt.grand_total::text,
          'order_id',     qt.order_id,
          'accepted_at',  qt.accepted_at,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'product_id', i.product_id,
                     'variant_id', i.variant_id,
                     'name',       p.name,
                     'uom_code',   i.uom_code,
                     'quantity',   i.quantity::text,
                     'unit_price', i.unit_price::text,
                     'line_total', i.line_total::text
                   ) order by i.position, i.id)
            from public.quote_items i
            join public.products p on p.id = i.product_id
            where i.quote_id = qt.id
          ), '[]'::jsonb)
        ) as item
      from public.quotes qt
      join public.business_accounts a on a.id = v_account
      where qt.store_id    = v_store.id
        and qt.customer_id = a.customer_id
        and (qt.business_account_id is null or qt.business_account_id = v_account)
        and (qt.status <> 'draft' or qt.requested_by = v_user)
    ) q
  ), '[]'::jsonb);
end;
$fn$;

revoke execute on function public.my_quotes(text) from public, anon;
grant  execute on function public.my_quotes(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5 · public.accept_quote — aceptar y convertir el precio en acuerdo.
--
-- IDEMPOTENTE: la cotizacion se bloquea `for update`, y si ya genero su lista se
-- devuelve lo mismo (`already_accepted`) sin crear otra. Dos clics, dos
-- pestanas o un reintento de red producen UNA conversion.
--
-- SIN efectos si falla: todas las comprobaciones van ANTES de escribir la
-- primera fila, y cualquier `raise` revierte la transaccion entera.
-- ---------------------------------------------------------------------------
create or replace function public.accept_quote(p_quote_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user     uuid := ebim.user_id();
  v_quote    public.quotes%rowtype;
  v_store    public.stores%rowtype;
  v_buyer    record;
  v_list_id  uuid;
  v_lines    jsonb;
  v_bad      text;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'COTIZACION_NO_ENCONTRADA: no hay una cotizacion tuya con ese identificador'
      using errcode = '22023';
  end if;

  select s.* into v_store from public.stores s where s.id = v_quote.store_id and s.status = 'active';

  select * into v_buyer from ebim.quote_buyer(v_quote, v_user);

  -- Mismo mensaje para «no existe», «es de otro cliente», «es de otra sociedad»
  -- y «la tienda esta apagada»: distinguirlos le diria a quien pregunta que
  -- esa cotizacion existe.
  if v_store.id is null or v_buyer.business_account_id is null then
    raise exception 'COTIZACION_NO_ENCONTRADA: no hay una cotizacion tuya con ese identificador'
      using errcode = '22023';
  end if;

  -- Quien solo mira no compromete dinero.
  if v_buyer.role not in ('admin', 'approver', 'buyer') then
    raise exception 'SIN_PERMISO: tu rol en la cuenta no permite aceptar cotizaciones'
      using errcode = '42501';
  end if;

  if not ebim.company_is_entitled(v_quote.organization_id, v_quote.company_id, 'trade.quotes') then
    raise exception 'SIN_MODULO: las cotizaciones no estan activas para esta tienda'
      using errcode = '42501';
  end if;

  if v_quote.order_id is not null then
    raise exception 'COTIZACION_YA_CONVERTIDA: esta cotizacion ya se convirtio en un pedido'
      using errcode = '22023';
  end if;

  -- La vigencia se mira ANTES que la repeticion: devolver lineas de una
  -- cotizacion vencida mandaria al carrito una promesa de precio que el motor
  -- ya no va a cumplir.
  if v_quote.valid_until < current_date then
    raise exception 'COTIZACION_VENCIDA: la cotizacion vencio el %', v_quote.valid_until
      using errcode = '22023';
  end if;

  if v_quote.status not in ('sent', 'accepted') then
    raise exception 'COTIZACION_NO_ACEPTABLE: una cotizacion en estado % no se puede aceptar', v_quote.status
      using errcode = '22023';
  end if;

  if v_quote.currency <> v_store.currency then
    raise exception 'COTIZACION_MONEDA_INCONSISTENTE: la cotizacion esta en % y la tienda vende en %',
      v_quote.currency, v_store.currency
      using errcode = '22023';
  end if;

  -- Las lineas, tal como iran al carrito.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', i.product_id,
           'variant_id', i.variant_id,
           'uom_code',   i.uom_code,
           'quantity',   i.quantity::integer
         ) order by i.position, i.id), '[]'::jsonb)
    into v_lines
  from public.quote_items i
  where i.quote_id = v_quote.id;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'COTIZACION_NO_ACEPTABLE: la cotizacion no tiene lineas'
      using errcode = '22023';
  end if;

  -- Repeticion: ya convertida en acuerdo. Mismo resultado, ninguna escritura.
  if v_quote.price_list_id is not null then
    return jsonb_build_object(
      'quote_id',         v_quote.id,
      'quote_number',     v_quote.quote_number,
      'status',           'accepted',
      'already_accepted', true,
      'valid_until',      v_quote.valid_until,
      'currency',         v_quote.currency,
      'lines',            v_lines);
  end if;

  -- El pedido lleva unidades enteras. Una cotizacion por 2,5 unidades no puede
  -- honrarse tal cual, y redondear por el comprador seria decidir por el.
  select i.id::text into v_bad
  from public.quote_items i
  where i.quote_id = v_quote.id
    and (i.quantity <> trunc(i.quantity) or i.quantity > 10000)
  limit 1;
  if v_bad is not null then
    raise exception 'COTIZACION_CANTIDAD_NO_ENTERA: la cotizacion tiene cantidades que no se pueden pedir tal cual'
      using errcode = '22023';
  end if;

  -- Una presentacion que el producto ya no tiene no se puede tarifar.
  select i.id::text into v_bad
  from public.quote_items i
  where i.quote_id = v_quote.id
    and i.uom_code is not null
    and not exists (
      select 1
      from public.units_of_measure u
      join public.product_uoms pu on pu.uom_id = u.id and pu.product_id = i.product_id
      where u.code = i.uom_code
        and u.organization_id = v_quote.organization_id
        and u.company_id      = v_quote.company_id
    )
  limit 1;
  if v_bad is not null then
    raise exception 'COTIZACION_UOM_NO_DISPONIBLE: una presentacion cotizada ya no esta disponible'
      using errcode = '22023';
  end if;

  -- ---- A partir de aqui, solo escrituras ------------------------------------
  insert into public.price_lists (
    organization_id, company_id, store_id, code, name, currency,
    priority, valid_from, valid_to, is_active, notes, source_quote_id
  )
  values (
    v_quote.organization_id, v_quote.company_id, v_quote.store_id,
    'cot-' || left(replace(v_quote.id::text, '-', ''), 24),
    left('Cotizacion ' || v_quote.quote_number, 120),
    v_quote.currency,
    -- La mas alta del rango: dentro del alcance de cliente, lo firmado para
    -- esta cotizacion gana a un acuerdo general del mismo cliente.
    1000,
    now(),
    (v_quote.valid_until + 1)::timestamptz,
    true,
    'Generada al aceptar la cotizacion ' || v_quote.quote_number,
    v_quote.id
  )
  returning id into v_list_id;

  insert into public.price_list_items (
    organization_id, company_id, store_id, price_list_id,
    product_id, variant_id, uom_id, min_quantity, unit_price
  )
  select
    v_quote.organization_id, v_quote.company_id, v_quote.store_id, v_list_id,
    i.product_id, i.variant_id, pu.uom_id,
    -- La escala del motor se mide en unidades BASE.
    i.quantity * coalesce(pu.factor, 1),
    i.unit_price
  from public.quote_items i
  left join public.units_of_measure u
    on u.code = i.uom_code
   and u.organization_id = v_quote.organization_id
   and u.company_id      = v_quote.company_id
  left join public.product_uoms pu
    on pu.uom_id = u.id and pu.product_id = i.product_id
  where i.quote_id = v_quote.id;

  insert into public.price_list_assignments (
    organization_id, company_id, store_id, price_list_id, scope, customer_id, is_active
  )
  values (
    v_quote.organization_id, v_quote.company_id, v_quote.store_id, v_list_id,
    'customer', v_quote.customer_id, true
  );

  update public.quotes
     set status         = 'accepted',
         accepted_at    = now(),
         accepted_by    = v_user,
         accepted_email = ebim.email(),
         price_list_id  = v_list_id,
         updated_at     = now()
   where id = v_quote.id;

  perform ebim.publish_event(
    v_quote.organization_id, v_quote.company_id, v_quote.store_id,
    'quote.accepted', 'quote', v_quote.id,
    jsonb_build_object(
      'quote_id',            v_quote.id,
      'quote_number',        v_quote.quote_number,
      'business_account_id', v_buyer.business_account_id,
      'accepted_by',         v_user,
      'price_list_id',       v_list_id,
      'valid_until',         v_quote.valid_until,
      'grand_total',         v_quote.grand_total::text,
      'currency',            v_quote.currency),
    'quote.accepted:' || v_quote.id::text);

  return jsonb_build_object(
    'quote_id',         v_quote.id,
    'quote_number',     v_quote.quote_number,
    'status',           'accepted',
    'already_accepted', false,
    'valid_until',      v_quote.valid_until,
    'currency',         v_quote.currency,
    'lines',            v_lines);
end;
$fn$;

revoke execute on function public.accept_quote(uuid) from public, anon;
grant  execute on function public.accept_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · El enlace pedido -> cotizacion, al COMMIT.
--
-- Diferido: ver la cabecera. Cierra la lista y la asignacion para que el mismo
-- precio no sirva a un segundo pedido, y aborta el commit de un pedido que
-- intentara usar una cotizacion que otro pedido ya convirtio.
-- ---------------------------------------------------------------------------
create or replace function ebim.link_order_to_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_quote_id uuid;
  v_quote    public.quotes%rowtype;
begin
  if new.price_list_id is null then
    return null;
  end if;

  select pl.source_quote_id into v_quote_id
  from public.price_lists pl
  where pl.id = new.price_list_id;

  if v_quote_id is null then
    return null;
  end if;

  select * into v_quote from public.quotes where id = v_quote_id for update;
  if not found then
    return null;
  end if;

  if v_quote.order_id is null then
    update public.quotes
       set order_id = new.order_id, updated_at = now()
     where id = v_quote_id;

    update public.price_lists
       set is_active = false, updated_at = now()
     where id = new.price_list_id;

    update public.price_list_assignments
       set is_active = false, updated_at = now()
     where price_list_id = new.price_list_id;

    perform ebim.publish_event(
      v_quote.organization_id, v_quote.company_id, v_quote.store_id,
      'quote.converted', 'quote', v_quote_id,
      jsonb_build_object(
        'quote_id',     v_quote_id,
        'quote_number', v_quote.quote_number,
        'order_id',     new.order_id),
      'quote.converted:' || v_quote_id::text);

  elsif v_quote.order_id <> new.order_id then
    raise exception 'COTIZACION_YA_CONVERTIDA: el precio de esa cotizacion ya lo uso otro pedido'
      using errcode = '23505';
  end if;

  return null;
end;
$fn$;

revoke execute on function ebim.link_order_to_quote() from public;

drop trigger if exists order_items_link_quote on public.order_items;
create constraint trigger order_items_link_quote
  after insert on public.order_items
  deferrable initially deferred
  for each row execute function ebim.link_order_to_quote();

-- ---------------------------------------------------------------------------
-- 7 · public.request_quote — el comprador PIDE una cotizacion.
--
-- Crea un BORRADOR: el precio lo firma el vendedor, no quien pide. Las lineas
-- nacen con el precio que el motor le daria HOY a ese cliente, como referencia
-- para quien va a cotizar; ninguna llega del navegador.
--
-- Idempotente por `p_request_key`: la misma clave dentro de la sociedad es la
-- misma solicitud. Si la clave ya la uso OTRA persona, conflicto: una clave no
-- es un pase para leer la solicitud de nadie.
-- ---------------------------------------------------------------------------
create or replace function public.request_quote(
  p_store_slug  text,
  p_lines       jsonb,
  p_notes       text default null,
  p_request_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user      uuid := ebim.user_id();
  v_store     public.stores%rowtype;
  v_account   public.business_accounts%rowtype;
  v_customer  public.customers%rowtype;
  v_role      public.business_role;
  v_channel   uuid;
  v_existing  public.quotes%rowtype;
  v_quote_id  uuid;
  v_number    text;
  v_line      jsonb;
  v_key       text;
  v_notes     text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_.:-]{8,120}$' then
    raise exception 'IDEMPOTENCIA_INVALIDA: hace falta una clave de solicitud valida'
      using errcode = '22023';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no existe o no esta activa'
      using errcode = '22023';
  end if;

  select a.* into v_account
  from public.business_accounts a
  where a.id = ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id)
    and a.is_active;
  if not found then
    raise exception 'CUENTA_NO_VINCULADA: tu usuario no compra para ninguna empresa en esta tienda'
      using errcode = '42501';
  end if;

  select u.role into v_role
  from public.business_account_users u
  where u.business_account_id = v_account.id and u.user_id = v_user and u.status = 'active';

  if v_role is null or v_role not in ('admin', 'approver', 'buyer') then
    raise exception 'SIN_PERMISO: tu rol en la cuenta no permite pedir cotizaciones'
      using errcode = '42501';
  end if;

  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'trade.quotes') then
    raise exception 'SIN_MODULO: las cotizaciones no estan activas para esta tienda'
      using errcode = '42501';
  end if;

  -- Repeticion de la misma solicitud.
  select * into v_existing
  from public.quotes q
  where q.organization_id = v_store.organization_id
    and q.company_id      = v_store.company_id
    and q.request_key     = p_request_key;
  if found then
    if v_existing.requested_by is distinct from v_user then
      raise exception 'IDEMPOTENCIA_EN_CONFLICTO: esa clave ya se uso para otra solicitud'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'quote_id',          v_existing.id,
      'quote_number',      v_existing.quote_number,
      'status',            'requested',
      'already_requested', true);
  end if;

  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'CAMPO_INVALIDO: la nota admite como maximo 1000 caracteres'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ITEMS_REQUERIDOS: la solicitud necesita al menos una linea'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'ITEMS_EXCESIVOS: una solicitud admite como maximo 50 lineas'
      using errcode = '22023';
  end if;

  -- Cada linea, validada ANTES de escribir nada.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'CAMPO_INVALIDO: cada linea tiene que ser un objeto' using errcode = '22023';
    end if;

    -- Lista BLANCA: un precio, un descuento o un cliente dentro de una linea no
    -- se ignora en silencio, se rechaza.
    for v_key in select jsonb_object_keys(v_line) loop
      if v_key not in ('product_id', 'variant_id', 'uom_code', 'quantity') then
        raise exception 'CAMPO_NO_PERMITIDO: la linea no admite el campo %', v_key
          using errcode = '22023';
      end if;
    end loop;

    if ebim.safe_uuid(v_line ->> 'product_id') is null
       or not exists (
         select 1 from public.products p
         where p.id = ebim.safe_uuid(v_line ->> 'product_id')
           and p.store_id = v_store.id
           and p.status <> 'archived')
    then
      raise exception 'PRODUCTO_NO_DISPONIBLE: una linea nombra un producto que esta tienda no ofrece'
        using errcode = '22023';
    end if;

    if coalesce(v_line ->> 'quantity', '') !~ '^[0-9]{1,5}$'
       or (v_line ->> 'quantity')::integer < 1
       or (v_line ->> 'quantity')::integer > 10000
    then
      raise exception 'CANTIDAD_INVALIDA: la cantidad tiene que ser un entero entre 1 y 10000'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(*) <> count(distinct (l ->> 'product_id', coalesce(l ->> 'variant_id', ''), coalesce(l ->> 'uom_code', '')))
    from jsonb_array_elements(p_lines) l
  ) then
    raise exception 'LINEA_DUPLICADA: el mismo producto aparece dos veces en la solicitud'
      using errcode = '22023';
  end if;

  select * into v_customer from public.customers c where c.id = v_account.customer_id;

  select ch.id into v_channel
  from public.channels ch
  where ch.store_id = v_store.id and ch.is_default and ch.is_active
  limit 1;

  v_number := 'SOL-' || to_char(current_date, 'YYYYMMDD') || '-'
              || upper(left(replace(gen_random_uuid()::text, '-', ''), 6));

  insert into public.quotes (
    organization_id, company_id, store_id, customer_id, business_account_id,
    quote_number, status, currency, issued_at, valid_until, notes,
    request_key, requested_by
  )
  values (
    v_store.organization_id, v_store.company_id, v_store.id, v_customer.id, v_account.id,
    v_number, 'draft', v_store.currency, current_date, current_date + 15, v_notes,
    p_request_key, v_user
  )
  returning id into v_quote_id;

  insert into public.quote_items (
    organization_id, company_id, quote_id, product_id, variant_id, uom_code,
    quantity, unit_price, line_total, position
  )
  select
    v_store.organization_id, v_store.company_id, v_quote_id,
    l.product_id, l.variant_id, l.uom_code, l.quantity,
    coalesce(r.unit_price, 0),
    round(coalesce(r.unit_price, 0) * l.quantity, 2),
    l.position
  from (
    select
      ebim.safe_uuid(e.value ->> 'product_id')        as product_id,
      ebim.safe_uuid(e.value ->> 'variant_id')        as variant_id,
      nullif(btrim(e.value ->> 'uom_code'), '')       as uom_code,
      (e.value ->> 'quantity')::integer               as quantity,
      (e.ordinality - 1)::smallint                    as position,
      e.ordinality::text                              as line_key
    from jsonb_array_elements(p_lines) with ordinality e
  ) l
  left join public.units_of_measure u
    on u.code = l.uom_code
   and u.organization_id = v_store.organization_id
   and u.company_id      = v_store.company_id
  left join lateral ebim.resolve_prices(
    v_store.id, v_channel,
    jsonb_build_array(jsonb_build_object(
      'line_key', l.line_key, 'product_id', l.product_id,
      'variant_id', l.variant_id, 'uom_id', u.id, 'quantity', l.quantity)),
    v_store.currency, now(), v_customer.segment_id, v_customer.id
  ) r on true;

  update public.quotes q
     set subtotal    = t.total,
         grand_total = t.total,
         updated_at  = now()
    from (select coalesce(sum(line_total), 0) as total from public.quote_items where quote_id = v_quote_id) t
   where q.id = v_quote_id;

  perform ebim.publish_event(
    v_store.organization_id, v_store.company_id, v_store.id,
    'quote.requested', 'quote', v_quote_id,
    jsonb_strip_nulls(jsonb_build_object(
      'quote_id',            v_quote_id,
      'quote_number',        v_number,
      'business_account_id', v_account.id,
      'requested_by',        v_user,
      'lines',               jsonb_array_length(p_lines))),
    'quote.requested:' || v_quote_id::text);

  return jsonb_build_object(
    'quote_id',          v_quote_id,
    'quote_number',      v_number,
    'status',            'requested',
    'already_requested', false);
end;
$fn$;

revoke execute on function public.request_quote(text, jsonb, text, text) from public, anon;
grant  execute on function public.request_quote(text, jsonb, text, text) to authenticated;

comment on function public.my_quotes(text) is
  'Cotizaciones del comprador en esta tienda, resueltas desde la sesion (A3). Borradores del vendedor ocultos; vencidas marcadas.';
comment on function public.accept_quote(uuid) is
  'Acepta una cotizacion propia, vigente y en la moneda de la tienda: la convierte en lista de precio de cliente y devuelve las lineas para el carrito. Idempotente (A3).';
comment on function public.request_quote(text, jsonb, text, text) is
  'El comprador pide una cotizacion: crea un borrador con precio de referencia del motor. Idempotente por clave de solicitud (A3).';
