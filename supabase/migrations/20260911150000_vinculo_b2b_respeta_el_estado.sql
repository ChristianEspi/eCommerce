-- =============================================================================
-- Vincular a un comprador no puede ACTIVARLO por su cuenta.
--
-- ## El fallo, y por qué es de seguridad y no de detalle
--
-- `add_business_account_user` escribía `status = 'active'` siempre, ignorando
-- el estado que el formulario ofrece elegir. Y ese estado no es decorativo: el
-- portal del comprador exige `status = 'active'` para dejar entrar
-- (`shopper_portal`, 20260831140000). Así que marcar a alguien como «Invitado»
-- y darle acceso inmediato a comprar a nombre de la empresa eran la misma
-- acción — con una pantalla diciendo lo contrario.
--
-- Un desplegable que dice «Invitado» y concede acceso es peor que no tenerlo:
-- quien lo usa cree que ha dejado a esa persona en espera.
--
-- ## La corrección
--
-- El estado viaja como parámetro y por defecto es `invited`, que es el mismo
-- valor por defecto que la columna lleva desde que existe. Activar a alguien
-- pasa a ser una decisión explícita, que es lo que ya parecía en pantalla.
--
-- Se elimina la firma anterior para que no quede una puerta abierta que sigue
-- activando por su cuenta.
-- =============================================================================

drop function if exists public.add_business_account_user(uuid, text, public.business_role, numeric, uuid);

create or replace function public.add_business_account_user(
  p_account_id     uuid,
  p_email          text,
  p_role           public.business_role,
  p_spending_limit numeric              default null,
  p_location_id    uuid                 default null,
  p_status         public.member_status default 'invited'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_account public.business_accounts%rowtype;
  v_user    uuid;
  v_id      uuid;
begin
  if position('@' in v_email) < 2 then
    raise exception 'CORREO_INVALIDO: hace falta un correo' using errcode = '22023';
  end if;

  select * into v_account from public.business_accounts a where a.id = p_account_id;
  if not found then
    raise exception 'CUENTA_NO_ENCONTRADA: esa cuenta no existe' using errcode = '22023';
  end if;

  if not ebim.has_role(v_account.organization_id, v_account.company_id,
                       array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: hace falta rol owner o admin' using errcode = '42501';
  end if;

  if position('@ebim.pe' in v_email) > 0 then
    raise exception 'CORREO_DE_SUITE: un correo de la suite no compra a nombre de un cliente'
      using errcode = '42501';
  end if;

  v_user := ebim.auth_user_for_email(v_email);
  if v_user is null then
    raise exception 'SIN_CUENTA: ese correo todavia no tiene cuenta en el sistema'
      using errcode = '22023';
  end if;

  update public.business_account_users u
     set role = p_role, status = p_status, email = v_email,
         spending_limit = p_spending_limit, default_location_id = p_location_id
   where u.business_account_id = p_account_id
     and u.user_id = v_user
  returning u.id into v_id;

  if v_id is null then
    insert into public.business_account_users
      (organization_id, company_id, business_account_id, user_id, email, role,
       spending_limit, status, default_location_id, invited_by)
    values (v_account.organization_id, v_account.company_id, p_account_id, v_user,
            v_email, p_role, p_spending_limit, p_status, p_location_id, ebim.user_id())
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function
  public.add_business_account_user(uuid, text, public.business_role, numeric, uuid, public.member_status)
from public, anon;
grant execute on function
  public.add_business_account_user(uuid, text, public.business_role, numeric, uuid, public.member_status)
to authenticated, service_role;

comment on function
  public.add_business_account_user(uuid, text, public.business_role, numeric, uuid, public.member_status) is
  'Vincula a un comprador con una cuenta B2B por CORREO. El estado se respeta: «invitado» no da acceso al portal.';
