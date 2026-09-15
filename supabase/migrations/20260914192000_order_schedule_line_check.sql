-- =============================================================================
-- Cierre · pedidos programados — decir QUÉ línea no se puede programar y POR QUÉ.
--
-- ## Lo que pasaba
--
-- Probando en DEV, «Programar este pedido» respondía «Algún producto ya no se
-- puede programar» sin decir cuál. La causa real: el cliente del comprador tiene
-- asignado un surtido de LISTA PERMITIDA con dos productos, y los cuatro del
-- carrito estaban fuera. `save_my_order_schedule` (20260914130000) paraba en la
-- primera línea mala con un código que mezclaba cinco motivos distintos
-- (`PRODUCTO_NO_DISPONIBLE` para no publicado, variante, canal y moneda) y la
-- pantalla no tenía con qué avisar antes.
--
-- ## Lo que añade
--
--  1. `ebim.order_schedule_line_issue(...)` — el motivo de UNA línea, o `null`.
--     Una sola definición de «programable», que usan la revisión y el guardado.
--  2. `public.check_my_order_schedule_lines(slug, lines)` — la revisión previa:
--     devuelve cada línea con `ok` o `rejected` y su motivo, sin escribir nada.
--     La pantalla la pide al abrir el diálogo, antes de cualquier acción.
--  3. `save_my_order_schedule` — misma firma y mismas reglas; ahora falla con el
--     motivo concreto de la primera línea mala.
--
-- Motivos: LINEAS_INVALIDAS, CANTIDAD_INVALIDA, LINEA_DUPLICADA,
-- PRODUCTO_NO_DISPONIBLE, VARIANTE_REQUERIDA, VARIANTE_NO_DISPONIBLE,
-- FUERA_DE_CANAL, OTRA_MONEDA, FUERA_DE_SURTIDO.
--
-- Ninguna acepta cuenta, cliente ni tenant: tienda por slug, cuenta por la sesión.
-- Ni precio ni stock en la respuesta, igual que el resolver de pedido rápido.
-- =============================================================================

