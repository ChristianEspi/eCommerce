-- =============================================================================
-- Hardening multi-commerce v2 · N01 — UNA sola cuenta B2B efectiva.
--
-- ## El fallo (hallazgo A1)
--
-- Había dos reglas para decidir «para qué empresa compra esta persona»:
--
--  · `ebim.pricing_actor(org, company)` —la que fija el PRECIO— filtraba por la
--    sociedad de la tienda y elegía la cuenta más antigua;
--  · el checkout —el que firma el PEDIDO— tomaba `rows[0]` de
--    `my_business_accounts()`, que ni filtra por sociedad y ordena por nombre.
--
-- Con dos cuentas, el carrito podía cotizar con el convenio de A y el pedido
-- salir a nombre de B (o fallar con `CUENTA_NO_APLICA` si la primera por nombre
-- era de otro tenant). `my_commerce_context` copiaba la primera regla, y copiar
-- una regla es la forma segura de que un día dejen de coincidir.
--
-- ## La respuesta
--
-- `ebim.effective_business_account(usuario, organización, sociedad)` es la
-- ÚNICA regla, y todos la preguntan:
--
--  · `ebim.pricing_actor`            (precio de toda cotización pública);
--  · `public.my_commerce_context`    (lo que pinta la barra de contexto);
--  · `public.my_effective_business_account_for_slug` (lo que resuelve el
--    checkout con el token del comprador y manda a `create_order`);
--  · `public.my_store_business_accounts` (el selector, que marca la efectiva).
--
-- La regla:
--
--  1. las cuentas VÁLIDAS del usuario en esa sociedad: vínculo `active`, cuenta
--     activa, cliente activo, y cuenta, cliente y vínculo de ESA organización y
--     sociedad;
--  2. si el usuario eligió una y sigue siendo válida → esa;
--  3. si no eligió, o lo que eligió dejó de ser válido (revocado, cuenta o
--     cliente desactivados) → la más antigua, igual que antes de esta migración.
--
-- El paso 3 es la compatibilidad: quien tiene una sola cuenta —todos los
-- usuarios de hoy— ve exactamente lo mismo que ayer, y una preferencia rota no
-- deja a nadie sin cuenta: cae a la regla determinista.
--
-- ## La preferencia no es una autoridad del navegador
--
-- `buyer_account_selections` guarda QUÉ cuenta eligió la persona en una
-- sociedad vendedora. No guarda precio, lista, segmento ni cliente: eso sigue
-- saliendo de la cuenta en cada consulta. No hay GRANT de tabla para `anon` ni
-- para `authenticated`; se escribe solo por `select_store_business_account`,
-- que valida el vínculo contra la sociedad de la tienda del slug antes de
-- guardar, y se lee solo a través de la regla de arriba, que la vuelve a
-- validar en cada lectura.
-- =============================================================================

create table public.buyer_account_selections (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null,
  company_id          uuid        not null,
  -- `sub` del JWT de quien eligió. Lo pone la función, nunca un parámetro.
  user_id             uuid        not null,
  business_account_id uuid        not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Una elección por persona y sociedad vendedora.
  constraint buyer_account_selections_user_company_key
    unique (user_id, organization_id, company_id),
  -- La cuenta elegida es de ESTA sociedad por construcción: la clave ajena lleva
  -- el tenant dentro, así que no se puede apuntar a una cuenta de otra.
  constraint buyer_account_selections_account_fk
    foreign key (business_account_id, organization_id, company_id)
    references public.business_accounts (id, organization_id, company_id)
    on delete cascade
);

create index buyer_account_selections_tenant_idx
  on public.buyer_account_selections (organization_id, company_id);
create index buyer_account_selections_account_idx
  on public.buyer_account_selections (business_account_id);

create trigger buyer_account_selections_updated_at
  before update on public.buyer_account_selections
  for each row execute function ebim.set_updated_at();

alter table public.buyer_account_selections enable row level security;
alter table public.buyer_account_selections force  row level security;

