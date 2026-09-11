-- =============================================================================
-- Dar de alta por correo no puede DEGRADAR a un propietario.
--
-- ## El fallo, encontrado probando
--
-- `add_tenant_member` readmite a quien ya estaba: si la persona existe, le
-- pone el rol pedido y la deja activa. Eso es lo correcto para readmitir a
-- alguien revocado, y es un agujero para un `owner`: escribir el correo del
-- dueño de la cuenta y elegir «Administrador» lo degradaba en el acto.
--
-- Se vio en una prueba contra el proyecto real: la llamada respondió 200 y el
-- propietario pasó a administrador. Se restauró en el momento.
--
-- ## Por qué importa más de lo que parece
--
-- La función ya se negaba a OTORGAR `owner` —nace con el tenant, concederlo es
-- una operación de servidor—. Faltaba la otra mitad de la misma regla: si no se
-- concede desde la aplicación, tampoco se quita desde la aplicación. Media regla
-- es peor que ninguna, porque parece que protege.
--
-- Y el daño no es simétrico: degradar al único `owner` deja la cuenta sin nadie
-- que pueda borrar su tienda ni recuperar el rol, y recuperarlo exige entrar a
-- la base. Un desplegable de una pantalla no puede tener esa consecuencia.
--
-- ## La corrección
--
-- Si la fila que se encuentra ya es `owner`, se deja como está y se devuelve su
-- identificador. Ni se degrada ni se lanza un error: pedir «admin» para quien ya
-- puede más no es una equivocación que haya que castigar, es una petición que ya
-- está cumplida.
-- =============================================================================

create or replace function public.add_tenant_member(
  p_organization_id uuid,
  p_company_id      uuid,
  p_email           text,
  p_role            public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
  v_id    uuid;
  v_rol   public.app_role;
begin
  if position('@' in v_email) < 2 then
    raise exception 'CORREO_INVALIDO: hace falta un correo' using errcode = '22023';
  end if;

  if not ebim.has_role(p_organization_id, p_company_id,
                       array['owner','admin']::public.app_role[]) then
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
  where m.organization_id = p_organization_id
    and m.company_id      = p_company_id
    and m.user_id         = v_user;

  -- Ya es propietario: se devuelve tal cual. La otra mitad de «owner no se
  -- otorga desde la aplicacion» es que tampoco se quita desde la aplicacion.
  if v_rol = 'owner' then
    return v_id;
  end if;

  if v_id is not null then
    -- Readmitir a quien se revoco con el rol pedido: es lo que se queria hacer.
    update public.tenant_members m
       set role = p_role, status = 'active', email = v_email
     where m.id = v_id;
    return v_id;
  end if;

  insert into public.tenant_members
    (organization_id, company_id, user_id, email, role, status)
  values (p_organization_id, p_company_id, v_user, v_email, p_role, 'active')
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.add_tenant_member(uuid, uuid, text, public.app_role) is
  'Da acceso al backoffice por CORREO. No otorga owner y tampoco lo degrada: si no se concede desde la app, no se quita desde la app.';
