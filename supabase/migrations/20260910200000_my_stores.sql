-- =============================================================================
-- public.my_stores — en que tiendas compra la persona que pregunta.
--
-- ## Por que hace falta
--
-- El guard del backoffice ya sabia mandar a un comprador a la vitrina, pero no
-- sabia A CUAL: usaba la tienda por defecto del DESPLIEGUE —el slug declarado
-- o la unica tienda activa del proyecto—. Con una sola tienda acierta por
-- casualidad; con dos, manda al comprador de una a la vitrina de la otra, o no
-- manda a nadie.
--
-- ## SIN ARGUMENTOS, como `my_business_accounts`
--
-- El vinculo entre la persona y su empresa lo resuelve la base contra
-- `business_account_users`. Aceptar un id de cuenta abriria justo la clase de
-- error que consiste en creerse el que manda el navegador: pedir la tienda «de
-- la cuenta X» para ver donde compra otro.
--
-- ## El camino: persona → cuenta B2B → sociedad → tiendas de esa sociedad
--
-- `business_accounts` no lleva `store_id` y no deberia: una cuenta es de un
-- CLIENTE de una sociedad, y esa sociedad puede tener varias tiendas. Asi que
-- la respuesta puede ser mas de una, y se devuelven todas: quien elige es la
-- persona, no una regla que adivine por ella.
--
-- Solo tiendas ACTIVAS. Una tienda en borrador no es un sitio al que mandar a
-- comprar.
-- =============================================================================
create or replace function public.my_stores()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name) order by name), '[]'::jsonb)
  from (
    -- `distinct`: dos cuentas B2B de la misma sociedad no duplican su tienda.
    select distinct s.slug, s.name
    from public.business_account_users u
    join public.business_accounts a on a.id = u.business_account_id
    join public.customers          c on c.id = a.customer_id
    join public.stores             s
      on s.organization_id = a.organization_id
     and s.company_id      = a.company_id
    where u.user_id = ebim.user_id()
      and u.status  = 'active'
      and a.is_active
      and c.is_active
      and s.status  = 'active'
  ) tiendas;
$fn$;

-- `anon` fuera: sin sesion no hay a quien responder, y la vitrina publica se
-- alcanza por su slug sin preguntarle nada a esta funcion.
revoke execute on function public.my_stores() from public, anon;
grant  execute on function public.my_stores() to authenticated, service_role;

comment on function public.my_stores() is
  'Tiendas donde compra el usuario autenticado. SIN parametros: el vinculo lo pone el servidor, nunca el navegador.';
