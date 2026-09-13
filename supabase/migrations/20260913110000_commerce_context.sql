-- =============================================================================
-- Hardening multi-commerce · H05-H06 — el contexto comercial de la sesión, para
-- PINTARLO.
--
-- ## El hueco
--
-- Un comprador de empresa veía el precio de su convenio en la ficha y no sabía
-- por qué, ni para quién estaba comprando: el nombre de su cuenta solo aparecía
-- dentro de «Tu cuenta». Y `my_business_accounts()` no sirve para decirlo en la
-- vitrina: no filtra por la sociedad de la tienda y ordena por nombre, mientras
-- que el precio lo decide `ebim.pricing_actor`, que SÍ filtra por sociedad y
-- elige la cuenta más antigua. Pintar la primera de esa lista podía nombrar una
-- empresa distinta de la que está fijando el precio.
--
-- ## La respuesta
--
-- `my_commerce_context(slug)` responde con la MISMA regla que `pricing_actor`
-- —cuenta activa, cliente activo, sociedad de la tienda, la más antigua— y
-- devuelve solo lo que hace falta para pintar:
--
--  · nombre y código de la cuenta y nombre del cliente;
--  · banderas de proceso (aprobación, orden de compra, tope, crédito, sedes),
--    que es de donde la vitrina deduce «comercio» o «empresa» sin nombres;
--  · `has_commercial_pricing`: si hay una lista ACTIVA y VIGENTE asignada a su
--    cliente o a su segmento en esta tienda. Un booleano: ni el id de la lista,
--    ni su código, ni un precio.
--
-- Solo lectura, sin parámetro de identidad y sin nada que el pipeline de precio
-- o de checkout consuma: esta función no puede cambiar lo que se cobra.
-- =============================================================================

create or replace function public.my_commerce_context(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user      uuid := ebim.user_id();
  v_store     public.stores%rowtype;
  v_account   public.business_accounts%rowtype;
  v_customer  public.customers%rowtype;
  v_member    public.business_account_users%rowtype;
  v_account_id uuid;
  v_accounts  integer;
  v_locations integer;
  v_pricing   boolean;
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

  -- La misma elección que `ebim.pricing_actor`: si esto y el precio discreparan,
  -- la vitrina nombraría una empresa y cobraría con el acuerdo de otra.
  select a.id into v_account_id
  from public.business_account_users u
  join public.business_accounts a on a.id = u.business_account_id
  join public.customers          c on c.id = a.customer_id
  where u.user_id = v_user
    and u.status  = 'active'
    and a.is_active
    and c.is_active
    and a.organization_id = v_store.organization_id
    and a.company_id      = v_store.company_id
    and c.organization_id = v_store.organization_id
    and c.company_id      = v_store.company_id
  order by a.created_at, a.id
  limit 1;

  if v_account_id is null then
    return null;
  end if;

  select a.* into v_account  from public.business_accounts a where a.id = v_account_id;
  select c.* into v_customer from public.customers c         where c.id = v_account.customer_id;
  select u.* into v_member   from public.business_account_users u
   where u.business_account_id = v_account_id and u.user_id = v_user;

  select count(*)::int into v_accounts
  from public.business_account_users u
  join public.business_accounts a on a.id = u.business_account_id
  join public.customers          c on c.id = a.customer_id
  where u.user_id = v_user and u.status = 'active' and a.is_active and c.is_active
    and a.organization_id = v_store.organization_id
    and a.company_id      = v_store.company_id;

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
  'Contexto comercial de la sesion en una tienda, para pintar: la cuenta que usa el motor de precios (misma regla que ebim.pricing_actor) y banderas de proceso. Sin precios ni ids de lista.';
