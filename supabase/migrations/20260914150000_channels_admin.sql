-- =============================================================================
-- Cierre · item 7 · Administracion de canales de venta.
--
-- ## El hueco que cierra
--
-- `channels` y `product_channels` (20260827130000) llevan desde P10 completos y
-- probados, pero sin superficie: el backoffice solo los leia para rellenar un
-- desplegable de precios. Dar de alta el canal B2B o el de colaboradores
-- exigia SQL a mano, y cambiar el canal por defecto no tenia camino seguro.
--
-- ## Lo que anade
--
--  · `channel_set_default(channel)` — cambia el canal por defecto de la tienda
--    en UNA transaccion: quita la marca al anterior y se la pone al nuevo.
--  · `ebim.guard_channel_write` — el trigger que impide, a quien habla por
--    PostgREST, dejar la tienda sin canal por defecto utilizable.
--  · `channel_catalog_summary(store)` — cuantos productos tiene cada canal
--    declarados de forma explicita (cero = vende todo el catalogo).
--
-- ## Por que el canal por defecto tiene que ser PUBLICO y ACTIVO
--
-- No es una preferencia de esta pantalla: `ebim.public_channel` —la regla que
-- usan el carrito, el checkout y el precio de la vitrina— exige un canal por
-- defecto activo y que NO pida sesion, y si no lo encuentra la vitrina deja de
-- vender (`CANAL_NO_DISPONIBLE` / `CANAL_NO_PUBLICO`). Permitir aqui un canal
-- por defecto B2B o inactivo seria apagar la tienda publica desde un
-- interruptor de configuracion.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ebim.guard_channel_write — lo que un miembro NO puede hacer por PostgREST.
--
-- Solo mira al rol `authenticated`, y es a proposito:
--  · las operaciones de servidor (`service_role`, migraciones, la purga de la
--    demo) son de confianza y tienen sus propios motivos para tocar canales;
--  · dentro de `channel_set_default`, que es SECURITY DEFINER, el rol efectivo
--    es el dueno de la funcion, asi que el trigger no le estorba — y la funcion
--    comprueba por su cuenta las mismas reglas;
--  · el borrado en cascada de una tienda lo ejecuta Postgres con el dueno de la
--    tabla, asi que tampoco queda bloqueado.
--
-- Las policies de 130000 ya deciden QUIEN escribe (owner/admin del tenant);
-- esto decide QUE escritura deja la tienda rota aunque la haga quien puede.
-- ---------------------------------------------------------------------------
create or replace function ebim.guard_channel_write()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.is_default then
      raise exception 'CANAL_POR_DEFECTO_NO_BORRABLE: el canal por defecto no se puede borrar; elige otro por defecto primero'
        using errcode = '22023';
    end if;
    return old;
  end if;

  -- Mover un canal de tienda o de tenant romperia los pedidos que ya entraron
  -- por el (`orders_channel_fk`) y la visibilidad declarada del catalogo.
  if new.store_id is distinct from old.store_id
     or new.organization_id is distinct from old.organization_id
     or new.company_id is distinct from old.company_id then
    raise exception 'CANAL_CAMPO_INMUTABLE: la tienda y el tenant de un canal no cambian'
      using errcode = '22023';
  end if;

  -- La marca de defecto solo se mueve con `channel_set_default`: a mano, quitar
  -- la del anterior y poner la del nuevo son DOS escrituras, y entre una y otra
  -- la vitrina no tiene por donde vender.
  if new.is_default is distinct from old.is_default then
    raise exception 'CANAL_DEFECTO_SOLO_POR_FUNCION: el canal por defecto se cambia con channel_set_default'
      using errcode = '22023';
  end if;

  if old.is_default and not new.is_active then
    raise exception 'CANAL_POR_DEFECTO_NO_DESACTIVABLE: el canal por defecto no se puede desactivar; elige otro por defecto primero'
      using errcode = '22023';
  end if;

  if old.is_default and new.requires_auth then
    raise exception 'CANAL_POR_DEFECTO_PUBLICO: el canal por defecto tiene que ser B2C, sin sesion'
      using errcode = '22023';
  end if;

  return new;
end;
$fn$;

revoke execute on function ebim.guard_channel_write() from public, anon, authenticated;

drop trigger if exists channels_guard_write on public.channels;
create trigger channels_guard_write
  before update or delete on public.channels
  for each row execute function ebim.guard_channel_write();

