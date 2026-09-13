-- =============================================================================
-- Hardening multi-commerce v2 · N06 — la libreta de direcciones del CONSUMIDOR.
--
-- ## El hueco
--
-- «Mis direcciones» (H04) eran las direcciones de los pedidos que la persona ya
-- hizo con sesión. Sirve como atajo, pero un comprador B2C maduro quiere dejar
-- guardada su casa o su oficina ANTES de comprar, ponerle nombre, corregirla y
-- elegir cuál se propone primero.
--
-- ## El modelo
--
-- `consumer_addresses` es PROPIA del consumidor y está separada de
-- `customer_addresses` (la ficha B2B que administra el comercio): no la ve el
-- backoffice como dato de cliente, no se mezcla con una cuenta de empresa y no
-- sirve para autorizar nada.
--
--  · Ámbito: usuario del JWT + tienda. Una dirección guardada en `marathon` no
--    aparece en otra tienda, ni del mismo tenant ni de otro.
--  · El tenant sale de la TIENDA (la fila), nunca de un parámetro.
--  · El correo no es identidad: la fila cuelga de `user_id`.
--  · Una sola predeterminada por usuario y tienda (índice único parcial). La
--    primera que se guarda lo es; al borrar la predeterminada, pasa a la más
--    reciente que quede.
--
-- ## Cómo se llega
--
-- Sin GRANT de tabla para `anon` ni `authenticated`. Cuatro funciones, ninguna
-- recibe un usuario: `my_consumer_addresses`, `save_my_consumer_address`,
-- `delete_my_consumer_address` y `set_default_my_consumer_address`. Una
-- dirección de otro usuario o de otra tienda responde lo mismo que una que no
-- existe (`DIRECCION_NO_ENCONTRADA`): no se revela nada.
--
-- Nada de esto toca el checkout del servidor: la dirección elegida sigue
-- viajando como los campos de siempre, que el pipeline valida como cualquier
-- texto. Guardar no es comprar, y comprar no guarda nada solo.
-- =============================================================================

create table public.consumer_addresses (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  store_id        uuid        not null,
  -- `sub` del JWT. Lo pone la función; no hay parámetro que lo reciba.
  user_id         uuid        not null,
  label           text        not null,
  recipient       text,
  phone           text,
  address         text        not null,
  reference       text,
  city            text,
  region          text,
  postal_code     text,
  country         text,
  is_default      boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint consumer_addresses_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade,
  constraint consumer_addresses_label_len     check (char_length(btrim(label)) between 1 and 60),
  constraint consumer_addresses_recipient_len check (recipient is null or char_length(recipient) between 1 and 120),
  constraint consumer_addresses_phone_len     check (phone is null or char_length(phone) between 6 and 40),
  constraint consumer_addresses_address_len   check (char_length(btrim(address)) between 3 and 300),
  constraint consumer_addresses_reference_len check (reference is null or char_length(reference) <= 200),
  constraint consumer_addresses_city_len      check (city is null or char_length(city) <= 120),
  constraint consumer_addresses_region_len    check (region is null or char_length(region) <= 120),
  constraint consumer_addresses_postal_len    check (postal_code is null or char_length(postal_code) <= 12),
  constraint consumer_addresses_country_fmt   check (country is null or country ~ '^[A-Z]{2}$')
);

create index consumer_addresses_tenant_idx on public.consumer_addresses (organization_id, company_id);
create index consumer_addresses_owner_idx  on public.consumer_addresses (user_id, store_id, updated_at desc);
create unique index consumer_addresses_one_default
  on public.consumer_addresses (user_id, store_id) where is_default;

create trigger consumer_addresses_updated_at
  before update on public.consumer_addresses
  for each row execute function ebim.set_updated_at();

alter table public.consumer_addresses enable row level security;
alter table public.consumer_addresses force  row level security;

-- Lectura de lo PROPIO, sin GRANT detrás: hoy se llega por función. Si mañana
-- alguien concede SELECT, esta policy es el segundo cerrojo.
create policy consumer_addresses_select_own on public.consumer_addresses
  for select to authenticated
  using (user_id = ebim.user_id());

revoke all on public.consumer_addresses from public, anon, authenticated;
grant  all on public.consumer_addresses to service_role;

comment on table public.consumer_addresses is
  'Libreta de direcciones del consumidor con sesion, por tienda (N06). Separada de customer_addresses (B2B). Solo se llega por las funciones my_consumer_addresses / save_ / delete_ / set_default_my_consumer_address.';

