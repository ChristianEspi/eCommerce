-- =============================================================================
-- Culqi con las llaves DE CADA TIENDA (2026-11-13).
--
-- Hasta hoy el cobro con tarjeta leía UNA llave secreta del despliegue
-- (`EBIM_PAYMENT_SECRET_CULQI`) y UNA pública del bundle (`VITE_CULQI_PUBLIC_KEY`).
-- En una app multitenant eso significa que todos los comercios cobrarían en la
-- MISMA cuenta Culqi: la de la plataforma. Cada comercio tiene su contrato con
-- Culqi y su dinero tiene que caer en su cuenta.
--
-- Las llaves pasan a ser datos del medio de pago, configurables desde
-- Pagos → Medios de pago del backoffice:
--
--   · `checkout_public_key` (pk_test_… / pk_live_…) — PÚBLICA por diseño: Culqi
--     la publica en el navegador para tokenizar la tarjeta. Columna propia y
--     validada (no un campo libre de `public_config`) para poder dársela a
--     `anon` sin darle el resto de la configuración.
--   · la llave SECRETA (sk_test_… / sk_live_…) — en Supabase Vault, cifrada.
--     `ebim.payment_method_secrets` solo apunta a su id. La escribe
--     `payment_method_set_secret()` (owner/admin) y la descifra ÚNICAMENTE
--     `payment_secret_for_intent()`, que solo puede ejecutar `service_role`
--     (la función de checkout). El navegador la escribe una vez y no la vuelve
--     a ver: lo que sí ve es una pista (`sk_live_…a1b2`) para saber cuál puso.
--
-- Mismo patrón que la credencial de las fuentes de lectura
-- (20261112120000_connector_sources.sql).
--
-- ## Lo que la base impide
--
--   · Pegar una llave secreta en el campo público (formato `pk_` obligatorio).
--   · Mezclar entornos: una pública de pruebas con una secreta de producción
--     cobra en un sitio y tokeniza en otro, y el error sale en la cara del
--     comprador. CHECK sobre la pista, que lleva el prefijo del entorno.
--   · Que una sesión marque «llave configurada» sin configurarla: esas tres
--     columnas solo las escribe la función, un trigger devuelve las de antes.
--   · Que cambiar de pasarela deje viva la llave de la anterior: se borra.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Culqi en el catálogo de pasarelas (antes solo lo daba de alta el SQL de
--     datos de la demo, `supabase/culqi-metodo-pago.sql`). Cobra y devuelve;
--     no anula sin cobrar.
-- ---------------------------------------------------------------------------
insert into public.integration_providers (code, kind, name, capabilities, is_active)
values ('culqi', 'payment', 'Culqi', array['payment.authorize', 'payment.capture', 'payment.refund'], true)
on conflict (code, kind) do update
  set name = excluded.name, capabilities = excluded.capabilities, is_active = true;

-- ---------------------------------------------------------------------------
-- 1 · Columnas del medio de pago
-- ---------------------------------------------------------------------------
alter table public.payment_methods
  add column if not exists checkout_public_key text,
  add column if not exists has_secret          boolean not null default false,
  add column if not exists secret_hint         text,
  add column if not exists secret_set_at       timestamptz;

alter table public.payment_methods drop constraint if exists payment_methods_public_key_fmt;
alter table public.payment_methods add constraint payment_methods_public_key_fmt check (
  checkout_public_key is null
  or (provider_code = 'culqi' and checkout_public_key ~ '^pk_(test|live)_[A-Za-z0-9]{8,80}$')
);

alter table public.payment_methods drop constraint if exists payment_methods_keys_same_env;
alter table public.payment_methods add constraint payment_methods_keys_same_env check (
  checkout_public_key is null
  or secret_hint is null
  or split_part(checkout_public_key, '_', 2) = split_part(secret_hint, '_', 2)
);

comment on column public.payment_methods.checkout_public_key is
  'Llave PUBLICA de la pasarela (Culqi: pk_test_/pk_live_). La lee la vitrina para tokenizar la tarjeta en el navegador.';
comment on column public.payment_methods.has_secret is
  'Hay llave secreta en Vault para este medio. Solo la escribe payment_method_set_secret().';
comment on column public.payment_methods.secret_hint is
  'Pista de la llave secreta (sk_live_…a1b2): para reconocerla, nunca para usarla.';

