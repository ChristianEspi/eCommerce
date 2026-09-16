-- =============================================================================
-- Stores + Product Master · Fase 02 — tiendas en autoservicio
--
-- ## El problema
--
-- Una sociedad podía TENER varias tiendas (nada en `stores` lo impide, el seed
-- tiene dos y el selector del backoffice pinta un menú), pero no podía CREAR la
-- segunda: la única función que inserta una tienda es `bootstrap_tenant`, que
-- falla con `TENANT_YA_EXISTE` en cuanto la organización existe. Y aunque la RLS
-- dejaba a un admin insertar en `stores` a mano, eso no creaba `store_settings`
-- ni decía nada útil cuando el slug ya estaba tomado.
--
-- ## Lo que añade
--
--  · `public.create_store(slug, name, currency, domain?)` — el alta.
--  · `public.update_store(store_id, …)` — nombre, slug, dominio y moneda.
--  · `public.set_store_status(store_id, status)` — draft / active / suspended.
--  · Un trigger que impide mover una tienda a otra organización o sociedad.
--  · Un trigger que reinicia la verificación del dominio propio cuando cambia.
--
-- ## Por qué SECURITY INVOKER
--
-- Las tres funciones corren con los permisos de quien llama. La RLS de `stores`,
-- `store_settings` y `channels` ya exige owner/admin para escribir, y el canal
-- por defecto lo crea el trigger `stores_default_channel` con esos mismos
-- permisos. Las funciones añaden lo que la RLS no puede decir: de dónde sale el
-- tenant (del JWT y nunca de un parámetro), la sociedad ACTIVA, códigos de error
-- estables y la atomicidad tienda + ajustes. Las dos únicas piezas que necesitan
-- más privilegio son funciones pequeñas y cerradas: el aviso de moneda en uso
-- (tiene que ver pedidos y listas que un rol concreto podría no leer) y el
-- reinicio de la verificación de dominio (columnas sin GRANT de escritura).
--
-- ## Lo que NO hace
--
--  · No toca `bootstrap_tenant`: el alta del tenant sigue siendo esa.
--  · No publica: una tienda nace `draft`. Activarla es un acto explícito.
--  · No borra: una tienda con pedidos, cobros y asientos de inventario no se
--    borra desde el backoffice; se suspende. La policy `stores_delete_owner`
--    sigue existiendo y no se expone en ninguna pantalla.
--  · No limita cuántas tiendas tiene una sociedad: el hub no declara ese límite
--    y un número local sería un catálogo comercial inventado (contrato §5/§6).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Una tienda no cambia de tenant
--
-- La policy de UPDATE comprueba el rol sobre la fila NUEVA, así que un admin de
-- dos sociedades podía mover una tienda de una a otra con un PATCH. Con ella se
-- moverían sus pedidos, su canal y su catálogo a otra contabilidad.
-- ---------------------------------------------------------------------------
create or replace function ebim.guard_store_tenant()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.organization_id is distinct from old.organization_id
     or new.company_id is distinct from old.company_id then
    raise exception 'TIENDA_TENANT_INMUTABLE: una tienda no cambia de organizacion ni de sociedad'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

revoke all on function ebim.guard_store_tenant() from public, anon, authenticated;

drop trigger if exists stores_guard_tenant on public.stores;
create trigger stores_guard_tenant
  before update of organization_id, company_id on public.stores
  for each row execute function ebim.guard_store_tenant();

-- ---------------------------------------------------------------------------
-- 2 · El dominio verificado es el de ESE dominio
--
-- `store_settings.custom_domain_*` guarda el token y el estado de verificación
-- del dominio que la tienda tenía al reclamarlo. Si el dominio cambia, esa
-- verificación ya no prueba nada. Trigger y no línea dentro de `update_store`:
-- tiene que valer también para una escritura directa.
-- ---------------------------------------------------------------------------
create or replace function ebim.reset_store_domain_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.domain is distinct from old.domain then
    update public.store_settings ss
       set custom_domain_status      = 'none',
           custom_domain_verified_at = null,
           custom_domain_token       = null
     where ss.store_id = new.id
       and (ss.custom_domain_status <> 'none' or ss.custom_domain_token is not null);
  end if;
  return new;
end;
$fn$;

revoke all on function ebim.reset_store_domain_verification() from public, anon, authenticated;

