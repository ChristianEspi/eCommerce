-- =============================================================================
-- Dar de alta a una persona por su CORREO, no por un uuid que nadie tiene.
--
-- ## El problema, tal y como se vive
--
-- Dos pantallas piden «Id de usuario» con la ayuda «el identificador que emite
-- el hub»: los usuarios del backoffice y los compradores de una cuenta B2B. Ese
-- identificador no se enseña en ninguna pantalla de esta aplicación, el hub no
-- está conectado todavía, y sin él las dos pantallas no sirven para nada. Se
-- pueden abrir, se ven bien y no se pueden usar, que es la peor clase de
-- pantalla: la que parece que funciona.
--
-- ## Por qué el front no puede resolverlo solo
--
-- El correo vive en `auth.users`, y `auth.users` no es legible para
-- `authenticated` — con razón: sería la lista de todas las personas del
-- proyecto. Así que la traducción correo → usuario tiene que ocurrir en el
-- servidor, con la autorización dentro.
--
-- ## Por qué NO se expone un «dame el id de este correo»
--
-- Porque sería un oráculo: cualquier administrador de cualquier tenant podría
-- preguntar, uno a uno, qué correos tienen cuenta en el proyecto. Eso es
-- enumeración de usuarios y no hace falta para nada.
--
-- Estas dos funciones hacen el TRABAJO COMPLETO —resolver y vincular— y no
-- devuelven el identificador. Quien las llama se entera de lo único que
-- necesita saber: si esa persona ya tiene cuenta o todavía no.
--
-- ## Lo que sigue sin poder hacerse, y se dice claro
--
-- **Invitar a alguien que todavía no tiene cuenta.** Hace falta enviar un
-- correo, y esta aplicación no envía correo todavía. Así que si el correo no
-- tiene cuenta, la función lo dice con un código propio —`SIN_CUENTA`— en vez
-- de fallar de forma opaca, y la pantalla puede explicar qué hacer: que la
-- persona entre y se registre, y después añadirla.
--
-- Inventar una fila «invitada» sin forma de avisar a nadie sería peor: quedaría
-- un acceso concedido a alguien que no se ha enterado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ebim.auth_user_for_email — la traducción, privada.
--
-- Vive en `ebim` y sin permiso para nadie: solo la llaman las dos funciones de
-- abajo, que ya han comprobado quién pregunta. Una función que traduce correos
-- a identificadores no puede estar al alcance de una llamada suelta.
-- ---------------------------------------------------------------------------
create or replace function ebim.auth_user_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select u.id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$fn$;

revoke execute on function ebim.auth_user_for_email(text)
  from public, anon, authenticated;

comment on function ebim.auth_user_for_email(text) is
  'Traduce un correo al usuario de Auth. Privada a proposito: expuesta seria un oraculo de enumeracion.';

-- ---------------------------------------------------------------------------
-- public.add_tenant_member — quién entra al backoffice.
--
-- Misma autorización que la policy que ya existe (`owner`/`admin` de ESE
-- tenant) y los mismos candados: `owner` no se otorga desde la app, y un correo
-- de la suite no es actor de negocio de un tenant.
-- ---------------------------------------------------------------------------
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
begin
  if position('@' in v_email) < 2 then
    raise exception 'CORREO_INVALIDO: hace falta un correo' using errcode = '22023';
  end if;

  if not ebim.has_role(p_organization_id, p_company_id,
                       array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: hace falta rol owner o admin' using errcode = '42501';
  end if;

  -- `owner` nace con el tenant (contrato §3.2). Concederlo es una operacion de
  -- servidor, no un desplegable de una pantalla.
  if p_role = 'owner' then
    raise exception 'ROL_NO_ASIGNABLE: owner no se otorga desde la aplicacion'
      using errcode = '42501';
  end if;

  v_user := ebim.auth_user_for_email(v_email);
  if v_user is null then
    raise exception 'SIN_CUENTA: ese correo todavia no tiene cuenta en el sistema'
      using errcode = '22023';
  end if;

  -- Ya estaba: se le devuelve el acceso con el rol pedido en vez de fallar por
  -- duplicado. Readmitir a quien se revoco es lo que se queria hacer.
  update public.tenant_members m
     set role = p_role, status = 'active', email = v_email
   where m.organization_id = p_organization_id
     and m.company_id      = p_company_id
     and m.user_id         = v_user
  returning m.id into v_id;

  if v_id is null then
    insert into public.tenant_members
      (organization_id, company_id, user_id, email, role, status)
    values (p_organization_id, p_company_id, v_user, v_email, p_role, 'active')
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function
  public.add_tenant_member(uuid, uuid, text, public.app_role) from public, anon;
grant execute on function
  public.add_tenant_member(uuid, uuid, text, public.app_role) to authenticated, service_role;

comment on function public.add_tenant_member(uuid, uuid, text, public.app_role) is
  'Da acceso al backoffice por CORREO: el servidor resuelve la identidad. No otorga owner y no devuelve identificadores.';

-- ---------------------------------------------------------------------------
-- public.add_business_account_user — quién compra a nombre de una cuenta B2B.
--
-- El vínculo lo decide el servidor, que es lo que la pantalla ya prometía:
-- «nadie accede declarando una cuenta». Hasta ahora esa promesa se cumplía
-- pidiendo el uuid a mano, que es cumplirla de la peor manera posible.
-- ---------------------------------------------------------------------------
create or replace function public.add_business_account_user(
  p_account_id     uuid,
  p_email          text,
  p_role           public.business_role,
  p_spending_limit numeric default null,
  p_location_id    uuid    default null
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

  -- El mismo candado que el CHECK de la tabla, comprobado antes para poder
  -- explicarlo: un operador de la suite comprando a nombre de un cliente no es
  -- un caso de uso, es un problema.
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
     set role = p_role, status = 'active', email = v_email,
         spending_limit = p_spending_limit, default_location_id = p_location_id
   where u.business_account_id = p_account_id
     and u.user_id = v_user
  returning u.id into v_id;

  if v_id is null then
    insert into public.business_account_users
      (organization_id, company_id, business_account_id, user_id, email, role,
       spending_limit, status, default_location_id, invited_by)
    values (v_account.organization_id, v_account.company_id, p_account_id, v_user,
            v_email, p_role, p_spending_limit, 'active', p_location_id, ebim.user_id())
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function
  public.add_business_account_user(uuid, text, public.business_role, numeric, uuid)
from public, anon;
grant execute on function
  public.add_business_account_user(uuid, text, public.business_role, numeric, uuid)
to authenticated, service_role;

comment on function public.add_business_account_user(uuid, text, public.business_role, numeric, uuid) is
  'Vincula a un comprador con una cuenta B2B por CORREO. El vinculo lo decide el servidor, como la pantalla promete.';
