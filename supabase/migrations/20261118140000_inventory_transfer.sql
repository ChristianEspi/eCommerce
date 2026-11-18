-- =============================================================================
-- Trasladar stock entre almacenes en UNA operación (2026-11-18).
--
-- Antes un traslado eran dos movimientos a mano —«Traslado enviado» en el
-- origen y «Traslado recibido» en el destino—, y si el segundo no se
-- registraba la mercancía desaparecía del total. Ahora es un solo comando: las
-- dos patas en la misma transacción, con la misma referencia, o ninguna.
--
-- Reusa `adjust_inventory` (mismo permiso, mismo asiento, mismo libro mayor):
-- el traslado no es un tipo nuevo de verdad, es la pareja de dos que ya
-- existían, atada.
-- =============================================================================

create or replace function public.inventory_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_product_id        uuid,
  p_variant_id        uuid    default null,
  p_quantity          numeric default 0,
  p_reason            text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_from      public.warehouses%rowtype;
  v_to        public.warehouses%rowtype;
  v_available numeric;
  v_ref       text;
  v_reason    text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'TRASLADO_MISMO_ALMACEN: el origen y el destino son el mismo almacen'
      using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'CANTIDAD_INVALIDA: la cantidad a trasladar tiene que ser mayor que cero'
      using errcode = '22023';
  end if;

  select * into v_from from public.warehouses w where w.id = p_from_warehouse_id;
  select * into v_to   from public.warehouses w where w.id = p_to_warehouse_id;
  if v_from.id is null or v_to.id is null then
    raise exception 'ALMACEN_NO_ENCONTRADO: falta el origen o el destino' using errcode = '22023';
  end if;
  if v_from.organization_id <> v_to.organization_id or v_from.company_id <> v_to.company_id then
    raise exception 'TRASLADO_OTRA_SOCIEDAD: los dos almacenes tienen que ser de la misma sociedad'
      using errcode = '22023';
  end if;
  -- El stock de un almacén del sistema de gestión lo manda ese sistema: un
  -- traslado manual se pisaría en la siguiente sincronización.
  if v_from.source <> 'local' or v_to.source <> 'local' then
    raise exception 'TRASLADO_ALMACEN_EXTERNO: solo se traslada entre almacenes locales'
      using errcode = '22023';
  end if;

  perform ebim.assert_inventory_role(
    v_from.organization_id, v_from.company_id,
    array['owner','admin','catalog']::public.app_role[]);

  select coalesce(l.available_qty, 0) into v_available
    from public.inventory_levels l
   where l.warehouse_id = v_from.id
     and l.product_id = p_product_id
     and l.variant_id is not distinct from p_variant_id
   for update;
  if coalesce(v_available, 0) < p_quantity then
    raise exception 'STOCK_INSUFICIENTE_ORIGEN: el origen tiene % disponibles', coalesce(v_available, 0)
      using errcode = '22023';
  end if;

  -- Una referencia común ata las dos patas en el libro mayor.
  v_ref := 'TRF-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 4);

  perform public.adjust_inventory(
    v_from.id, p_product_id, p_variant_id, -p_quantity, 'transfer_out',
    coalesce(v_reason, 'Traslado a ' || v_to.code), v_ref);
  perform public.adjust_inventory(
    v_to.id, p_product_id, p_variant_id, p_quantity, 'transfer_in',
    coalesce(v_reason, 'Traslado desde ' || v_from.code), v_ref);

  return jsonb_build_object(
    'reference', v_ref,
    'quantity',  p_quantity::text,
    'from',      v_from.code,
    'to',        v_to.code,
    'from_available', (select l.available_qty::text from public.inventory_levels l
                        where l.warehouse_id = v_from.id and l.product_id = p_product_id
                          and l.variant_id is not distinct from p_variant_id),
    'to_available',   (select l.available_qty::text from public.inventory_levels l
                        where l.warehouse_id = v_to.id and l.product_id = p_product_id
                          and l.variant_id is not distinct from p_variant_id));
end;
$fn$;

revoke execute on function public.inventory_transfer(uuid, uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.inventory_transfer(uuid, uuid, uuid, uuid, numeric, text) to authenticated;

comment on function public.inventory_transfer(uuid, uuid, uuid, uuid, numeric, text) is
  'Traslada stock entre dos almacenes locales de la misma sociedad en una sola transaccion (transfer_out + transfer_in con la misma referencia).';
