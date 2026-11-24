-- =============================================================================
-- API de integración v1 · Catálogo: los campos que la carga aún no aceptaba
-- (2026-11-24)
--
-- `products[]`: highlights (viñetas), shipping_weight y units (presentaciones de
-- venta: caja, blíster…). `variants[]`: shipping_weight y custom_fields.
--
-- Misma regla que el resto del lote: todo o nada, y `dry_run` valida sin
-- escribir. La función original queda intacta (pasa a `ebim`) y se envuelve:
-- un lote sin campos nuevos va directo a ella y responde exactamente igual.
--
-- Las IMÁGENES no entran por aquí: son binarios del bucket privado de cada
-- tenant y se suben desde el backoffice; la API las LEE (`images[].path`).
-- =============================================================================

-- Idempotente: reaplicar la migración no vuelve a mover la función.
do $do$
begin
  if to_regprocedure('ebim.api_catalog_upsert_core(uuid, jsonb, boolean)') is null then
    alter function public.api_catalog_upsert(uuid, jsonb, boolean) rename to api_catalog_upsert_core;
    alter function public.api_catalog_upsert_core(uuid, jsonb, boolean) set schema ebim;
  end if;
end
$do$;
revoke execute on function ebim.api_catalog_upsert_core(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

create or replace function ebim.api_product_apply_extras(p_product_id uuid, p_item jsonb, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.products%rowtype;
  v_x     jsonb;
  v_i     integer := 0;
  v_uom   uuid;
  v_code  text;
  v_vid   uuid;
begin
  select * into v_p from public.products where id = p_product_id;

  if p_item ? 'highlights' then
    if jsonb_typeof(p_item -> 'highlights') <> 'array' then
      perform ebim.api_catalog_fail('VALOR_INVALIDO', p_path || '.highlights', 'highlights es una lista de textos');
    end if;
    update public.products
       set highlights = array(select jsonb_array_elements_text(p_item -> 'highlights'))
     where id = p_product_id;
  end if;

  if p_item ? 'shipping_weight' then
    update public.products set shipping_weight = (p_item ->> 'shipping_weight')::numeric where id = p_product_id;
  end if;

  if p_item ? 'units' then
    if jsonb_typeof(p_item -> 'units') <> 'array' or jsonb_array_length(p_item -> 'units') > 20 then
      perform ebim.api_catalog_fail('VALOR_INVALIDO', p_path || '.units', 'units es una lista de hasta 20');
    end if;
    -- La base que llega desplaza a la anterior (una sola por producto).
    if exists (select 1 from jsonb_array_elements(p_item -> 'units') u
               where jsonb_typeof(u) = 'object' and coalesce((u ->> 'is_base')::boolean, false)) then
      update public.product_uoms set is_base = false where product_id = p_product_id and is_base;
    end if;
    for v_x in select x from jsonb_array_elements(p_item -> 'units') x loop
      perform ebim.api_assert_keys(v_x, array['code', 'name', 'factor', 'is_base', 'is_sellable', 'price', 'barcode'],
                                   p_path || '.units[' || v_i || ']');
      v_code := nullif(btrim(coalesce(v_x ->> 'code', '')), '');
      if v_code is null then
        perform ebim.api_catalog_fail('CAMPO_REQUERIDO', p_path || '.units[' || v_i || '].code',
                                      'falta el codigo de la unidad');
      end if;
      v_uom := null;
      select u.id into v_uom from public.units_of_measure u
       where u.organization_id = v_p.organization_id and u.company_id = v_p.company_id
         and lower(u.code) = lower(v_code);
      if v_uom is null then
        insert into public.units_of_measure (organization_id, company_id, code, name)
        values (v_p.organization_id, v_p.company_id, v_code, coalesce(nullif(btrim(v_x ->> 'name'), ''), v_code))
        returning id into v_uom;
      end if;
      insert into public.product_uoms
        (organization_id, company_id, store_id, product_id, uom_id, factor, is_base, is_sellable, price, barcode, position)
      values
        (v_p.organization_id, v_p.company_id, v_p.store_id, p_product_id, v_uom,
         coalesce((v_x ->> 'factor')::numeric, 1), coalesce((v_x ->> 'is_base')::boolean, false),
         coalesce((v_x ->> 'is_sellable')::boolean, true), (v_x ->> 'price')::numeric,
         nullif(btrim(coalesce(v_x ->> 'barcode', '')), ''), v_i)
      on conflict (product_id, uom_id) do update set
        factor      = coalesce((v_x ->> 'factor')::numeric, public.product_uoms.factor),
        is_base     = coalesce((v_x ->> 'is_base')::boolean, public.product_uoms.is_base),
        is_sellable = coalesce((v_x ->> 'is_sellable')::boolean, public.product_uoms.is_sellable),
        price       = case when v_x ? 'price' then (v_x ->> 'price')::numeric else public.product_uoms.price end,
        barcode     = case when v_x ? 'barcode' then nullif(btrim(v_x ->> 'barcode'), '') else public.product_uoms.barcode end,
        position    = v_i;
      v_i := v_i + 1;
    end loop;
  end if;

  v_i := 0;
  for v_x in select x from jsonb_array_elements(
               case jsonb_typeof(p_item -> 'variants') when 'array' then p_item -> 'variants' else '[]'::jsonb end) x
  loop
    if jsonb_typeof(v_x) = 'object' and v_x ?| array['shipping_weight', 'custom_fields'] then
      if v_x ? 'custom_fields' and jsonb_typeof(v_x -> 'custom_fields') <> 'object' then
        perform ebim.api_catalog_fail('VALOR_INVALIDO', p_path || '.variants[' || v_i || '].custom_fields',
                                      'custom_fields es un objeto');
      end if;
      select pv.id into v_vid from public.product_variants pv
       where pv.product_id = p_product_id and pv.sku = btrim(v_x ->> 'sku');
      update public.product_variants pv set
        shipping_weight = case when v_x ? 'shipping_weight' then (v_x ->> 'shipping_weight')::numeric else pv.shipping_weight end,
        custom_fields   = case when v_x ? 'custom_fields' then v_x -> 'custom_fields' else pv.custom_fields end
      where pv.id = v_vid;
    end if;
    v_i := v_i + 1;
  end loop;
end;
$$;

revoke execute on function ebim.api_product_apply_extras(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.api_catalog_upsert(
  p_api_client_id uuid,
  p_payload       jsonb,
  p_dry_run       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_core     jsonb;
  v_result   jsonb;
  v_items    jsonb;
  v_p        jsonb;
  v_idx      integer;
  v_pid      uuid;
  v_bad      integer := 0;
  v_state    text;
  v_msg      text;
  v_hint     text;
  v_cons     text;
  v_extras   constant text[] := array['highlights', 'shipping_weight', 'units'];
  v_vextras  constant text[] := array['shipping_weight', 'custom_fields'];
begin
  -- Sin nada nuevo, la función original tal cual (mismo informe, mismos errores).
  if jsonb_typeof(v_payload) is distinct from 'object'
     or jsonb_typeof(v_payload -> 'products') is distinct from 'array'
     or not exists (
       select 1 from jsonb_array_elements(v_payload -> 'products') p
       where jsonb_typeof(p) = 'object'
         and (p ?| v_extras
              or exists (select 1 from jsonb_array_elements(
                           case jsonb_typeof(p -> 'variants') when 'array' then p -> 'variants' else '[]'::jsonb end) v
                         where jsonb_typeof(v) = 'object' and v ?| v_vextras))) then
    return ebim.api_catalog_upsert_core(p_api_client_id, v_payload, p_dry_run);
  end if;

  -- Al núcleo, sin los campos nuevos.
  v_core := jsonb_set(v_payload, '{products}', (
    select coalesce(jsonb_agg(
             case when jsonb_typeof(y.p) <> 'object' then y.p
                  else (y.p - v_extras) || case when jsonb_typeof(y.p -> 'variants') = 'array'
                    then jsonb_build_object('variants', (
                      select coalesce(jsonb_agg(case when jsonb_typeof(x.v) = 'object' then x.v - v_vextras else x.v end
                                                order by x.vo), '[]'::jsonb)
                      from jsonb_array_elements(y.p -> 'variants') with ordinality as x(v, vo)))
                    else '{}'::jsonb end end
             order by y.o), '[]'::jsonb)
    from jsonb_array_elements(v_payload -> 'products') with ordinality as y(p, o)));

  begin
    v_result := ebim.api_catalog_upsert_core(p_api_client_id, v_core, false);
    v_items  := v_result -> 'items';

    if (v_result ->> 'applied')::boolean then
      for v_p, v_idx in
        select y.p, (y.o - 1)::integer
        from jsonb_array_elements(v_payload -> 'products') with ordinality as y(p, o)
      loop
        v_pid := ebim.safe_uuid((
          select i ->> 'product_id' from jsonb_array_elements(v_items) i where (i ->> 'index')::integer = v_idx));
        continue when v_pid is null;
        begin
          perform ebim.api_product_apply_extras(v_pid, v_p, 'products[' || v_idx || ']');
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text,
                                  v_hint = pg_exception_hint, v_cons = constraint_name;
          v_bad := v_bad + 1;
          select coalesce(jsonb_agg(case when (i ->> 'index')::integer = v_idx
                   then i || jsonb_build_object('status', 'rejected', 'errors', jsonb_build_array(
                          ebim.api_catalog_error(v_state, v_msg,
                            coalesce(nullif(v_hint, ''), 'products[' || v_idx || ']'), v_cons)))
                   else i end), '[]'::jsonb)
            into v_items from jsonb_array_elements(v_items) i;
        end;
      end loop;
    end if;

    if p_dry_run or v_bad > 0 or not (v_result ->> 'applied')::boolean then
      raise exception 'EBIM_API_CATALOG_ROLLBACK' using errcode = 'EB002';
    end if;
  exception when sqlstate 'EB002' then
    null;
  end;

  if p_dry_run or v_bad > 0 or not (v_result ->> 'applied')::boolean then
    -- Lo que no se escribió no tiene identificador.
    -- (los que el núcleo CREÓ, aunque ahora figuren como rechazados).
    select coalesce(jsonb_agg(case when exists (
                                     select 1 from jsonb_array_elements(v_result -> 'items') o
                                     where (o ->> 'index') = (i ->> 'index') and o ->> 'status' = 'created')
                                   then jsonb_set(i, '{product_id}', 'null'::jsonb) else i end), '[]'::jsonb)
      into v_items from jsonb_array_elements(v_items) i;
    return v_result || jsonb_build_object(
      'dry_run', coalesce(p_dry_run, false),
      'applied', false,
      'summary', (v_result -> 'summary') || jsonb_build_object(
                   'rejected', ((v_result #>> '{summary,rejected}')::integer + v_bad)),
      'items', v_items);
  end if;

  return v_result || jsonb_build_object('dry_run', false, 'items', v_items);
end;
$$;

revoke execute on function public.api_catalog_upsert(uuid, jsonb, boolean) from public, anon, authenticated;
grant  execute on function public.api_catalog_upsert(uuid, jsonb, boolean) to service_role;