-- La vitrina (anon) lee la llave pública. Nada más de lo nuevo.
grant select (checkout_public_key) on public.payment_methods to anon;

-- ---------------------------------------------------------------------------
-- 2 · Puntero al secreto (esquema privado, sin GRANT para nadie)
-- ---------------------------------------------------------------------------
create table if not exists ebim.payment_method_secrets (
  payment_method_id uuid        primary key references public.payment_methods (id) on delete cascade,
  vault_secret_id   uuid        not null,
  updated_at        timestamptz not null default now()
);
revoke all on ebim.payment_method_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Triggers: columnas protegidas y limpieza del secreto
-- ---------------------------------------------------------------------------
create or replace function ebim.payment_method_guard_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vault uuid;
begin
  -- Cambiar de pasarela invalida las llaves de la anterior.
  if new.provider_code is distinct from old.provider_code then
    select s.vault_secret_id into v_vault from ebim.payment_method_secrets s where s.payment_method_id = old.id;
    if v_vault is not null then
      delete from vault.secrets where id = v_vault;
      delete from ebim.payment_method_secrets where payment_method_id = old.id;
    end if;
    -- La pública solo se conserva si llega NUEVA en este mismo guardado
    -- (pasar a Culqi y pegar su llave es un solo «Guardar»).
    if new.checkout_public_key is not distinct from old.checkout_public_key then
      new.checkout_public_key := null;
    end if;
    new.has_secret    := false;
    new.secret_hint   := null;
    new.secret_set_at := null;
    return new;
  end if;

  -- Fuera de payment_method_set_secret() estas columnas no se mueven.
  if coalesce(current_setting('ebim.payment_secret_write', true), '') <> 'on' then
    new.has_secret    := old.has_secret;
    new.secret_hint   := old.secret_hint;
    new.secret_set_at := old.secret_set_at;
  end if;
  return new;
end;
$fn$;
revoke execute on function ebim.payment_method_guard_secret() from public, anon, authenticated;

drop trigger if exists payment_methods_guard_secret on public.payment_methods;
create trigger payment_methods_guard_secret
  before update on public.payment_methods
  for each row execute function ebim.payment_method_guard_secret();

-- Un medio nuevo nace sin secreto, diga lo que diga el insert.
create or replace function ebim.payment_method_new_without_secret()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.has_secret    := false;
  new.secret_hint   := null;
  new.secret_set_at := null;
  return new;
end;
$fn$;

drop trigger if exists payment_methods_new_without_secret on public.payment_methods;
create trigger payment_methods_new_without_secret
  before insert on public.payment_methods
  for each row execute function ebim.payment_method_new_without_secret();

-- Al borrar el medio, su secreto sale de Vault (no se deja huérfano).
create or replace function ebim.payment_method_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vault uuid;
begin
  select s.vault_secret_id into v_vault from ebim.payment_method_secrets s where s.payment_method_id = old.id;
  if v_vault is not null then
    delete from vault.secrets where id = v_vault;
  end if;
  return old;
end;
$fn$;
revoke execute on function ebim.payment_method_drop_secret() from public, anon, authenticated;

drop trigger if exists payment_methods_drop_secret on public.payment_methods;
create trigger payment_methods_drop_secret
  before delete on public.payment_methods
  for each row execute function ebim.payment_method_drop_secret();