drop trigger if exists stores_reset_domain_verification on public.stores;
create trigger stores_reset_domain_verification
  after update of domain on public.stores
  for each row execute function ebim.reset_store_domain_verification();

-- ---------------------------------------------------------------------------
-- 3 · Piezas comunes
-- ---------------------------------------------------------------------------

/** Quien llama puede administrar tiendas de ESTA organización y sociedad. */
create or replace function ebim.assert_store_manager(p_organization_id uuid, p_company_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: administrar tiendas exige sesion' using errcode = '42501';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no administra tiendas de un tenant'
      using errcode = '42501';
  end if;
  if p_organization_id is null or p_company_id is null
     or p_organization_id is distinct from ebim.org_id()
     or not (p_company_id = any (ebim.companies())) then
    raise exception 'SIN_CONTEXTO: la sesion no trae la organizacion y la sociedad de esta tienda'
      using errcode = '42501';
  end if;
  if not ebim.has_role(p_organization_id, p_company_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: administrar tiendas exige rol owner o admin' using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function ebim.assert_store_manager(uuid, uuid) from public, anon;
grant execute on function ebim.assert_store_manager(uuid, uuid) to authenticated, service_role;

/** Nombre de tienda normalizado, o error estable. */
create or replace function ebim.store_name_or_fail(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 200 then
    raise exception 'TIENDA_NOMBRE_INVALIDO: el nombre tiene de 1 a 200 caracteres' using errcode = '22023';
  end if;
  return v_name;
end;
$fn$;

/** Slug normalizado con la MISMA regla que el CHECK `stores_slug_format`. */
create or replace function ebim.store_slug_or_fail(p_slug text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$' then
    raise exception 'TIENDA_SLUG_INVALIDO: minusculas, numeros y guiones, de 3 a 62 caracteres'
      using errcode = '22023';
  end if;
  return v_slug;
end;
$fn$;

/**
 * Dominio normalizado. Más estricto que el CHECK `stores_domain_format` (que
 * solo acota alfabeto y largo): exige etiquetas DNS válidas y un TLD, porque un
 * dominio que no se puede resolver solo sirve para bloquear el nombre.
 */
create or replace function ebim.store_domain_or_fail(p_domain text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
begin
  if v_domain = '' then
    return null;
  end if;
  if char_length(v_domain) > 253
     or v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception 'TIENDA_DOMINIO_INVALIDO: el dominio no tiene una forma valida' using errcode = '22023';
  end if;
  return v_domain;
end;
$fn$;

/** Moneda activa del catálogo `currencies`, o error estable. */
create or replace function ebim.store_currency_or_fail(p_currency text)
returns char(3)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_code text := upper(btrim(coalesce(p_currency, '')));
begin
  if v_code !~ '^[A-Z]{3}$'
     or not exists (select 1 from public.currencies c where c.code = v_code and c.is_active) then
    raise exception 'MONEDA_NO_ADMITIDA: la moneda no esta activa en el catalogo' using errcode = '22023';
  end if;
  return v_code::char(3);
end;
$fn$;

/**
 * ¿Cambiar la moneda de esta tienda dejaría datos en la moneda anterior?
 *
 * Definer y cerrada: devuelve un booleano y nada más. Tiene que mirar pedidos,
 * listas de precio y catálogo aunque el rol de quien pregunta no los lea todos;
 * una respuesta calculada solo con lo visible diría «no está en uso» por error.
 */
create or replace function ebim.store_currency_in_use(p_store_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  -- Solo responde a quien administra ESA tienda: para cualquier otro, la
  -- pregunta «¿esta tienda tiene pedidos?» sería un oráculo sobre otro tenant.
  if not found
     or not ebim.has_role(v_store.organization_id, v_store.company_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: administrar tiendas exige rol owner o admin' using errcode = '42501';
  end if;
  return exists (select 1 from public.orders o where o.store_id = p_store_id)
      or exists (select 1 from public.price_lists pl where pl.store_id = p_store_id)
      or exists (select 1 from public.products p where p.store_id = p_store_id)
      or exists (select 1 from public.carts c where c.store_id = p_store_id);
end;
$fn$;

revoke all on function ebim.store_currency_in_use(uuid) from public, anon;
grant execute on function ebim.store_currency_in_use(uuid) to authenticated, service_role;

/** Lo que devuelven los tres comandos: la tienda tal como la ve el backoffice. */
create or replace function ebim.store_summary(p_store public.stores)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'id',              p_store.id,
    'organization_id', p_store.organization_id,
    'company_id',      p_store.company_id,
    'slug',            p_store.slug,
    'name',            p_store.name,
    'status',          p_store.status,
    'currency',        p_store.currency,
    'domain',          p_store.domain,
    'created_at',      p_store.created_at,
    'updated_at',      p_store.updated_at
  );
$fn$;

/**
 * Traduce una colisión de unicidad de `stores` a su código de negocio. El
 * índice que salta dice cuál de los dos nombres públicos ya está tomado.
 */
create or replace function ebim.raise_store_conflict(p_constraint text)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_constraint = 'stores_domain_key' then
    raise exception 'TIENDA_DOMINIO_DUPLICADO: ese dominio ya lo usa otra tienda' using errcode = '23505';
  end if;
  raise exception 'TIENDA_SLUG_DUPLICADO: esa direccion ya la usa otra tienda' using errcode = '23505';
end;
$fn$;

/** Carga una tienda de la sociedad ACTIVA y comprueba que se puede administrar. */
create or replace function ebim.managed_store(p_store_id uuid)
returns public.stores
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  -- Con los permisos de quien llama: una tienda de otro tenant ni se ve.
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'TIENDA_NO_ENCONTRADA: la tienda no existe o no es de tu cuenta' using errcode = '22023';
  end if;
  if v_store.company_id is distinct from ebim.active_company() then
    raise exception 'TIENDA_FUERA_DE_SOCIEDAD_ACTIVA: cambia a la sociedad de esta tienda para administrarla'
      using errcode = '42501';
  end if;
  perform ebim.assert_store_manager(v_store.organization_id, v_store.company_id);
  return v_store;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · Alta
-- ---------------------------------------------------------------------------
create or replace function public.create_store(
  p_slug     text,
  p_name     text,
  p_currency text,
  p_domain   text default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_org        uuid := ebim.org_id();
  v_company    uuid := ebim.active_company();
  v_name       text;
  v_slug       text;
  v_currency   char(3);
  v_domain     text;
  v_store      public.stores%rowtype;
  v_constraint text;
begin
  perform ebim.assert_store_manager(v_org, v_company);

  if not exists (
    select 1 from public.tenants t where t.organization_id = v_org and t.status = 'active'
  ) then
    raise exception 'TENANT_NO_ACTIVO: la cuenta no esta activa' using errcode = '42501';
  end if;

  v_name := ebim.store_name_or_fail(p_name);
  v_slug := ebim.store_slug_or_fail(p_slug);
  v_currency := ebim.store_currency_or_fail(p_currency);
  v_domain := ebim.store_domain_or_fail(p_domain);

  if v_domain is not null and not ebim.has_capability(v_org, v_company, 'content.white_label') then
    raise exception 'MODULO_NO_CONTRATADO: el dominio propio exige content.white_label' using errcode = '42501';
  end if;

  begin
    insert into public.stores (organization_id, company_id, slug, name, status, currency, domain)
    values (v_org, v_company, v_slug, v_name, 'draft', v_currency, v_domain)
    returning * into v_store;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform ebim.raise_store_conflict(v_constraint);
  end;

  -- 1:1 con la tienda, con los valores por defecto de la tabla. No se copia
  -- nada de otra tienda: marca, textos y reglas se configuran después.
  insert into public.store_settings (store_id, organization_id, company_id)
  values (v_store.id, v_org, v_company);

  return ebim.store_summary(v_store);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5 · Edición
--
-- Un parámetro NULL significa «no se toca». El dominio se quita con
-- `p_clear_domain`, porque NULL ya significa eso. La moneda solo cambia en una
-- tienda que todavía no tiene pedidos, listas de precio, carritos ni catálogo:
-- después, los importes guardados quedarían en una moneda que no es la suya.
-- ---------------------------------------------------------------------------
create or replace function public.update_store(
  p_store_id     uuid,
  p_name         text    default null,
  p_slug         text    default null,
  p_domain       text    default null,
  p_clear_domain boolean default false,
  p_currency     text    default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_store      public.stores%rowtype;
  v_name       text;
  v_slug       text;
  v_domain     text;
  v_currency   char(3);
  v_constraint text;
begin
  v_store := ebim.managed_store(p_store_id);

  v_name := case when p_name is null then v_store.name else ebim.store_name_or_fail(p_name) end;
  v_slug := case when p_slug is null then v_store.slug else ebim.store_slug_or_fail(p_slug) end;

  if coalesce(p_clear_domain, false) then
    v_domain := null;
  elsif p_domain is null then
    v_domain := v_store.domain;
  else
    v_domain := ebim.store_domain_or_fail(p_domain);
  end if;

  if v_domain is not null and v_domain is distinct from v_store.domain
     and not ebim.has_capability(v_store.organization_id, v_store.company_id, 'content.white_label') then
    raise exception 'MODULO_NO_CONTRATADO: el dominio propio exige content.white_label' using errcode = '42501';
  end if;

  v_currency := case when p_currency is null then v_store.currency else ebim.store_currency_or_fail(p_currency) end;
  if v_currency is distinct from v_store.currency and ebim.store_currency_in_use(v_store.id) then
    raise exception 'TIENDA_MONEDA_EN_USO: la tienda ya tiene catalogo, precios, carritos o pedidos en su moneda'
      using errcode = '22023';
  end if;

  begin
    update public.stores s
       set name = v_name, slug = v_slug, domain = v_domain, currency = v_currency
     where s.id = v_store.id
    returning * into v_store;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform ebim.raise_store_conflict(v_constraint);
  end;

  return ebim.store_summary(v_store);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6 · Estado
-- ---------------------------------------------------------------------------
create or replace function public.set_store_status(p_store_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  if p_status is null or p_status not in ('draft', 'active', 'suspended') then
    raise exception 'TIENDA_ESTADO_INVALIDO: el estado es draft, active o suspended' using errcode = '22023';
  end if;

  v_store := ebim.managed_store(p_store_id);

  update public.stores s
     set status = p_status::public.store_status
   where s.id = v_store.id
  returning * into v_store;

  return ebim.store_summary(v_store);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7 · Permisos
-- ---------------------------------------------------------------------------
revoke all on function ebim.store_name_or_fail(text) from public, anon;
revoke all on function ebim.store_slug_or_fail(text) from public, anon;
revoke all on function ebim.store_domain_or_fail(text) from public, anon;
revoke all on function ebim.store_currency_or_fail(text) from public, anon;
revoke all on function ebim.store_summary(public.stores) from public, anon;
revoke all on function ebim.raise_store_conflict(text) from public, anon;
revoke all on function ebim.managed_store(uuid) from public, anon;
grant execute on function ebim.store_name_or_fail(text) to authenticated, service_role;
grant execute on function ebim.store_slug_or_fail(text) to authenticated, service_role;
grant execute on function ebim.store_domain_or_fail(text) to authenticated, service_role;
grant execute on function ebim.store_currency_or_fail(text) to authenticated, service_role;
grant execute on function ebim.store_summary(public.stores) to authenticated, service_role;
grant execute on function ebim.raise_store_conflict(text) to authenticated, service_role;
grant execute on function ebim.managed_store(uuid) to authenticated, service_role;

revoke all on function public.create_store(text, text, text, text) from public, anon;
revoke all on function public.update_store(uuid, text, text, text, boolean, text) from public, anon;
revoke all on function public.set_store_status(uuid, text) from public, anon;
grant execute on function public.create_store(text, text, text, text) to authenticated, service_role;
grant execute on function public.update_store(uuid, text, text, text, boolean, text) to authenticated, service_role;
grant execute on function public.set_store_status(uuid, text) to authenticated, service_role;

comment on function public.create_store(text, text, text, text) is
  'Alta de una tienda adicional para la sociedad ACTIVA del JWT (owner/admin). Nace draft, con store_settings y canal por defecto.';
comment on function public.update_store(uuid, text, text, text, boolean, text) is
  'Edita nombre, slug, dominio y moneda de una tienda de la sociedad activa (owner/admin). NULL no toca; la moneda solo cambia sin datos.';
comment on function public.set_store_status(uuid, text) is
  'Cambia el estado de una tienda de la sociedad activa (owner/admin): draft, active o suspended. No hay borrado autoservicio.';