-- ---------------------------------------------------------------------------
-- public.channel_set_default — el cambio de canal por defecto, atomico.
--
-- SECURITY DEFINER porque tiene que escribir las DOS filas en la misma
-- transaccion saltandose el trigger de arriba, que se lo prohibe a
-- `authenticated`. La autorizacion va dentro y sale del JWT:
--  · owner/admin de la sociedad del canal (`ebim.has_role`, que exige claims
--    Y membresia activa);
--  · un canal que no existe y uno de otro tenant responden el MISMO error, para
--    que la funcion no sirva de oraculo de uuids ajenos.
--
-- Idempotente: pedir por defecto el que ya lo es devuelve `changed: false` sin
-- escribir nada.
--
-- Concurrencia: se bloquean TODOS los canales de la tienda antes de mirar. Dos
-- administradores que cambian el defecto a la vez se ordenan; sin el bloqueo,
-- los dos leerian el mismo anterior y el indice unico parcial haria fallar a
-- uno con un error de restriccion en vez de un resultado.
-- ---------------------------------------------------------------------------
create or replace function public.channel_set_default(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel  public.channels%rowtype;
  v_previous uuid;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta una sesion' using errcode = '42501';
  end if;

  select * into v_channel from public.channels c where c.id = p_channel_id;

  if not found
     or not ebim.has_role(v_channel.organization_id, v_channel.company_id,
                          array['owner','admin']::public.app_role[]) then
    raise exception 'CANAL_NO_ENCONTRADO: ese canal no esta disponible' using errcode = '42501';
  end if;

  perform 1 from public.channels c where c.store_id = v_channel.store_id for update;

  -- Releer DESPUES del bloqueo: lo leido antes puede haber cambiado mientras se
  -- esperaba al otro administrador.
  select * into v_channel from public.channels c where c.id = p_channel_id;

  if not v_channel.is_active then
    raise exception 'CANAL_INACTIVO: un canal inactivo no puede ser el canal por defecto'
      using errcode = '22023';
  end if;

  if v_channel.requires_auth then
    raise exception 'CANAL_POR_DEFECTO_PUBLICO: el canal por defecto tiene que ser B2C, sin sesion'
      using errcode = '22023';
  end if;

  if v_channel.is_default then
    return jsonb_build_object(
      'channel_id', v_channel.id,
      'previous_default_id', v_channel.id,
      'changed', false);
  end if;

  select c.id into v_previous
  from public.channels c
  where c.store_id = v_channel.store_id and c.is_default;

  -- El orden importa: el indice `channels_one_default` se comprueba por
  -- sentencia, asi que primero se quita y despues se pone.
  update public.channels
     set is_default = false
   where store_id = v_channel.store_id
     and is_default;

  update public.channels
     set is_default = true
   where id = v_channel.id;

  return jsonb_build_object(
    'channel_id', v_channel.id,
    'previous_default_id', v_previous,
    'changed', true);
end;
$fn$;

revoke execute on function public.channel_set_default(uuid) from public, anon;
grant  execute on function public.channel_set_default(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.channel_catalog_summary — cuanto catalogo tiene declarado cada canal.
--
-- SECURITY INVOKER: la RLS de `channels` y `product_channels` decide que se ve,
-- igual que si se consultaran las tablas. Existe para no traerse al navegador
-- una fila por producto y canal solo para contarlas.
--
-- `product_count = 0` NO significa canal vacio: significa que el canal vende
-- TODO el catalogo publicado de la tienda, que es la regla de `create_order`.
-- ---------------------------------------------------------------------------
create or replace function public.channel_catalog_summary(p_store uuid)
returns table (channel_id uuid, product_count bigint)
language sql
stable
set search_path = ''
as $fn$
  select c.id, count(pc.id)
  from public.channels c
  left join public.product_channels pc on pc.channel_id = c.id
  where c.store_id = p_store
  group by c.id;
$fn$;

revoke execute on function public.channel_catalog_summary(uuid) from public, anon;
grant  execute on function public.channel_catalog_summary(uuid) to authenticated, service_role;

comment on function public.channel_set_default(uuid) is
  'Cambia el canal por defecto de la tienda en una transaccion. Solo owner/admin del tenant del canal; el nuevo debe estar activo y ser B2C. Idempotente.';
comment on function public.channel_catalog_summary(uuid) is
  'Productos declarados por canal. Cero = el canal vende todo el catalogo. Security INVOKER: manda la RLS.';
comment on function ebim.guard_channel_write() is
  'Impide a authenticated dejar la tienda sin canal por defecto utilizable (desactivar, privatizar, borrar o mover la marca a mano).';