-- La única policy es de lectura de lo PROPIO y, a propósito, sin GRANT detrás:
-- hoy nadie del cliente lee la tabla (se llega por función). Si mañana alguien
-- concede SELECT, esta policy es el segundo cerrojo y no deja ver elecciones
-- ajenas.
create policy buyer_account_selections_select_own on public.buyer_account_selections
  for select to authenticated
  using (user_id = ebim.user_id());

revoke all on public.buyer_account_selections from public, anon, authenticated;
grant  all on public.buyer_account_selections to service_role;

comment on table public.buyer_account_selections is
  'Cuenta B2B que un usuario eligio para comprar en una sociedad vendedora. Solo se escribe por select_store_business_account; solo cuenta si sigue siendo valida (ebim.effective_business_account).';

-- ---------------------------------------------------------------------------
-- ebim.effective_business_account — LA regla.
--
-- Recibe el usuario como parámetro porque es interna: revocada de `anon` y
-- `authenticated`, la llaman funciones que ya sacaron el usuario del JWT. Así
-- la misma regla sirve a quien corre con la sesión (`pricing_actor`) y a quien
-- responde por ella (`my_effective_business_account_for_slug`).
-- ---------------------------------------------------------------------------
create or replace function ebim.effective_business_account(
  p_user_id         uuid,
  p_organization_id uuid,
  p_company_id      uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  with valid as (
    select a.id, a.created_at
    from public.business_account_users u
    join public.business_accounts a on a.id = u.business_account_id
    join public.customers          c on c.id = a.customer_id
    where p_user_id is not null
      and u.user_id = p_user_id
      and u.status  = 'active'
      and a.is_active
      and c.is_active
      and u.organization_id = p_organization_id
      and u.company_id      = p_company_id
      and a.organization_id = p_organization_id
      and a.company_id      = p_company_id
      and c.organization_id = p_organization_id
      and c.company_id      = p_company_id
  )
  select coalesce(
    -- La elegida, SOLO si sigue en el conjunto válido.
    (select v.id
       from public.buyer_account_selections s
       join valid v on v.id = s.business_account_id
      where s.user_id         = p_user_id
        and s.organization_id = p_organization_id
        and s.company_id      = p_company_id),
    -- Sin elección válida: la más antigua, de forma estable.
    (select v.id from valid v order by v.created_at, v.id limit 1)
  );
$fn$;

revoke execute on function ebim.effective_business_account(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function ebim.effective_business_account(uuid, uuid, uuid) to service_role;

comment on function ebim.effective_business_account(uuid, uuid, uuid) is
  'La cuenta B2B efectiva de un usuario en una sociedad: la elegida si sigue siendo valida, si no la activa mas antigua. Unica regla para precio, contexto, selector y checkout.';

-- ---------------------------------------------------------------------------
-- ebim.pricing_actor — ahora pregunta a la regla en vez de tener la suya.
-- Misma firma, mismo tipo de retorno, mismos permisos.
-- ---------------------------------------------------------------------------
create or replace function ebim.pricing_actor(
  p_organization_id uuid,
  p_company_id      uuid
)
returns public.customers
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.*
  from public.business_accounts a
  join public.customers c on c.id = a.customer_id
  where a.id = ebim.effective_business_account(ebim.user_id(), p_organization_id, p_company_id)
  limit 1;
$fn$;

revoke execute on function ebim.pricing_actor(uuid, uuid) from public, anon, authenticated;
grant  execute on function ebim.pricing_actor(uuid, uuid) to service_role;

comment on function ebim.pricing_actor(uuid, uuid) is
  'Ficha de cliente de la cuenta B2B efectiva (ebim.effective_business_account) del usuario con sesion en esta sociedad. La identidad sale del JWT y jamas de un parametro.';

-- ---------------------------------------------------------------------------
-- my_commerce_context — misma respuesta, cuenta sacada de la regla única.
-- ---------------------------------------------------------------------------
create or replace function public.my_commerce_context(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user       uuid := ebim.user_id();
  v_store      public.stores%rowtype;
  v_account    public.business_accounts%rowtype;
  v_customer   public.customers%rowtype;
  v_member     public.business_account_users%rowtype;
  v_account_id uuid;
  v_accounts   integer;
  v_locations  integer;
  v_pricing    boolean;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(p_store_slug)) and s.status = 'active';
  if not found then
    return null;
  end if;

  v_account_id := ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);
  if v_account_id is null then
    return null;
  end if;

  select a.* into v_account  from public.business_accounts a where a.id = v_account_id;
  select c.* into v_customer from public.customers c         where c.id = v_account.customer_id;
  select u.* into v_member   from public.business_account_users u
   where u.business_account_id = v_account_id and u.user_id = v_user and u.status = 'active'
   limit 1;

  select count(*)::int into v_accounts
  from public.business_account_users u
  join public.business_accounts a on a.id = u.business_account_id
  join public.customers          c on c.id = a.customer_id
  where u.user_id = v_user and u.status = 'active' and a.is_active and c.is_active
    and u.organization_id = v_store.organization_id
    and u.company_id      = v_store.company_id
    and a.organization_id = v_store.organization_id
    and a.company_id      = v_store.company_id
    and c.organization_id = v_store.organization_id
    and c.company_id      = v_store.company_id;

  select count(*)::int into v_locations
  from public.business_locations l
  where l.business_account_id = v_account.id and l.is_active;

  select exists (
    select 1
    from public.price_list_assignments pa
    join public.price_lists pl on pl.id = pa.price_list_id and pl.store_id = pa.store_id
    where pa.store_id = v_store.id
      and pa.is_active
      and pl.is_active
      and pl.currency = v_store.currency
      and pl.valid_from <= now()
      and (pl.valid_to is null or pl.valid_to > now())
      and (
           (pa.scope = 'customer' and pa.customer_id = v_customer.id)
        or (pa.scope = 'segment'  and v_customer.segment_id is not null and pa.segment_id = v_customer.segment_id)
      )
  ) into v_pricing;

  return jsonb_build_object(
    'account_name',            v_account.name,
    'account_code',            v_account.code,
    'customer_name',           v_customer.name,
    'requires_approval',       v_account.requires_approval,
    'purchase_order_required', v_account.purchase_order_required,
    'has_spending_limit',      v_member.spending_limit is not null,
    'has_credit_terms',        coalesce(v_account.credit_limit, 0) > 0 or v_account.payment_terms_days > 0,
    'locations_count',         v_locations,
    'has_commercial_pricing',  v_pricing,
    'accounts_in_store',       v_accounts
  );
end;
$fn$;

revoke execute on function public.my_commerce_context(text) from public, anon;
grant  execute on function public.my_commerce_context(text) to authenticated;

comment on function public.my_commerce_context(text) is
  'Contexto comercial de la sesion en una tienda, para pintar: la cuenta B2B efectiva (ebim.effective_business_account, la misma del precio y del pedido) y banderas de proceso. Sin precios ni ids de lista.';

-- ---------------------------------------------------------------------------
-- my_store_business_accounts — entre qué cuentas puede elegir, en ESTA tienda.
--
-- Solo las válidas de la sociedad de la tienda —nunca las de otro tenant— y
-- cuál es la efectiva ahora. El id de la cuenta viaja porque el selector lo
-- necesita para pedir el cambio; es una cuenta del propio usuario, la misma que
-- `my_business_accounts()` ya le devolvía.
-- ---------------------------------------------------------------------------
create or replace function public.my_store_business_accounts(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user      uuid := ebim.user_id();
  v_store     public.stores%rowtype;
  v_effective uuid;
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

  v_effective := ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'account_id',    a.id,
             'code',          a.code,
             'name',          a.name,
             'customer_name', c.name,
             'is_effective',  a.id = v_effective
           ) order by a.name, a.id)
    from public.business_account_users u
    join public.business_accounts a on a.id = u.business_account_id
    join public.customers          c on c.id = a.customer_id
    where u.user_id = v_user
      and u.status  = 'active'
      and a.is_active
      and c.is_active
      and u.organization_id = v_store.organization_id
      and u.company_id      = v_store.company_id
      and a.organization_id = v_store.organization_id
      and a.company_id      = v_store.company_id
      and c.organization_id = v_store.organization_id
      and c.company_id      = v_store.company_id
  ), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- my_effective_business_account_for_slug — la cuenta con la que compra.