-- ---------------------------------------------------------------------------
-- 4 · Guardar (o quitar, con vacío) la llave secreta — backoffice
-- ---------------------------------------------------------------------------
create or replace function public.payment_method_set_secret(p_method_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_method public.payment_methods%rowtype;
  v_vault  uuid;
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
  v_hint   text;
begin
  select * into v_method from public.payment_methods m where m.id = p_method_id;
  if not found or not ebim.can_access(v_method.organization_id, v_method.company_id) then
    raise exception 'MEDIO_DE_PAGO_NO_ENCONTRADO: %', p_method_id using errcode = '22023';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no configura el cobro de un tenant'
      using errcode = '42501';
  end if;
  if not ebim.has_role(v_method.organization_id, v_method.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: las llaves de la pasarela las configura el propietario o un administrador'
      using errcode = '42501';
  end if;
  if v_method.provider_code is null then
    raise exception 'SIN_PASARELA: un medio sin pasarela no tiene llaves' using errcode = '22023';
  end if;

  select s.vault_secret_id into v_vault from ebim.payment_method_secrets s where s.payment_method_id = p_method_id;
  perform set_config('ebim.payment_secret_write', 'on', true);

  if v_secret is null then
    if v_vault is not null then
      delete from vault.secrets where id = v_vault;
      delete from ebim.payment_method_secrets where payment_method_id = p_method_id;
    end if;
    update public.payment_methods
       set has_secret = false, secret_hint = null, secret_set_at = null
     where id = p_method_id;
    perform set_config('ebim.payment_secret_write', '', true);
    return jsonb_build_object('has_secret', false, 'secret_hint', null);
  end if;

  if v_method.provider_code = 'culqi' and v_secret !~ '^sk_(test|live)_[A-Za-z0-9]{8,80}$' then
    raise exception 'LLAVE_NO_VALIDA: la llave secreta de Culqi empieza por sk_test_ o sk_live_'
      using errcode = '22023';
  end if;
  if char_length(v_secret) > 400 then
    raise exception 'LLAVE_NO_VALIDA: la llave es demasiado larga' using errcode = '22023';
  end if;

  -- «sk_live_…a1b2»: el entorno y los cuatro últimos, lo justo para reconocerla.
  v_hint := coalesce(substring(v_secret from '^(sk_(?:test|live)_)'), left(v_secret, 3)) || '…' || right(v_secret, 4);

  if v_method.checkout_public_key is not null
     and split_part(v_method.checkout_public_key, '_', 2) <> split_part(v_hint, '_', 2) then
    raise exception 'LLAVES_DE_DISTINTO_ENTORNO: la llave pública y la secreta deben ser las dos de pruebas o las dos de producción'
      using errcode = '22023';
  end if;

  if v_vault is null then
    v_vault := vault.create_secret(v_secret, 'payment_method_' || p_method_id::text,
                                   'Llave secreta de la pasarela del medio de pago ' || p_method_id::text);
    insert into ebim.payment_method_secrets (payment_method_id, vault_secret_id) values (p_method_id, v_vault);
  else
    perform vault.update_secret(v_vault, v_secret);
    update ebim.payment_method_secrets set updated_at = now() where payment_method_id = p_method_id;
  end if;

  update public.payment_methods
     set has_secret = true, secret_hint = v_hint, secret_set_at = now()
   where id = p_method_id;
  perform set_config('ebim.payment_secret_write', '', true);

  return jsonb_build_object('has_secret', true, 'secret_hint', v_hint);
end;
$fn$;
revoke execute on function public.payment_method_set_secret(uuid, text) from public, anon;
grant  execute on function public.payment_method_set_secret(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Leer la llave para cobrar — SOLO la función de checkout (service_role)
-- ---------------------------------------------------------------------------
create or replace function public.payment_secret_for_intent(p_intent_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_vault  uuid;
  v_secret text;
begin
  select s.vault_secret_id into v_vault
    from public.payment_intents i
    join ebim.payment_method_secrets s on s.payment_method_id = i.payment_method_id
   where i.id = p_intent_id;
  if v_vault is null then return null; end if;
  select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.id = v_vault;
  return v_secret;
end;
$fn$;
revoke execute on function public.payment_secret_for_intent(uuid) from public, anon, authenticated;
grant  execute on function public.payment_secret_for_intent(uuid) to service_role;

comment on function public.payment_secret_for_intent(uuid) is
  'Llave secreta de la pasarela del medio de ESE intento. Solo service_role (función checkout): nunca llega al navegador.';

-- ---------------------------------------------------------------------------
-- 6 · La vitrina ve la llave pública del medio
-- ---------------------------------------------------------------------------
create or replace view public.public_payment_methods
with (security_invoker = on) as
select
  m.id       as payment_method_id,
  m.store_id,
  m.code,
  m.kind,
  m.display_name,
  m.position,
  m.instructions,
  m.checkout_public_key
from public.payment_methods m;

revoke all on public.public_payment_methods from public;
grant select on public.public_payment_methods to anon, authenticated, service_role;

comment on view public.public_payment_methods is
  'Medios de pago publicables de una tienda activa. Sin proveedor, sin config y sin modo de captura; solo la llave PUBLICA de la pasarela, que es publicable por diseño.';
