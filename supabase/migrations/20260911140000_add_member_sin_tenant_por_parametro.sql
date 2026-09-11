-- =============================================================================
-- El tenant se toma del TOKEN, no del cuerpo de la petición.
--
-- ## Qué se rompió y quién lo cazó
--
-- `add_tenant_member` nació con `p_organization_id` y `p_company_id` como
-- parámetros. La autorización estaba dentro —comprobaba `has_role` sobre lo que
-- le pasaran— así que «funcionaba». Y aun así viola una regla del proyecto que
-- no admite matices, heredada de un hallazgo real (esupplier-030):
--
--   «la ORGANIZACIÓN nunca llega por parámetro a algo que alcance el cliente»
--
-- Lo cazó `security-baseline.test.ts`, que recorre el catálogo de funciones de
-- Postgres buscando exactamente este par: un parámetro de tenant en algo que
-- `authenticated` puede ejecutar.
--
-- ## Por qué la regla es más estricta que «valido dentro»
--
-- Porque la validación de dentro es una línea que alguien puede mover, y la
-- firma es un contrato que se lee de un vistazo. Mientras la organización sea un
-- argumento, cada revisión futura tiene que volver a comprobar que sigue
-- validándose; si no es un argumento, no hay nada que comprobar. La regla no
-- desconfía de esta función: desconfía de la siguiente.
--
-- Y hay un motivo práctico: `active_company` del JWT es lo que el usuario tiene
-- elegido en la pantalla. Aceptarlo por parámetro permite pedir el alta en una
-- sociedad distinta de la que se está mirando, que es una discrepancia entre lo
-- que se ve y lo que se hace.
--
-- ## Qué cambia
--
-- La firma pierde los dos parámetros. Se derivan de los claims, y la comprobación
-- de rol se queda igual. La versión anterior se elimina para que no quede una
-- puerta antigua abierta con la firma vieja.
-- =============================================================================

drop function if exists public.add_tenant_member(uuid, uuid, text, public.app_role);

create or replace function public.add_tenant_member(
  p_email text,
  p_role  public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_user    uuid;
  v_id      uuid;
  v_rol     public.app_role;
begin
  if position('@' in v_email) < 2 then
    raise exception 'CORREO_INVALIDO: hace falta un correo' using errcode = '22023';
  end if;

  if v_org is null or v_company is null then
    raise exception 'SIN_SOCIEDAD: la sesion no tiene sociedad activa' using errcode = '42501';
  end if;

  if not ebim.has_role(v_org, v_company, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: hace falta rol owner o admin' using errcode = '42501';
  end if;

  if p_role = 'owner' then
    raise exception 'ROL_NO_ASIGNABLE: owner no se otorga desde la aplicacion'
      using errcode = '42501';
  end if;

  v_user := ebim.auth_user_for_email(v_email);
  if v_user is null then
    raise exception 'SIN_CUENTA: ese correo todavia no tiene cuenta en el sistema'
      using errcode = '22023';
  end if;

  select m.id, m.role into v_id, v_rol
  from public.tenant_members m
  where m.organization_id = v_org
    and m.company_id      = v_company
    and m.user_id         = v_user;

  -- Ya es propietario: se devuelve tal cual. La otra mitad de «owner no se
  -- otorga desde la aplicacion» es que tampoco se quita desde la aplicacion.
  if v_rol = 'owner' then
    return v_id;
  end if;

  if v_id is not null then
    update public.tenant_members m
       set role = p_role, status = 'active', email = v_email
     where m.id = v_id;
    return v_id;
  end if;

  insert into public.tenant_members
    (organization_id, company_id, user_id, email, role, status)
  values (v_org, v_company, v_user, v_email, p_role, 'active')
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.add_tenant_member(text, public.app_role) from public, anon;
grant  execute on function public.add_tenant_member(text, public.app_role)
  to authenticated, service_role;

comment on function public.add_tenant_member(text, public.app_role) is
  'Da acceso al backoffice por CORREO a la sociedad ACTIVA del token. No acepta tenant por parametro, no otorga owner y tampoco lo degrada.';