--
-- La llama el checkout con el token del comprador (no con `service_role`: sin
-- sesión no habría a quién preguntar) y su `account_id` es el que llega a
-- `create_order`. Devuelve también rol y tope de la persona, que la etapa de
-- aprobación necesita, y si la cuenta exige orden de compra.
-- ---------------------------------------------------------------------------
create or replace function public.my_effective_business_account_for_slug(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user       uuid := ebim.user_id();
  v_store      public.stores%rowtype;
  v_account_id uuid;
  v_result     jsonb;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return null;
  end if;

  v_account_id := ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);
  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
           'account_id',              a.id,
           'code',                    a.code,
           'name',                    a.name,
           'customer_name',           c.name,
           'role',                    u.role,
           'spending_limit',          case when u.spending_limit is null then null
                                           else u.spending_limit::text end,
           'purchase_order_required', a.purchase_order_required)
    into v_result
  from public.business_accounts a
  join public.customers c on c.id = a.customer_id
  join public.business_account_users u
    on u.business_account_id = a.id and u.user_id = v_user and u.status = 'active'
  where a.id = v_account_id
  limit 1;

  return v_result;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- select_store_business_account — pedir comprar para otra de MIS cuentas.
--
-- Recibe un id de cuenta porque elegir entre cuentas es su propósito, y por eso
-- mismo no se fía de él: la cuenta tiene que estar en el conjunto válido del
-- usuario del JWT en la sociedad de la tienda del slug. Cualquier otra cosa
-- —cuenta de otro usuario, de otra sociedad, desactivada, vínculo revocado o
-- invitado, un uuid inventado— responde el MISMO error de dominio y no toca la
-- preferencia guardada.
-- ---------------------------------------------------------------------------
create or replace function public.select_store_business_account(
  p_store_slug text,
  p_account_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_store public.stores%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no existe o no esta activa'
      using errcode = '22023';
  end if;

  if p_account_id is null or not exists (
    select 1
    from public.business_account_users u
    join public.business_accounts a on a.id = u.business_account_id
    join public.customers          c on c.id = a.customer_id
    where a.id      = p_account_id
      and u.user_id = v_user
      and u.status  = 'active'
      and a.is_active
      and c.is_active
      and u.organization_id = v_store.organization_id
      and u.company_id      = v_store.company_id
      and a.organization_id = v_store.organization_id
      and a.company_id      = v_store.company_id
      and c.organization_id = v_store.organization_id
      and c.company_id      = v_store.company_id
  ) then
    raise exception 'CUENTA_NO_DISPONIBLE: esa cuenta no esta disponible para ti en esta tienda'
      using errcode = '22023';
  end if;

  insert into public.buyer_account_selections (organization_id, company_id, user_id, business_account_id)
  values (v_store.organization_id, v_store.company_id, v_user, p_account_id)
  on conflict (user_id, organization_id, company_id)
  do update set business_account_id = excluded.business_account_id;

  return public.my_effective_business_account_for_slug(v_store.slug);
end;
$fn$;

revoke execute on function public.my_store_business_accounts(text)             from public, anon;
revoke execute on function public.my_effective_business_account_for_slug(text) from public, anon;
revoke execute on function public.select_store_business_account(text, uuid)     from public, anon;

grant execute on function public.my_store_business_accounts(text)             to authenticated;
grant execute on function public.my_effective_business_account_for_slug(text) to authenticated;
grant execute on function public.select_store_business_account(text, uuid)     to authenticated;

comment on function public.my_store_business_accounts(text) is
  'Cuentas B2B validas del usuario con sesion en la sociedad de esta tienda, marcando la efectiva. Para el selector «Comprando para».';
comment on function public.my_effective_business_account_for_slug(text) is
  'Cuenta B2B efectiva del usuario con sesion en esta tienda (la misma del precio). La usa el checkout para firmar el pedido.';
comment on function public.select_store_business_account(text, uuid) is
  'Elige con que cuenta B2B propia se compra en esta tienda. Valida vinculo activo, cuenta y cliente activos y sociedad de la tienda; si no, CUENTA_NO_DISPONIBLE sin tocar nada.';
