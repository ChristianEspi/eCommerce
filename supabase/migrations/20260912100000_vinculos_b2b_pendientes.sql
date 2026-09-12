-- =============================================================================
-- public.my_pending_business_accounts — a qué empresa me vincularon y aún no me
-- activaron.
--
-- ## El caso que lo motiva
--
-- Una persona vinculada a una cuenta B2B como «Invitado» entraba a la tienda y
-- leía «Tu usuario no está vinculado a ninguna empresa». Era falso: sí lo
-- estaba, pendiente de activación. `my_business_accounts` solo devuelve los
-- vínculos ACTIVOS —y eso es correcto, porque son los que dan acceso a comprar—,
-- así que la pantalla no tenía forma de distinguir «nadie te vinculó» de «te
-- vincularon y falta un paso». Quien lo leía no sabía que tenía que pedir la
-- activación.
--
-- ## Lo que devuelve, y lo que no
--
-- Solo el NOMBRE de la cuenta y cuándo se creó el vínculo. Es información sobre
-- la propia persona: le dice quién la invitó. No devuelve límites, sucursales,
-- direcciones ni ids internos, porque un vínculo pendiente no da derecho a ver
-- nada de la empresa todavía.
--
-- SIN PARÁMETROS, como `my_business_accounts`: la identidad sale del token.
-- =============================================================================

create or replace function public.my_pending_business_accounts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    jsonb_agg(jsonb_build_object('name', a.name, 'invited_at', u.created_at)
              order by a.name),
    '[]'::jsonb)
  from public.business_account_users u
  join public.business_accounts a on a.id = u.business_account_id
  join public.customers        c on c.id = a.customer_id
  where u.user_id = ebim.user_id()
    and u.status  = 'invited'
    and a.is_active
    and c.is_active;
$fn$;

revoke execute on function public.my_pending_business_accounts() from public, anon;
grant  execute on function public.my_pending_business_accounts() to authenticated;

comment on function public.my_pending_business_accounts() is
  'Nombres de las cuentas B2B donde el usuario está vinculado como invitado. Solo el nombre: un vínculo pendiente no da acceso a nada más.';