create or replace function ebim.order_schedule_line_issue(
  p_store    public.stores,
  p_customer uuid,
  p_channel  uuid,
  p_scoped   boolean,
  p_assort   boolean,
  p_item     jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  c_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_pid     uuid;
  v_vid     uuid;
  v_qty     integer;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
begin
  if jsonb_typeof(p_item) <> 'object'
     or coalesce(p_item ->> 'product_id', '') !~* c_uuid
     or (p_item ? 'variant_id' and jsonb_typeof(p_item -> 'variant_id') <> 'null'
         and coalesce(p_item ->> 'variant_id', '') !~* c_uuid) then
    return 'LINEAS_INVALIDAS';
  end if;
  v_pid := (p_item ->> 'product_id')::uuid;
  v_vid := case when jsonb_typeof(p_item -> 'variant_id') = 'string' then (p_item ->> 'variant_id')::uuid end;

  if jsonb_typeof(p_item -> 'quantity') in ('number', 'string')
     and btrim(p_item ->> 'quantity') ~ '^[0-9]{1,5}$' then
    v_qty := btrim(p_item ->> 'quantity')::integer;
  end if;
  if v_qty is null or v_qty not between 1 and 10000 then
    return 'CANTIDAD_INVALIDA';
  end if;

  select * into v_product from public.products p where p.id = v_pid and p.store_id = p_store.id;
  -- No publicado = no existe para el comprador, igual que en la vitrina.
  if v_product.id is null
     or v_product.status <> 'published'
     or v_product.published_at is null
     or v_product.published_at > now() then
    return 'PRODUCTO_NO_DISPONIBLE';
  end if;

  if v_product.kind = 'variant' and v_vid is null then
    return 'VARIANTE_REQUERIDA';
  end if;
  if v_vid is not null then
    select * into v_variant from public.product_variants pv where pv.id = v_vid and pv.product_id = v_pid;
    if v_variant.id is null or not v_variant.is_active or v_product.kind <> 'variant' then
      return 'VARIANTE_NO_DISPONIBLE';
    end if;
  end if;

  if p_scoped and not exists (
    select 1 from public.product_channels pc where pc.channel_id = p_channel and pc.product_id = v_pid
  ) then
    return 'FUERA_DE_CANAL';
  end if;
  if v_product.currency <> p_store.currency then
    return 'OTRA_MONEDA';
  end if;
  if p_assort and not ebim.product_in_assortment(p_store.id, p_customer, v_pid, p_channel) then
    return 'FUERA_DE_SURTIDO';
  end if;

  return null;
end;
$fn$;

revoke execute on function ebim.order_schedule_line_issue(public.stores, uuid, uuid, boolean, boolean, jsonb)
  from public, anon, authenticated;

-- La forma de la lista, común a la revisión y al guardado.
create or replace function ebim.order_schedule_assert_lines_shape(p_lines jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'LINEAS_INVALIDAS: hace falta al menos una linea' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'LINEAS_EXCESIVAS: como mucho 100 lineas' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e(item), jsonb_object_keys(
      case when jsonb_typeof(e.item) = 'object' then e.item else '{}'::jsonb end) k
    where k not in ('product_id', 'variant_id', 'quantity')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: cada linea lleva solo product_id, variant_id y quantity'
      using errcode = '22023';
  end if;
end;
$fn$;

revoke execute on function ebim.order_schedule_assert_lines_shape(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- La revisión previa
-- ---------------------------------------------------------------------------
create or replace function public.check_my_order_schedule_lines(p_store_slug text, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor   record;
  v_store   public.stores%rowtype;
  v_channel uuid;
  v_scoped  boolean;
  v_assort  boolean;
  v_item    jsonb;
  v_index   integer := 0;
  v_reason  text;
  v_key     text;
  v_seen    text[] := '{}';
  v_out     jsonb := '[]'::jsonb;
  v_ok      integer := 0;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);
  v_store := v_actor.store;
  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'orders.advanced') then
    raise exception 'SIN_MODULO: la tienda no tiene pedidos programados' using errcode = '42501';
  end if;
  perform ebim.order_schedule_assert_lines_shape(p_lines);

  v_channel := (ebim.public_channel(v_store.id)).id;
  select exists (select 1 from public.product_channels pc where pc.channel_id = v_channel) into v_scoped;
  v_assort := ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'trade.assortments');

  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_reason := ebim.order_schedule_line_issue(v_store, v_actor.customer_id, v_channel, v_scoped, v_assort, v_item);
    if v_reason is null then
      v_key := (v_item ->> 'product_id') || ':' || coalesce(nullif(v_item ->> 'variant_id', ''), '');
      if v_key = any (v_seen) then
        v_reason := 'LINEA_DUPLICADA';
      else
        v_seen := v_seen || v_key;
      end if;
    end if;
    if v_reason is null then v_ok := v_ok + 1; end if;

    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'index',      v_index,
      'product_id', v_item ->> 'product_id',
      'variant_id', nullif(v_item ->> 'variant_id', ''),
      'status',     case when v_reason is null then 'ok' else 'rejected' end,
      'reason',     v_reason)));
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('lines', v_out, 'accepted', v_ok, 'rejected', v_index - v_ok);
end;
$fn$;

revoke execute on function public.check_my_order_schedule_lines(text, jsonb) from public, anon;
grant  execute on function public.check_my_order_schedule_lines(text, jsonb) to authenticated, service_role;

comment on function public.check_my_order_schedule_lines(text, jsonb) is
  'Revision previa de programar: cada linea con ok/rejected y su motivo estable (FUERA_DE_SURTIDO, PRODUCTO_NO_DISPONIBLE...). No escribe nada; sin precio ni stock.';