-- ---------------------------------------------------------------------------
-- La tienda del slug (activa) y el usuario del JWT, o error. Interna.
-- ---------------------------------------------------------------------------
create or replace function ebim.consumer_address_scope(p_store_slug text)
returns public.stores
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;
  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no existe o no esta activa' using errcode = '22023';
  end if;
  return v_store;
end;
$fn$;

revoke execute on function ebim.consumer_address_scope(text) from public, anon, authenticated;
grant  execute on function ebim.consumer_address_scope(text) to service_role;

create or replace function ebim.consumer_address_json(a public.consumer_addresses)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',          a.id,
    'label',       a.label,
    'recipient',   a.recipient,
    'phone',       a.phone,
    'address',     a.address,
    'reference',   a.reference,
    'city',        a.city,
    'region',      a.region,
    'postal_code', a.postal_code,
    'country',     a.country,
    'is_default',  a.is_default,
    'updated_at',  a.updated_at));
$fn$;

revoke execute on function ebim.consumer_address_json(public.consumer_addresses) from public, anon, authenticated;
grant  execute on function ebim.consumer_address_json(public.consumer_addresses) to service_role;

-- ---------------------------------------------------------------------------
-- my_consumer_addresses — la libreta, la predeterminada primero.
-- ---------------------------------------------------------------------------
create or replace function public.my_consumer_addresses(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype := ebim.consumer_address_scope(p_store_slug);
begin
  return coalesce((
    select jsonb_agg(ebim.consumer_address_json(a) order by a.is_default desc, a.updated_at desc, a.id)
    from public.consumer_addresses a
    where a.user_id = ebim.user_id() and a.store_id = v_store.id
  ), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- save_my_consumer_address — crear (sin id) o editar (con id) una PROPIA.
--
-- `p_address` admite solo los campos de una dirección; cualquier otra clave
-- (usuario, tienda, tenant, `id`) se rechaza en vez de ignorarse.
-- ---------------------------------------------------------------------------
create or replace function public.save_my_consumer_address(
  p_store_slug text,
  p_address    jsonb,
  p_address_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype := ebim.consumer_address_scope(p_store_slug);
  v_user    uuid := ebim.user_id();
  v_row     public.consumer_addresses%rowtype;
  v_label   text;
  v_address text;
  v_country text;
  v_default boolean;
  v_count   integer;
  v_clean   jsonb;
begin
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'DIRECCION_INVALIDA: la direccion tiene que ser un objeto' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_address) k
    where k not in ('label', 'recipient', 'phone', 'address', 'reference', 'city',
                    'region', 'postal_code', 'country', 'is_default')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: la direccion solo admite sus propios campos' using errcode = '22023';
  end if;

  -- Texto limpio: recortado y sin vacíos disfrazados. Los CHECK de la tabla
  -- son la última palabra sobre longitudes.
  select jsonb_object_agg(key, nullif(btrim(value #>> '{}'), ''))
    into v_clean
  from jsonb_each(p_address)
  where key <> 'is_default';
  v_clean := coalesce(v_clean, '{}'::jsonb);

  v_label   := coalesce(v_clean ->> 'label', '');
  v_address := coalesce(v_clean ->> 'address', '');
  v_country := upper(v_clean ->> 'country');
  v_default := lower(coalesce(p_address ->> 'is_default', 'false')) in ('true', 't', '1');

  if char_length(v_label) not between 1 and 60 then
    raise exception 'DIRECCION_INVALIDA: ponle un nombre de 1 a 60 caracteres' using errcode = '22023';
  end if;
  if char_length(v_address) not between 3 and 300 then
    raise exception 'DIRECCION_INVALIDA: la direccion tiene que tener entre 3 y 300 caracteres' using errcode = '22023';
  end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'DIRECCION_INVALIDA: el pais va en codigo de dos letras' using errcode = '22023';
  end if;

  if p_address_id is null then
    select count(*)::int into v_count
    from public.consumer_addresses a where a.user_id = v_user and a.store_id = v_store.id;
    if v_count >= 20 then
      raise exception 'LIBRETA_LLENA: maximo 20 direcciones por tienda' using errcode = '22023';
    end if;
    -- La primera que se guarda es la predeterminada.
    v_default := v_default or v_count = 0;

    if v_default then
      update public.consumer_addresses set is_default = false
       where user_id = v_user and store_id = v_store.id and is_default;
    end if;

    insert into public.consumer_addresses (
      organization_id, company_id, store_id, user_id, label, recipient, phone,
      address, reference, city, region, postal_code, country, is_default
    ) values (
      v_store.organization_id, v_store.company_id, v_store.id, v_user, v_label,
      v_clean ->> 'recipient', v_clean ->> 'phone', v_address, v_clean ->> 'reference',
      v_clean ->> 'city', v_clean ->> 'region', v_clean ->> 'postal_code', v_country, v_default
    )
    returning * into v_row;
  else
    select a.* into v_row
    from public.consumer_addresses a
    where a.id = p_address_id and a.user_id = v_user and a.store_id = v_store.id
    for update;
    if not found then
      raise exception 'DIRECCION_NO_ENCONTRADA: no hay ninguna direccion tuya con ese id' using errcode = '22023';
    end if;

    if v_default and not v_row.is_default then
      update public.consumer_addresses set is_default = false
       where user_id = v_user and store_id = v_store.id and is_default;
    end if;

    update public.consumer_addresses
       set label = v_label,
           recipient = v_clean ->> 'recipient',
           phone = v_clean ->> 'phone',
           address = v_address,
           reference = v_clean ->> 'reference',
           city = v_clean ->> 'city',
           region = v_clean ->> 'region',
           postal_code = v_clean ->> 'postal_code',
           country = v_country,
           -- Editar no quita la marca: para eso está elegir otra.
           is_default = v_row.is_default or v_default
     where id = v_row.id
    returning * into v_row;
  end if;

  return ebim.consumer_address_json(v_row);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- delete_my_consumer_address — borrar una PROPIA.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_consumer_address(
  p_store_slug text,
  p_address_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype := ebim.consumer_address_scope(p_store_slug);
  v_user  uuid := ebim.user_id();
  v_row   public.consumer_addresses%rowtype;
begin
  delete from public.consumer_addresses a
   where a.id = p_address_id and a.user_id = v_user and a.store_id = v_store.id
  returning * into v_row;
  if not found then
    raise exception 'DIRECCION_NO_ENCONTRADA: no hay ninguna direccion tuya con ese id' using errcode = '22023';
  end if;

  -- Si era la predeterminada, lo pasa a ser la más reciente que quede.
  if v_row.is_default then
    update public.consumer_addresses set is_default = true
     where id = (
       select a.id from public.consumer_addresses a
        where a.user_id = v_user and a.store_id = v_store.id
        order by a.updated_at desc, a.id limit 1);
  end if;

  return public.my_consumer_addresses(v_store.slug);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- set_default_my_consumer_address — cuál se propone primero.
-- ---------------------------------------------------------------------------
create or replace function public.set_default_my_consumer_address(
  p_store_slug text,
  p_address_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype := ebim.consumer_address_scope(p_store_slug);
  v_user  uuid := ebim.user_id();
begin
  if not exists (
    select 1 from public.consumer_addresses a
     where a.id = p_address_id and a.user_id = v_user and a.store_id = v_store.id
  ) then
    raise exception 'DIRECCION_NO_ENCONTRADA: no hay ninguna direccion tuya con ese id' using errcode = '22023';
  end if;

  update public.consumer_addresses set is_default = false
   where user_id = v_user and store_id = v_store.id and is_default and id <> p_address_id;
  update public.consumer_addresses set is_default = true
   where id = p_address_id;

  return public.my_consumer_addresses(v_store.slug);
end;
$fn$;

revoke execute on function public.my_consumer_addresses(text)                      from public, anon;
revoke execute on function public.save_my_consumer_address(text, jsonb, uuid)      from public, anon;
revoke execute on function public.delete_my_consumer_address(text, uuid)           from public, anon;
revoke execute on function public.set_default_my_consumer_address(text, uuid)      from public, anon;

grant execute on function public.my_consumer_addresses(text)                  to authenticated;
grant execute on function public.save_my_consumer_address(text, jsonb, uuid)  to authenticated;
grant execute on function public.delete_my_consumer_address(text, uuid)       to authenticated;
grant execute on function public.set_default_my_consumer_address(text, uuid)  to authenticated;

comment on function public.my_consumer_addresses(text) is
  'Libreta de direcciones del usuario con sesion en esta tienda (N06). La predeterminada primero.';
comment on function public.save_my_consumer_address(text, jsonb, uuid) is
  'Crea o edita una direccion PROPIA en esta tienda. Sin usuario por parametro; claves ajenas rechazadas; ajena = DIRECCION_NO_ENCONTRADA.';
comment on function public.delete_my_consumer_address(text, uuid) is
  'Borra una direccion PROPIA en esta tienda; si era la predeterminada, lo pasa a ser la mas reciente.';
comment on function public.set_default_my_consumer_address(text, uuid) is
  'Marca como predeterminada una direccion PROPIA en esta tienda (una sola por usuario y tienda).';
