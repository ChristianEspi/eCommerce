-- =============================================================================
-- Cancelar un pedido devuelve la existencia al almacén (si no salió).
--
-- Encontrado en la prueba de punta a punta (2026-11-11, FerroMax en QAS):
-- EC-20261111-00018 se canceló y el taladro y las brocas siguieron descontados.
-- `order_commands` lo dejó escrito como deuda —«cancelar sin reponer… es
-- trabajo de P12»— y P12 nunca lo cerró. Cada cancelación desfasaba el
-- inventario hacia abajo, y la tienda acababa diciendo «agotado» con la
-- mercancía en la estantería.
--
-- La regla, la misma que ya usa `orders_cancel_closes_fulfillments`:
--
--   · Si ninguna entrega del pedido salió (ni EN CAMINO ni ENTREGADA), lo
--     vendido vuelve. Es lo que pasa en la práctica: un pedido anulado antes de
--     despachar nunca dejó el almacén.
--   · Si algo ya salió, NO se repone: la mercancía está fuera y lo que vuelva
--     entra por Devoluciones (`return_receive`), que es donde se inspecciona.
--
-- Dos caminos, como `consume_stock`:
--
--   · ALMACÉN: por cada asiento `issue` del pedido, un asiento `return` en el
--     MISMO nivel y por la misma cantidad. Idempotente por `external_ref`
--     (`cancel:<id del asiento>`): reintentar no repone dos veces.
--   · CATÁLOGO (tienda sin almacenes): se suma de vuelta a `products.stock` o
--     al de la variante, desglosando los kits con `expand_stock_lines`.
--
-- `orders.stock_restored_at` marca que ya se repuso. Es un trigger BEFORE sobre
-- `orders` y no un paso de `order_transition`, porque un pedido también se
-- cancela al rechazar una aprobación B2B o desde un ERP: los tres caminos
-- tienen que acabar igual.
-- =============================================================================

alter table public.orders
  add column if not exists stock_restored_at timestamptz;

comment on column public.orders.stock_restored_at is
  'Cuándo se devolvió al almacén lo vendido por cancelar el pedido. Null = no se repuso (no se canceló, o ya había salido).';

create or replace function ebim.restock_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_salio boolean;
  v_mov   record;
  v_item  record;
  v_line  record;
  v_n     integer := 0;
begin
  if new.stock_restored_at is not null then
    return new;
  end if;

  select exists (
    select 1 from public.fulfillments f
    where f.order_id = new.id
      and f.state in ('in_transit', 'delivered')
  ) into v_salio;

  if v_salio then
    return new;
  end if;

  if exists (
    select 1 from public.inventory_movements m
    where m.reference_kind = 'order' and m.reference_id = new.id and m.kind = 'issue'
  ) then
    for v_mov in
      select m.id, m.level_id, m.quantity
      from public.inventory_movements m
      where m.reference_kind = 'order' and m.reference_id = new.id and m.kind = 'issue'
      order by m.created_at, m.id
    loop
      perform ebim.apply_movement(
        v_mov.level_id,
        'return'::public.movement_kind,
        -v_mov.quantity,
        'Pedido cancelado: vuelve al almacén',
        'order',
        new.id,
        'cancel:' || v_mov.id::text,
        ebim.user_id()
      );
      v_n := v_n + 1;
    end loop;
  else
    for v_item in
      select oi.product_id, oi.variant_id, coalesce(oi.base_quantity, oi.quantity)::numeric as qty
      from public.order_items oi
      where oi.order_id = new.id and oi.product_id is not null
    loop
      for v_line in
        select l.product_id, l.variant_id, l.quantity
        from ebim.expand_stock_lines(new.store_id, v_item.product_id, v_item.variant_id, v_item.qty) l
      loop
        if v_line.variant_id is not null then
          update public.product_variants
             set stock = stock + v_line.quantity::integer
           where id = v_line.variant_id;
        else
          update public.products
             set stock = stock + v_line.quantity::integer
           where id = v_line.product_id;
        end if;
        v_n := v_n + 1;
      end loop;
    end loop;
  end if;

  new.stock_restored_at := now();

  perform ebim.log_order_fact(
    new, 'inventory.restocked', 'Existencia devuelta al cancelar',
    jsonb_build_object('lines', v_n), 'system');

  return new;
end;
$fn$;

revoke execute on function ebim.restock_cancelled_order() from public, anon, authenticated;

drop trigger if exists orders_cancel_restocks on public.orders;
create trigger orders_cancel_restocks
  before update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from new.status)
  execute function ebim.restock_cancelled_order();