-- ---------------------------------------------------------------------------
-- save_my_order_schedule — base 20260914130000; la validación de líneas pasa a
-- las dos funciones de arriba y el error dice el motivo concreto.
-- ---------------------------------------------------------------------------
create or replace function public.save_my_order_schedule(
  p_store_slug    text,
  p_template_id   uuid,
  p_name          text,
  p_lines         jsonb,
  p_interval_days integer,
  p_next_run_on   date,
  p_ends_on       date,
  p_request_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   record;
  v_store   public.stores%rowtype;
  v_tpl     public.order_templates%rowtype;
  v_name    text := btrim(coalesce(p_name, ''));
  v_key     text := nullif(btrim(coalesce(p_request_key, '')), '');
  v_check   jsonb;
  v_bad     jsonb;
  v_item    jsonb;
  v_pos     integer := 0;
  v_sched   public.order_schedules%rowtype;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);
  v_store := v_actor.store;

  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'orders.advanced') then
    raise exception 'SIN_MODULO: la tienda no tiene pedidos programados' using errcode = '42501';
  end if;

  if p_template_id is null and v_key is not null then
    select * into v_tpl
    from public.order_templates t
    where t.organization_id = v_store.organization_id
      and t.company_id = v_store.company_id
      and t.request_key = v_key;
    if found then
      if v_tpl.customer_id <> v_actor.customer_id or v_tpl.store_id <> v_store.id then
        raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible'
          using errcode = '22023';
      end if;
      return ebim.order_template_view(v_tpl) || jsonb_build_object('replayed', true);
    end if;
  end if;

  if v_key is not null and v_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    raise exception 'CAMPO_INVALIDO: clave de solicitud con formato invalido' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'NOMBRE_INVALIDO: el nombre va de 1 a 120 caracteres' using errcode = '22023';
  end if;
  if p_interval_days is null or p_interval_days not between 1 and 365 then
    raise exception 'INTERVALO_INVALIDO: cada 1 a 365 dias' using errcode = '22023';
  end if;
  if p_next_run_on is null or p_next_run_on < current_date
     or p_next_run_on > current_date + 365 then
    raise exception 'FECHA_INVALIDA: la primera fecha va de hoy a un año' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_next_run_on then
    raise exception 'FECHA_INVALIDA: el fin no puede ser antes de la primera fecha' using errcode = '22023';
  end if;

  if p_template_id is not null then
    v_tpl := ebim.order_template_of_actor(p_template_id, v_store.id, v_actor.customer_id, v_actor.account_id);
    if not v_tpl.is_active then
      raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible'
        using errcode = '22023';
    end if;
    perform 1 from public.order_templates t where t.id = v_tpl.id for update;
  end if;

  -- Líneas: se validan TODAS antes de escribir nada, con la misma revisión que
  -- ve la pantalla. La primera mala sale con SU motivo.
  if p_template_id is null or p_lines is not null then
    v_check := public.check_my_order_schedule_lines(p_store_slug, p_lines);
    select l into v_bad from jsonb_array_elements(v_check -> 'lines') l
    where l ->> 'status' = 'rejected' order by (l ->> 'index')::int limit 1;
    if v_bad is not null then
      raise exception '%: la linea % no se puede programar', v_bad ->> 'reason', (v_bad ->> 'index')::int + 1
        using errcode = '22023';
    end if;
  end if;

  if p_template_id is null then
    insert into public.order_templates (
      organization_id, company_id, store_id, customer_id, business_account_id,
      code, name, created_by, request_key
    ) values (
      v_store.organization_id, v_store.company_id, v_store.id, v_actor.customer_id, v_actor.account_id,
      'PRG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
      v_name, ebim.user_id(), v_key
    )
    returning * into v_tpl;
  else
    update public.order_templates set name = v_name, updated_at = now()
     where id = v_tpl.id
    returning * into v_tpl;
  end if;

  if p_template_id is null or p_lines is not null then
    delete from public.order_template_items i where i.template_id = v_tpl.id;
    for v_item in select value from jsonb_array_elements(p_lines) loop
      insert into public.order_template_items (
        organization_id, company_id, template_id, product_id, variant_id, quantity, position
      ) values (
        v_tpl.organization_id, v_tpl.company_id, v_tpl.id,
        (v_item ->> 'product_id')::uuid,
        case when jsonb_typeof(v_item -> 'variant_id') = 'string' then (v_item ->> 'variant_id')::uuid end,
        btrim(v_item ->> 'quantity')::integer,
        v_pos
      );
      v_pos := v_pos + 1;
    end loop;
  end if;

  select * into v_sched from public.order_schedules s where s.template_id = v_tpl.id for update;
  if not found then
    insert into public.order_schedules (
      organization_id, company_id, store_id, template_id, interval_days, next_run_on, ends_on
    ) values (
      v_tpl.organization_id, v_tpl.company_id, v_tpl.store_id, v_tpl.id,
      p_interval_days, p_next_run_on, p_ends_on
    );
  elsif v_sched.status = 'finished' then
    raise exception 'PROGRAMACION_TERMINADA: esa programacion ya termino' using errcode = '22023';
  else
    update public.order_schedules
       set interval_days = p_interval_days,
           next_run_on   = p_next_run_on,
           ends_on       = p_ends_on,
           updated_at    = now()
     where id = v_sched.id;
  end if;

  return ebim.order_template_view(v_tpl) || jsonb_build_object('replayed', false);
end;
$fn$;
