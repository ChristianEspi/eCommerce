-- =============================================================================
-- Datos de DEMOSTRACION para el proyecto DEV/QAS.
--
-- NO es una migracion y NO vive en `supabase/migrations` a proposito: si lo
-- fuera se aplicaria tambien en produccion, y el primer cliente real arrancaria
-- con clientes, cupones y devoluciones inventados dentro de su cuenta.
--
-- Que hace: rellena las pantallas del backoffice del tenant `miquimica` para
-- poder mirarlas con datos, y con filas suficientes para que la paginacion se
-- vea trabajar de verdad.
--
-- Reglas que respeta, iguales que el resto del repo:
--   * Todo cuelga de organization_id + company_id. Ninguna fila sin dueno.
--   * Idempotente: cada fila lleva uuid fijo y `on conflict (id) do nothing`.
--     Correrlo diez veces deja la base igual que correrlo una.
--   * Solo toca `miquimica`. El tenant B existe para las pruebas de
--     aislamiento y se queda vacio: llenarlo tambien enmascararia una fuga de
--     RLS justo en el sitio donde se comprueba que no la hay.
--   * Ni claves, ni tokens, ni hashes reales. Lo que ocupa el sitio de un
--     secreto es un literal inservible y esta marcado como tal.
--
-- Los datos NO son todos "bonitos" a proposito: hay stock bajo minimos, una
-- devolucion rechazada, un webhook caido y una promocion en pausa. Una demo
-- donde todo va bien no ensena para que sirven las pantallas.
--
-- Identidades fijas del tenant de demo:
--   organization  d0000000-0000-4000-8000-000000000001
--   company       d0000000-0000-4000-8000-0000000000c1
--   store         d0000000-0000-4000-8000-0000000000a1
-- =============================================================================


-- ===== Ajustes: monedas e impuestos =========================================

insert into public.tenant_currencies (id, organization_id, company_id, currency, is_base) values
  ('d0000000-0000-4000-8000-f00000000001','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','PEN',true),
  ('d0000000-0000-4000-8000-f00000000002','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','USD',false)
on conflict (id) do nothing;

insert into public.tax_categories (id, organization_id, company_id, code, name, is_default) values
  ('d0000000-0000-4000-8000-f00000000011','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','igv18','IGV general (18%)',true),
  ('d0000000-0000-4000-8000-f00000000012','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','exonerado','Exonerado',false),
  ('d0000000-0000-4000-8000-f00000000013','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','inafecto','Inafecto',false)
on conflict (id) do nothing;

insert into public.tax_rates (id, organization_id, company_id, tax_category_id, rate, valid_from) values
  ('d0000000-0000-4000-8000-f00000000021','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000011',0.1800, now() - interval '2 years'),
  ('d0000000-0000-4000-8000-f00000000022','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000012',0.0000, now() - interval '2 years'),
  ('d0000000-0000-4000-8000-f00000000023','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000013',0.0000, now() - interval '2 years')
on conflict (id) do nothing;


-- ===== PIM: marcas, familias, unidades, atributos, variantes ================

insert into public.brands (id, organization_id, company_id, code, name, description) values
  ('d0000000-0000-4000-8000-f00000000031','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','miquimica','MiQuimica','Marca propia de la botica'),
  ('d0000000-0000-4000-8000-f00000000032','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','vitalis','Vitalis','Vitaminas y suplementos'),
  ('d0000000-0000-4000-8000-f00000000033','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','dermacare','DermaCare','Dermocosmetica y cuidado personal')
on conflict (id) do nothing;

insert into public.product_families (id, organization_id, company_id, code, name, description) values
  ('d0000000-0000-4000-8000-f00000000041','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','medicamentos','Medicamentos','Analgesicos, antigripales y digestivos'),
  ('d0000000-0000-4000-8000-f00000000042','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','cuidado','Cuidado personal','Higiene, dermocosmetica y bebe'),
  ('d0000000-0000-4000-8000-f00000000043','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','suplementos','Suplementos','Vitaminas y minerales')
on conflict (id) do nothing;

insert into public.units_of_measure (id, organization_id, company_id, code, name, symbol) values
  ('d0000000-0000-4000-8000-f00000000051','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','UND','Unidad','und'),
  ('d0000000-0000-4000-8000-f00000000052','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','CAJA12','Caja de 12','caja'),
  ('d0000000-0000-4000-8000-f00000000053','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','PACK6','Pack de 6','pack'),
  ('d0000000-0000-4000-8000-f00000000054','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','BLIS','Blister','blis')
on conflict (id) do nothing;

insert into public.attributes (id, organization_id, company_id, code, name, data_type, unit, is_variant_axis, is_filterable, position) values
  ('d0000000-0000-4000-8000-f00000000061','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','presentacion','Presentacion','option',null,true,true,1),
  ('d0000000-0000-4000-8000-f00000000062','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','principio','Principio activo','option',null,true,true,2),
  ('d0000000-0000-4000-8000-f00000000063','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','contenido','Contenido','number','ml',false,true,3),
  ('d0000000-0000-4000-8000-f00000000064','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','receta','Requiere receta','boolean',null,false,false,4)
on conflict (id) do nothing;

insert into public.attribute_values (id, organization_id, company_id, attribute_id, attribute_data_type, code, label, position) values
  ('d0000000-0000-4000-8000-f00000000071','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000061','option','caja-10','Caja de 10',1),
  ('d0000000-0000-4000-8000-f00000000072','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000061','option','caja-20','Caja de 20',2),
  ('d0000000-0000-4000-8000-f00000000073','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000061','option','frasco','Frasco',3),
  ('d0000000-0000-4000-8000-f00000000074','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000062','option','paracetamol','Paracetamol',1),
  ('d0000000-0000-4000-8000-f00000000075','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000062','option','ibuprofeno','Ibuprofeno',2),
  ('d0000000-0000-4000-8000-f00000000076','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-f00000000062','option','loratadina','Loratadina',3)
on conflict (id) do nothing;

-- Tres presentaciones del mismo medicamento: es lo que hace visible el panel de
-- variantes, y en una botica es el caso normal (blister, caja y jarabe).
-- El producto padre tiene que declararse `variant` ANTES: la clave ajena
-- `product_variants_kind_fk` va contra (product_id, product_kind), asi que la
-- base no deja colgar variantes de algo que sigue diciendo que es simple.
update public.products
   set kind = 'variant'
 where id = 'd0000000-0000-4000-8000-0000000000e1'
   and kind <> 'variant';

insert into public.product_variants (id, organization_id, company_id, store_id, product_id, sku, name, price, stock, is_default, position) values
  ('d0000000-0000-4000-8000-f00000000081','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','MED-PAR-500-C10','Paracetamol 500 mg - Caja de 10',5.50,8,true,1),
  ('d0000000-0000-4000-8000-f00000000082','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','MED-PAR-500-C20','Paracetamol 500 mg - Caja de 20',8.90,7,false,2),
  ('d0000000-0000-4000-8000-f00000000083','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','MED-PAR-500-JAR','Paracetamol jarabe 120 ml',13.90,5,false,3)
on conflict (id) do nothing;

insert into public.variant_attribute_values (id, organization_id, company_id, store_id, variant_id, attribute_id, value_id, is_axis) values
  ('d0000000-0000-4000-8000-f00000000091','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000081','d0000000-0000-4000-8000-f00000000061','d0000000-0000-4000-8000-f00000000071',true),
  ('d0000000-0000-4000-8000-f00000000092','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000082','d0000000-0000-4000-8000-f00000000061','d0000000-0000-4000-8000-f00000000072',true),
  ('d0000000-0000-4000-8000-f00000000093','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000083','d0000000-0000-4000-8000-f00000000061','d0000000-0000-4000-8000-f00000000073',true)
on conflict (id) do nothing;

insert into public.product_uoms (id, organization_id, company_id, store_id, product_id, uom_id, factor, is_base, is_sellable, price, position) values
  ('d0000000-0000-4000-8000-f000000000a1','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-f00000000051',1,true,true,8.90,1),
  ('d0000000-0000-4000-8000-f000000000a2','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-f00000000052',12,false,true,96.00,2),
  ('d0000000-0000-4000-8000-f000000000a3','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e8','d0000000-0000-4000-8000-f00000000051',1,true,true,19.00,1),
  ('d0000000-0000-4000-8000-f000000000a4','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e8','d0000000-0000-4000-8000-f00000000053',6,false,true,99.00,2)
on conflict (id) do nothing;

-- Ficha del producto. El atributo suelto no dice nada hasta que cuelga de algo.
insert into public.product_attribute_values (id, organization_id, company_id, store_id, product_id, attribute_id, value_id, value_number, value_boolean) values
  ('d0000000-0000-4000-8000-f000000000b1','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-f00000000061','d0000000-0000-4000-8000-f00000000071',null,null),
  ('d0000000-0000-4000-8000-f000000000b2','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-f00000000062','d0000000-0000-4000-8000-f00000000074',null,null),
  ('d0000000-0000-4000-8000-f000000000b3','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-f00000000063',null,120,null),
  ('d0000000-0000-4000-8000-f000000000b4','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e2','d0000000-0000-4000-8000-f00000000062','d0000000-0000-4000-8000-f00000000075',null,null),
  ('d0000000-0000-4000-8000-f000000000b5','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e3','d0000000-0000-4000-8000-f00000000062','d0000000-0000-4000-8000-f00000000076',null,null),
  ('d0000000-0000-4000-8000-f000000000b6','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e4','d0000000-0000-4000-8000-f00000000064',null,null,true),
  ('d0000000-0000-4000-8000-f000000000b7','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e5','d0000000-0000-4000-8000-f00000000063',null,60,null),
  ('d0000000-0000-4000-8000-f000000000b8','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e6','d0000000-0000-4000-8000-f00000000061','d0000000-0000-4000-8000-f00000000073',null,null)
on conflict (id) do nothing;


-- ===== Inventario: almacenes, existencias y movimientos =====================

insert into public.warehouses (id, organization_id, company_id, code, name, kind, source, priority, is_default, city, region, country) values
  ('d0000000-0000-4000-8000-f00000000101','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','ALM-LIM','Almacen central Lima','warehouse','local',10,true,'Lima','Lima','PE'),
  ('d0000000-0000-4000-8000-f00000000102','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','TDA-MIR','Botica Miraflores','store','local',20,false,'Lima','Lima','PE'),
  ('d0000000-0000-4000-8000-f00000000103','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','ALM-ARE','Almacen Arequipa','warehouse','erp',30,false,'Arequipa','Arequipa','PE'),
  ('d0000000-0000-4000-8000-f00000000104','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','VIR-DRP','Drogueria aliada','virtual','erp',90,false,null,null,'PE')
on conflict (id) do nothing;

insert into public.store_warehouses (id, organization_id, company_id, store_id, warehouse_id, priority) values
  ('d0000000-0000-4000-8000-f00000000111','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000101',10),
  ('d0000000-0000-4000-8000-f00000000112','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000102',20),
  ('d0000000-0000-4000-8000-f00000000113','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000103',30)
on conflict (id) do nothing;

-- Existencias de cada producto en cada almacen: 33 filas, suficientes para ver
-- paginar. Algunas quedan A PROPOSITO por debajo del punto de pedido, porque un
-- inventario donde todo esta correcto no ensena para que sirve la pantalla.
insert into public.inventory_levels (id, organization_id, company_id, warehouse_id, store_id, product_id, on_hand_qty, reserved_qty, safety_stock, reorder_point)
select
  ('d0000000-0000-4000-8000-c1' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  warehouse_id, 'd0000000-0000-4000-8000-0000000000a1', product_id,
  on_hand,
  least((n * 3) % 5, on_hand),
  2, 5
from (
  select
    row_number() over (order by w.code, p.sku) as n,
    w.id as warehouse_id, p.id as product_id,
    ((row_number() over (order by w.code, p.sku)) * 7) % 23 as on_hand
  from public.warehouses w
  cross join public.products p
  where w.organization_id = 'd0000000-0000-4000-8000-000000000001'
    and w.code in ('ALM-LIM','TDA-MIR','ALM-ARE')
    and p.store_id = 'd0000000-0000-4000-8000-0000000000a1'
) src
-- Idempotencia por la CLAVE NATURAL, no solo por el uuid. El id sale de un
-- `row_number()` sobre el catalogo, asi que en cuanto el catalogo cambia el
-- mismo par (almacen, producto) sale con otro id y el `on conflict (id)` no lo
-- para: se estrella contra `inventory_levels_unique` y tumba el fichero entero.
where not exists (
  select 1 from public.inventory_levels il
   where il.warehouse_id = src.warehouse_id
     and il.product_id   = src.product_id
     and il.variant_id is null
)
on conflict (id) do nothing;

insert into public.inventory_movements (id, organization_id, company_id, warehouse_id, store_id, product_id, level_id, kind, quantity, on_hand_after, reason, source, occurred_at)
select
  ('d0000000-0000-4000-8000-c2' || lpad((row_number() over (order by l.id, g.n))::text, 10, '0'))::uuid,
  l.organization_id, l.company_id, l.warehouse_id, l.store_id, l.product_id, l.id,
  (array['receipt','issue','adjustment','count','return'])[1 + (g.n + (('x' || substr(replace(l.id::text,'-',''), 1, 4))::bit(16)::int)) % 5]::movement_kind,
  case when g.n % 2 = 0 then 4 else -3 end,
  greatest(l.on_hand_qty + g.n, 0),
  (array['Recepcion de proveedor','Salida por pedido','Ajuste tras conteo','Conteo ciclico','Devolucion de cliente'])[1 + (g.n + (('x' || substr(replace(l.id::text,'-',''), 1, 4))::bit(16)::int)) % 5],
  'local',
  now() - (g.n || ' days')::interval
from (
  select * from public.inventory_levels
  where store_id = 'd0000000-0000-4000-8000-0000000000a1'
  order by id limit 14
) l
cross join generate_series(1, 3) as g(n)
on conflict (id) do nothing;


-- ===== Clientes: personas, empresas, direcciones y contactos ================

insert into public.customer_segments (id, organization_id, company_id, code, name, description) values
  ('d0000000-0000-4000-8000-f00000000201','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','minorista','Minorista','Compra puntual en la vitrina'),
  ('d0000000-0000-4000-8000-f00000000202','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','mayorista','Mayorista','Volumen y precio negociado'),
  ('d0000000-0000-4000-8000-f00000000203','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','corporativo','Corporativo','Cuenta B2B con aprobaciones'),
  ('d0000000-0000-4000-8000-f00000000204','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','clinicas','Clinicas y consultorios','Convenio institucional')
on conflict (id) do nothing;

-- 28 clientes: por encima de una pagina de 25, que es justo lo que hace falta
-- para comprobar que el paginador no miente en el total.
insert into public.customers (id, organization_id, company_id, kind, code, name, legal_name, tax_id, email, phone, segment_id, is_active)
select
  ('d0000000-0000-4000-8000-d1' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  case when n % 4 = 0 then 'company' else 'person' end::customer_kind,
  'CLI-' || lpad(n::text, 3, '0'),
  case when n % 4 = 0
    then (array['Clinica San Rafael','Policlinico Andino','Centro Medico Surco','Laboratorio Vega','Botica Aliada','Consultorio Dental Lima','Geriatrico El Roble'])[1 + (n / 4) % 7] || ' SAC'
    else (array['Ana','Luis','Marta','Diego','Sofia','Javier','Nuria','Pablo','Elena','Carlos','Irene','Marcos'])[1 + n % 12]
         || ' ' || (array['Quispe','Rojas','Vargas','Mendoza','Salazar','Ferrer','Castro','Nunez'])[1 + n % 8]
  end,
  case when n % 4 = 0 then 'Comercializadora ' || n || ' S.A.C.' else null end,
  case when n % 4 = 0 then '20' || lpad((100000000 + n * 7)::text, 9, '0') else null end,
  'cliente' || lpad(n::text, 3, '0') || '@miquimica.demo',
  '+51 9' || lpad((10000000 + n * 137)::text, 8, '0'),
  case n % 4
    when 0 then 'd0000000-0000-4000-8000-f00000000203'
    when 1 then 'd0000000-0000-4000-8000-f00000000201'
    when 2 then 'd0000000-0000-4000-8000-f00000000202'
    else 'd0000000-0000-4000-8000-f00000000204'
  end::uuid,
  n not in (7, 19)
from generate_series(1, 28) as g(n)
on conflict (id) do nothing;

insert into public.customer_addresses (id, organization_id, company_id, customer_id, label, recipient, phone, line1, city, region, postal_code, country, is_shipping, is_billing, is_default_shipping, verification)
select
  ('d0000000-0000-4000-8000-d2' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  ('d0000000-0000-4000-8000-d1' || lpad(n::text, 10, '0'))::uuid,
  case when n % 3 = 0 then 'Oficina' else 'Casa' end,
  'Contacto ' || n,
  '+51 9' || lpad((10000000 + n * 137)::text, 8, '0'),
  (array['Av. Pardo','Jr. Bolivar','Calle Los Nogales','Av. Larco','Jr. Union'])[1 + n % 5] || ' ' || (100 + n * 3),
  (array['Lima','Arequipa','Trujillo','Cusco'])[1 + n % 4],
  (array['Lima','Arequipa','La Libertad','Cusco'])[1 + n % 4],
  lpad((15000 + n)::text, 5, '0'),
  'PE', true, n % 3 = 0, true,
  (array['verified','unverified','pending','rejected'])[1 + n % 4]::address_verification
from generate_series(1, 18) as g(n)
on conflict (id) do nothing;

insert into public.customer_contacts (id, organization_id, company_id, customer_id, name, email, phone, role_title, is_primary)
select
  ('d0000000-0000-4000-8000-d3' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  ('d0000000-0000-4000-8000-d1' || lpad((1 + (n - 1) * 4)::text, 10, '0'))::uuid,
  (array['Rosa Iparraguirre','Hugo Delgado','Lucia Bermudez','Tomas Alvarado','Carmen Ruiz','Victor Peralta'])[1 + n % 6],
  'contacto' || n || '@miquimica.demo',
  '+51 9' || lpad((20000000 + n * 211)::text, 8, '0'),
  (array['Compras','Administracion','Logistica','Direccion'])[1 + n % 4],
  n % 3 = 1
from generate_series(1, 7) as g(n)
on conflict (id) do nothing;

insert into public.customer_external_ids (id, organization_id, company_id, customer_id, system_code, external_id, notes)
select
  ('d0000000-0000-4000-8000-d4' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  ('d0000000-0000-4000-8000-d1' || lpad((1 + (n - 1) * 4)::text, 10, '0'))::uuid,
  (array['sap','odoo','crm'])[1 + n % 3],
  'EXT-' || lpad((5000 + n * 13)::text, 6, '0'),
  'Alta sincronizada desde el ERP'
from generate_series(1, 6) as g(n)
on conflict (id) do nothing;

insert into public.business_accounts (id, organization_id, company_id, customer_id, code, name, requires_approval, approval_threshold, purchase_order_required, notes)
select
  ('d0000000-0000-4000-8000-d5' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  c.id,
  'B2B-' || lpad(n::text, 3, '0'),
  c.name,
  n % 2 = 0,
  case when n % 2 = 0 then 2500.00 else null end,
  n % 3 = 0,
  'Cuenta de empresa dada de alta para la demo'
from (
  select id, name, row_number() over (order by code) as n
  from public.customers
  where organization_id = 'd0000000-0000-4000-8000-000000000001' and kind = 'company'
) c
on conflict (id) do nothing;

insert into public.business_account_users (id, organization_id, company_id, business_account_id, user_id, email, role, spending_limit, status)
select
  ('d0000000-0000-4000-8000-d6' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  ('d0000000-0000-4000-8000-d5' || lpad((1 + (n - 1) % 7)::text, 10, '0'))::uuid,
  ('d0000000-0000-4000-8000-e9' || lpad(n::text, 10, '0'))::uuid,
  'comprador' || lpad(n::text, 2, '0') || '@miquimica.demo',
  (array['admin','buyer','approver','viewer'])[1 + n % 4]::business_role,
  case when n % 4 = 1 then 1500.00 else null end,
  (array['active','invited','revoked'])[1 + n % 3]::member_status
from generate_series(1, 12) as g(n)
on conflict (id) do nothing;

insert into public.business_locations (id, organization_id, company_id, business_account_id, customer_id, code, name, address_id, is_default)
select
  ('d0000000-0000-4000-8000-d7' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  ba.id, ba.customer_id,
  'SEDE-' || lpad(n::text, 2, '0'),
  (array['Sede central','Almacen','Botica','Consultorio'])[1 + n % 4],
  null,
  n % 3 = 1
from (
  select id, customer_id, row_number() over (order by code) as n
  from public.business_accounts
  where organization_id = 'd0000000-0000-4000-8000-000000000001'
) ba
on conflict (id) do nothing;

insert into public.approval_rules (id, organization_id, company_id, business_account_id, name, min_amount, approver_role, is_active)
select
  ('d0000000-0000-4000-8000-d8' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  ba.id,
  (array['Aprobacion sobre 1.000','Aprobacion sobre 5.000','Visto bueno de direccion'])[1 + n % 3],
  (array[1000, 5000, 12000])[1 + n % 3],
  (array['approver','admin','approver'])[1 + n % 3]::business_role,
  n % 5 <> 0
from (
  select id, row_number() over (order by code) as n
  from public.business_accounts
  where organization_id = 'd0000000-0000-4000-8000-000000000001'
) ba
on conflict (id) do nothing;


-- ===== Precios: listas, articulos y asignaciones ============================

insert into public.price_lists (id, organization_id, company_id, store_id, code, name, currency, priority, valid_from, valid_to, is_active, notes) values
  ('d0000000-0000-4000-8000-f00000000301','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','base','Tarifa base','PEN',0, now() - interval '1 year', null, true,'La que se aplica cuando no hay otra'),
  ('d0000000-0000-4000-8000-f00000000302','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','mayorista','Tarifa mayorista','PEN',50, now() - interval '6 months', null, true,'Desde 4 unidades'),
  ('d0000000-0000-4000-8000-f00000000303','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','convenio','Tarifa convenio','PEN',80, now() - interval '3 months', null, true,'Clinicas y consultorios con convenio'),
  ('d0000000-0000-4000-8000-f00000000304','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','salud-2025','Campana Salud 2025','PEN',90, now() - interval '9 months', now() - interval '7 months', false,'Caducada: se deja para ver el estado')
on conflict (id) do nothing;

insert into public.price_list_items (id, organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price, compare_at_price)
select
  ('d0000000-0000-4000-8000-e1' || lpad((row_number() over (order by pl.code, p.sku))::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1',
  pl.id, p.id,
  case pl.code when 'mayorista' then 4 when 'convenio' then 10 else 1 end,
  round(p.price * (case pl.code when 'mayorista' then 0.88 when 'convenio' then 0.80 else 1.00 end), 2),
  case when pl.code <> 'base' then p.price else null end
from public.price_lists pl
cross join public.products p
where pl.store_id = 'd0000000-0000-4000-8000-0000000000a1'
  and pl.code in ('base','mayorista','convenio')
  and p.store_id = 'd0000000-0000-4000-8000-0000000000a1'
  and p.status = 'published'
  -- Misma leccion que en las existencias: el id sale de un `row_number()` sobre
  -- el catalogo, y en cuanto el catalogo cambia el mismo par (tarifa, producto)
  -- sale con otro id. La idempotencia tiene que mirar la clave NATURAL.
  and not exists (
    select 1 from public.price_list_items pli
     where pli.price_list_id = pl.id
       and pli.product_id    = p.id
       and pli.uom_id is null
       and pli.min_quantity  = case pl.code when 'mayorista' then 4 when 'convenio' then 10 else 1 end
  )
on conflict (id) do nothing;

insert into public.price_list_assignments (id, organization_id, company_id, store_id, price_list_id, scope, segment_id, is_active) values
  ('d0000000-0000-4000-8000-f00000000311','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000301','store',null,true),
  ('d0000000-0000-4000-8000-f00000000312','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000302','segment','d0000000-0000-4000-8000-f00000000202',true),
  ('d0000000-0000-4000-8000-f00000000313','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000303','segment','d0000000-0000-4000-8000-f00000000204',true)
on conflict (id) do nothing;


-- ===== Pagos: metodos y cobros ==============================================

-- Los tres medios de la botica son MANUALES y `provider_code` va en null a
-- proposito: el unico adaptador de pasarela que existe en el repositorio es
-- `sandbox` (`_shared/payments/registry.ts`). Una fila que nombre un conector
-- no desplegado no cobra: levanta `CONECTOR_NO_DESPLEGADO` en el momento de
-- cobrar, o sea con el comprador delante. Mejor decir «coordinamos el pago»
-- desde el principio, que es ademas como funciona una botica de barrio.
--
-- La tarjeta se queda INACTIVA por lo mismo: en cuanto exista un adaptador de
-- verdad, es encenderla y poner su `provider_code`.
--
-- Desde 20260928100000 toda tienda nace con medios de pago, metodos de entrega,
-- zonas y tarifas por defecto (trigger `stores_default_payment_delivery`). La
-- botica trae los suyos, con uuid fijo: se retiran los sembrados, que chocarian
-- por codigo. Solo se borran filas SIN uuid fijo de demo y con codigo de los
-- valores por defecto, asi que sobre una base ya cargada no borra nada.
delete from public.delivery_rates
 where store_id = 'd0000000-0000-4000-8000-0000000000a1'
   and id::text not like 'd0000000-0000-4000-8000-f%'
   and delivery_method_id in (
         select m.id from public.delivery_methods m
          where m.store_id = 'd0000000-0000-4000-8000-0000000000a1'
            and m.id::text not like 'd0000000-0000-4000-8000-f%'
            and m.code in ('estandar', 'express', 'agencia', 'reparto-propio', 'recojo'));
delete from public.delivery_methods
 where store_id = 'd0000000-0000-4000-8000-0000000000a1'
   and id::text not like 'd0000000-0000-4000-8000-f%'
   and code in ('estandar', 'express', 'agencia', 'reparto-propio', 'recojo');
delete from public.delivery_zones
 where store_id = 'd0000000-0000-4000-8000-0000000000a1'
   and id::text not like 'd0000000-0000-4000-8000-f%'
   and code in ('lima-callao', 'resto-peru');
delete from public.payment_methods
 where store_id = 'd0000000-0000-4000-8000-0000000000a1'
   and id::text not like 'd0000000-0000-4000-8000-f%'
   and code in ('transferencia', 'yape', 'plin', 'contraentrega', 'credito');

insert into public.payment_methods (id, organization_id, company_id, store_id, code, kind, display_name, provider_code, capture_mode, is_active, position, instructions) values
  ('d0000000-0000-4000-8000-f00000000401','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','tarjeta','card','Tarjeta de credito o debito',null,'manual',false,40,'Pendiente de conectar la pasarela'),
  ('d0000000-0000-4000-8000-f00000000402','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','yape','wallet','Yape',null,'manual',true,10,'Yapea al 999 111 222 (MiQuimica) y envia la captura al confirmar el pedido.'),
  ('d0000000-0000-4000-8000-f00000000403','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','transferencia','bank_transfer','Transferencia bancaria',null,'manual',true,20,'BCP soles 191-0000000-0-00 a nombre de MiQuimica SAC. Envia el voucher a pagos@miquimica.demo.'),
  ('d0000000-0000-4000-8000-f00000000404','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','contraentrega','cash','Pago en efectivo',null,'manual',true,30,'Paga en efectivo al recibir el pedido o al recogerlo en la botica.'),
  ('d0000000-0000-4000-8000-f00000000405','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','credito-b2b','credit','Credito empresa',null,'manual',true,50,'Requiere cuenta B2B aprobada')
on conflict (id) do nothing;

insert into public.payment_intents (id, organization_id, company_id, store_id, order_id, payment_method_id, provider_code, currency, amount, amount_authorized, amount_captured, status, capture_mode, idempotency_key, provider_reference, authorized_at, captured_at, last_error_code)
select
  ('d0000000-0000-4000-8000-e2' || lpad(o.n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1',
  o.id,
  (array['d0000000-0000-4000-8000-f00000000401','d0000000-0000-4000-8000-f00000000402','d0000000-0000-4000-8000-f00000000403'])[1 + o.n % 3]::uuid,
  (array['libelula','bcp',null])[1 + o.n % 3],
  o.currency, o.grand_total,
  case when o.payment_status = 'paid' then o.grand_total else 0 end,
  case when o.payment_status = 'paid' then o.grand_total else 0 end,
  case o.payment_status when 'paid' then 'captured' when 'voided' then 'cancelled' else 'open' end::payment_intent_status,
  case when o.n % 3 = 2 then 'manual' else 'automatic' end::payment_capture_mode,
  'demo-' || o.order_number,
  case when o.payment_status = 'paid' then 'ch_demo_' || lpad(o.n::text, 6, '0') else null end,
  case when o.payment_status = 'paid' then o.placed_at else null end,
  case when o.payment_status = 'paid' then o.placed_at else null end,
  case when o.n = 3 then 'card_declined' else null end
from (
  select *, row_number() over (order by order_number) as n
  from public.orders where store_id = 'd0000000-0000-4000-8000-0000000000a1'
) o
on conflict (id) do nothing;


-- ===== Entregas: metodos, zonas, tarifas, puntos y devoluciones =============

insert into public.delivery_methods (id, organization_id, company_id, store_id, code, strategy, display_name, description, provider_code, sourcing, lead_time_min_days, lead_time_max_days, requires_window, is_active, position) values
  ('d0000000-0000-4000-8000-f00000000501','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','estandar','ship','Envio estandar','Entrega a domicilio en 3 a 5 dias','drivein','store_priority',3,5,false,true,10),
  ('d0000000-0000-4000-8000-f00000000502','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','express','ship','Envio express','Entrega en 24 horas en Lima','sandbox_carrier','single_warehouse_atp',1,1,false,true,20),
  ('d0000000-0000-4000-8000-f00000000503','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','recojo','pickup','Recojo en botica','Listo en 1 hora en la botica de Miraflores',null,'store_priority',0,1,false,true,30),
  ('d0000000-0000-4000-8000-f00000000504','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','reparto-propio','local_delivery','Reparto propio','Moto de la botica, con franja horaria',null,'store_priority',2,4,true,false,40)
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, company_id, store_id, code, name, country, regions, postal_prefixes, priority, is_active) values
  ('d0000000-0000-4000-8000-f00000000511','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','lima-metro','Lima metropolitana','PE', array['Lima'], array['15'],10,true),
  ('d0000000-0000-4000-8000-f00000000512','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','provincias','Provincias','PE', array['Arequipa','Cusco','La Libertad'], array['04','08','13'],20,true),
  ('d0000000-0000-4000-8000-f00000000513','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','selva','Selva','PE', array['Loreto','Ucayali'], array['16','25'],30,false),
  -- Zona de RESPALDO: sin regiones ni prefijos, cubre todo el pais
  -- (`ebim.resolve_delivery_zone`: sin lista declarada, la zona cubre todo lo
  -- anterior). Existe porque el formulario de la vitrina no obliga a poner
  -- region ni codigo postal, y sin ella una direccion de Lima escrita solo con
  -- la ciudad se quedaba sin un solo metodo de envio — que es exactamente lo
  -- que le pasa al comprador que no rellena campos opcionales. La zona de Lima
  -- le sigue ganando: el orden pone delante a la que nombra la region.
  ('d0000000-0000-4000-8000-f00000000514','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','peru','Resto del pais','PE', array[]::text[], array[]::text[],90,true)
on conflict (id) do nothing;

insert into public.delivery_rates (id, organization_id, company_id, store_id, delivery_method_id, zone_id, currency, base_amount, per_item_amount, free_over_subtotal, priority, is_active) values
  ('d0000000-0000-4000-8000-f00000000521','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000501','d0000000-0000-4000-8000-f00000000511','PEN',12.00,1.00,120.00,10,true),
  ('d0000000-0000-4000-8000-f00000000522','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000501','d0000000-0000-4000-8000-f00000000512','PEN',25.00,2.00,200.00,20,true),
  ('d0000000-0000-4000-8000-f00000000523','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000502','d0000000-0000-4000-8000-f00000000511','PEN',19.00,2.00,null,10,true),
  ('d0000000-0000-4000-8000-f00000000524','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000503',null,'PEN',0.00,0.00,null,5,true),
  -- Tarifas de la zona de respaldo. Una zona sin tarifa no ofrece nada, asi
  -- que anadir la zona sin esto no habria arreglado nada.
  ('d0000000-0000-4000-8000-f00000000525','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000501','d0000000-0000-4000-8000-f00000000514','PEN',25.00,2.00,200.00,90,true),
  ('d0000000-0000-4000-8000-f00000000526','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000502','d0000000-0000-4000-8000-f00000000514','PEN',35.00,3.00,null,90,true)
on conflict (id) do nothing;

insert into public.pickup_points (id, organization_id, company_id, store_id, code, name, address, zone_id, warehouse_id, contact_phone, is_active, position) values
  ('d0000000-0000-4000-8000-f00000000531','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','miraflores','Botica Miraflores','{"line1":"Av. Larco 1200","city":"Lima"}'::jsonb,'d0000000-0000-4000-8000-f00000000511','d0000000-0000-4000-8000-f00000000102','+51 987654321',true,10),
  ('d0000000-0000-4000-8000-f00000000532','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','san-isidro','Botica San Isidro','{"line1":"Av. Camino Real 456","city":"Lima"}'::jsonb,'d0000000-0000-4000-8000-f00000000511',null,'+51 987654322',true,20),
  ('d0000000-0000-4000-8000-f00000000533','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','arequipa-centro','Botica Arequipa Centro','{"line1":"Calle Mercaderes 120","city":"Arequipa"}'::jsonb,'d0000000-0000-4000-8000-f00000000512','d0000000-0000-4000-8000-f00000000103','+51 987654323',false,30)
on conflict (id) do nothing;

insert into public.return_reasons (id, organization_id, company_id, store_id, code, label, description, requires_evidence, restock_default, is_active, position) values
  ('d0000000-0000-4000-8000-f00000000541','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','danado','Llego danado','Rotura o golpe en el transporte',true,false,true,10),
  ('d0000000-0000-4000-8000-f00000000542','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','vencimiento','Vencimiento corto','Llego con la fecha de vencimiento demasiado proxima',true,false,true,20),
  ('d0000000-0000-4000-8000-f00000000543','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','tarde','Llego tarde','Fuera del plazo comprometido',false,true,true,30),
  ('d0000000-0000-4000-8000-f00000000544','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','equivocado','Producto equivocado','No corresponde al pedido',true,true,true,40)
-- Sin destino: desde 20261111130000 la tienda ya nace con motivos de serie y
-- `equivocado` coincide con uno; el de la demo no debe romper la carga.
on conflict do nothing;

-- Devoluciones en estados distintos: una cola donde todo esta resuelto no deja
-- ver los tabs de estado ni el color de cada uno.
insert into public.return_requests (id, organization_id, company_id, store_id, order_id, rma_number, state, resolution, source, reason_code, reason_label, customer_email, customer_note, currency, refund_amount, decided_at, decision_note)
select
  ('d0000000-0000-4000-8000-e3' || lpad(o.n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1',
  o.id,
  'RMA-' || to_char(now(), 'YYYY') || '-' || lpad(o.n::text, 4, '0'),
  (array['requested','approved','in_transit','received','completed','rejected'])[1 + o.n % 6]::return_state,
  (array['refund','exchange','store_credit'])[1 + o.n % 3]::return_resolution,
  (array['storefront','backoffice'])[1 + o.n % 2]::return_source,
  (array['danado','vencimiento','tarde','equivocado'])[1 + o.n % 4],
  (array['Llego danado','Vencimiento corto','Llego tarde','Producto equivocado'])[1 + o.n % 4],
  coalesce(o.customer_email, 'comprador@miquimica.demo'),
  'Solicitud creada para la demo',
  o.currency,
  round(o.grand_total * 0.35, 2),
  -- `decided_at` solo puede faltar mientras la devolucion esta SOLICITADA
  -- (indice 1, o sea n % 6 = 0). En cuanto pasa de ahi la base exige la fecha
  -- de la decision, y con razon: un estado posterior sin fecha es una
  -- devolucion que nadie sabe cuando se resolvio.
  case when o.n % 6 = 0 then null else now() - (o.n || ' days')::interval end,
  case when o.n % 6 = 5 then 'Fuera de plazo de devolucion' else null end
from (
  select *, row_number() over (order by order_number) as n
  from public.orders where store_id = 'd0000000-0000-4000-8000-0000000000a1'
) o
on conflict (id) do nothing;


-- ===== Promociones, cupones y tarjetas regalo ===============================

insert into public.promotions (id, organization_id, company_id, store_id, code, name, description, kind, status, priority, requires_coupon, value_percent, value_amount, min_subtotal, valid_from, valid_to, usage_limit, usage_count) values
  ('d0000000-0000-4000-8000-f00000000601','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','bienvenida','Bienvenida 10%','Primer pedido de la vitrina','percentage','active',10,true,10,null,60.00, now() - interval '2 months', now() + interval '6 months',500,37),
  ('d0000000-0000-4000-8000-f00000000602','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','vitaminas-15','Vitaminas -15%','Descuento sobre la categoria de vitaminas','percentage','active',20,false,15,null,null, now() - interval '1 month', now() + interval '2 months',null,12),
  ('d0000000-0000-4000-8000-f00000000603','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','ahorro-150','20 soles sobre 150','Descuento fijo por compra grande','fixed_amount','paused',30,false,null,20.00,150.00, now() - interval '3 months', null,null,4),
  ('d0000000-0000-4000-8000-f00000000604','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','salud-2025','Semana de la Salud 2025','Campana cerrada, se deja para ver el estado','percentage','archived',40,true,25,null,null, now() - interval '10 months', now() - interval '9 months',null,214),
  ('d0000000-0000-4000-8000-f00000000605','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','preview-invierno','Preview invierno','Todavia sin publicar','percentage','draft',50,false,12,null,null, now() + interval '1 month', now() + interval '4 months',null,0)
on conflict (id) do nothing;

insert into public.promotion_scopes (id, organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, category_id, is_exclusion) values
  ('d0000000-0000-4000-8000-f00000000611','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000601','percentage','all',null,false),
  ('d0000000-0000-4000-8000-f00000000612','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000602','percentage','category','d0000000-0000-4000-8000-0000000000b3',false),
  ('d0000000-0000-4000-8000-f00000000613','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000602','percentage','category','d0000000-0000-4000-8000-0000000000b4',true)
on conflict (id) do nothing;

-- `code_normalized` NO se escribe: es una columna generada. Que la calcule la
-- base es lo que garantiza que «MIQ001» y «miq001» sean el mismo cupon.
insert into public.coupons (id, organization_id, company_id, store_id, promotion_id, code, is_active, valid_from, valid_to, usage_limit, usage_limit_per_customer, usage_count, notes)
select
  ('d0000000-0000-4000-8000-e4' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1',
  case when n % 2 = 0 then 'd0000000-0000-4000-8000-f00000000601' else 'd0000000-0000-4000-8000-f00000000604' end::uuid,
  'MIQ' || lpad(n::text, 3, '0'),
  n % 5 <> 0,
  now() - interval '2 months',
  now() + interval '4 months',
  100, 1, (n * 7) % 40,
  null
from generate_series(1, 14) as g(n)
on conflict (id) do nothing;

insert into public.gift_cards (id, organization_id, company_id, store_id, code, currency, initial_amount, balance, status, issued_to_email, expires_at, notes)
select
  ('d0000000-0000-4000-8000-e5' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1',
  'REGALO' || lpad((n * 137)::text, 8, '0'),
  'PEN',
  (array[100, 200, 300, 500])[1 + n % 4],
  case when n % 4 = 3 then 0 else (array[100, 200, 300, 500])[1 + n % 4] - (n * 11) % 60 end,
  case when n % 4 = 3 then 'depleted' else 'active' end::gift_card_status,
  'regalo' || lpad(n::text, 2, '0') || '@miquimica.demo',
  now() + interval '1 year',
  null
from generate_series(1, 9) as g(n)
on conflict (id) do nothing;


-- ===== Contenido: paginas, bloques y sinonimos ==============================

insert into public.content_pages (id, organization_id, company_id, store_id, slug, title, kind, status, priority, show_in_nav, nav_position, seo_title, seo_description) values
  ('d0000000-0000-4000-8000-f00000000701','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','inicio','Portada','home','published',10,false,0,'MiQuimica','Botica en linea con entrega el mismo dia en Lima'),
  ('d0000000-0000-4000-8000-f00000000702','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','nosotros','Quienes somos','landing','published',20,true,1,'Quienes somos','La botica y el equipo que la atiende'),
  ('d0000000-0000-4000-8000-f00000000703','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','envios-y-devoluciones','Envios y devoluciones','legal','published',30,true,2,'Envios y devoluciones','Plazos, costes y como devolver'),
  ('d0000000-0000-4000-8000-f00000000704','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','terminos','Terminos y condiciones','legal','published',40,true,3,'Terminos','Condiciones de venta'),
  ('d0000000-0000-4000-8000-f00000000705','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','campana-invierno','Campana de invierno','landing','draft',50,false,0,null,null)
on conflict (id) do nothing;

-- El bloque `rich_text` obliga a llevar `body`, y el `body` NO es HTML: es el
-- array plano de nodos de `src/domain/content.ts`. Guardar aqui una cadena con
-- etiquetas seria meter por la puerta de atras justo lo que ese diseno evita.
insert into public.content_blocks (id, organization_id, company_id, store_id, page_id, block_type, position, title, subtitle, body, cta_label, cta_href, category_id, item_limit, is_active) values
  ('d0000000-0000-4000-8000-f00000000711','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000701','hero',10,'Tu botica en linea','Medicamentos, cuidado personal y suplementos',null,'Ver catalogo','/s/miquimica',null,8,true),
  ('d0000000-0000-4000-8000-f00000000712','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000701','product_collection',20,'Lo mas vendido',null,null,null,null,null,4,true),
  ('d0000000-0000-4000-8000-f00000000713','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000701','category_collection',30,'Por categoria',null,null,null,null,null,6,true),
  ('d0000000-0000-4000-8000-f00000000714','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000702','rich_text',10,'La botica',null,
    '[{"type":"heading","level":2,"text":"Una botica de barrio, tambien en linea"},{"type":"paragraph","text":"Atendemos en Miraflores desde 1998 y despachamos a todo Lima el mismo dia. Cada pedido lo revisa un quimico farmaceutico antes de salir."},{"type":"list","items":["Cadena de frio para lo que la necesita","Receta validada antes de despachar los productos que la exigen","Lotes y vencimientos trazados en cada despacho"]},{"type":"quote","text":"Si tienes dudas sobre un tratamiento, preguntanos: para eso esta el mostrador."}]'::jsonb,
    null,null,null,8,true),
  ('d0000000-0000-4000-8000-f00000000715','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-f00000000705','banner',10,'Campana de invierno','Hasta -25%',null,'Ver','/s/miquimica',null,8,false)
on conflict (id) do nothing;

insert into public.content_block_items (id, organization_id, company_id, store_id, block_id, block_type, item_kind, product_id, position)
select
  ('d0000000-0000-4000-8000-e6' || lpad((row_number() over (order by p.sku))::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1',
  'd0000000-0000-4000-8000-f00000000712','product_collection','product', p.id,
  (row_number() over (order by p.sku))::int * 10
from public.products p
where p.store_id = 'd0000000-0000-4000-8000-0000000000a1' and p.status = 'published'
limit 4
on conflict (id) do nothing;

insert into public.search_synonyms (id, organization_id, company_id, store_id, term, expansions, is_active) values
  ('d0000000-0000-4000-8000-f00000000721','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','paracetamol', array['acetaminofen','antipiretico','analgesico'],true),
  ('d0000000-0000-4000-8000-f00000000722','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','ibuprofeno', array['antiinflamatorio','analgesico'],true),
  ('d0000000-0000-4000-8000-f00000000723','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','vitamina c', array['acido ascorbico','vitamina'],true),
  ('d0000000-0000-4000-8000-f00000000724','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','mascarilla', array['tapaboca','barbijo','kn95'],true),
  ('d0000000-0000-4000-8000-f00000000725','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','alcohol', array['antiseptico','desinfectante'],false)
on conflict (id) do nothing;


-- ===== Integraciones ========================================================
-- `secret_ref` NO es un secreto: es el NOMBRE de la variable donde vive, que es
-- justo lo que permite que esta tabla se pueda leer sin filtrar nada.

insert into public.tenant_integrations (id, organization_id, company_id, provider_code, direction, is_active, config, secret_ref) values
  ('d0000000-0000-4000-8000-f00000000801','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','libelula','outbound',true,'{"environment":"sandbox"}'::jsonb,'LIBELULA_SANDBOX_KEY'),
  ('d0000000-0000-4000-8000-f00000000802','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','drivein','bidirectional',true,'{"account":"demo-miquimica"}'::jsonb,'DRIVEIN_API_CREDENTIAL'),
  ('d0000000-0000-4000-8000-f00000000803','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','sap_s4','inbound',false,'{"company_code":"MQ01"}'::jsonb,'SAP_BRIDGE_TOKEN')
on conflict (id) do nothing;

insert into public.webhook_endpoints (id, organization_id, company_id, store_id, name, url, secret_ref, api_version, description, is_active, max_attempts) values
  ('d0000000-0000-4000-8000-f00000000811','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','erp-pedidos','https://erp.miquimica.demo/hooks/pedidos','WEBHOOK_ERP_PEDIDOS','v1','Alta de pedido en el ERP',true,6),
  ('d0000000-0000-4000-8000-f00000000812','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','crm-clientes','https://crm.miquimica.demo/hooks/clientes','WEBHOOK_CRM_CLIENTES','v1','Sincroniza altas de cliente',true,4),
  ('d0000000-0000-4000-8000-f00000000813','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','bi-eventos','https://bi.miquimica.demo/collect','WEBHOOK_BI_EVENTOS','v1','Volcado analitico, caido a proposito',false,3)
on conflict (id) do nothing;

-- Credenciales de la API de socio. El hash y la pista son literales de relleno:
-- no abren nada, y estan aqui solo para que la pantalla tenga filas.
insert into public.api_clients (id, organization_id, company_id, name, description, client_id, secret_hash, secret_hint, scopes, is_active, rate_limit_per_minute)
select
  ('d0000000-0000-4000-8000-e7' || lpad(n::text, 10, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1',
  (array['Integracion ERP','Portal de socios','Panel de BI'])[n],
  (array['Alta y consulta de pedidos','Consulta de catalogo y stock','Solo lectura para informes'])[n],
  'ec_' || repeat(lpad(to_hex(n), 2, '0'), 16),
  repeat(lpad(to_hex(n), 2, '0'), 32),
  repeat(lpad(to_hex(n), 2, '0'), 3),
  (select array_agg(s) from (select unnest(ebim.api_scope_catalog()) as s limit 2) x),
  n < 3,
  (array[240, 120, 60])[n]
from generate_series(1, 3) as g(n)
on conflict (id) do nothing;


-- ===== Marca y familia de cada producto =====================================
-- Sin esto la faceta de marcas vuelve VACIA y el panel de filtros de la vitrina
-- se queda con media cara: las marcas existian como catalogo, pero ningun
-- producto apuntaba a ninguna.

update public.products p
   set brand_id = b.id
  from public.brands b
 where p.store_id = 'd0000000-0000-4000-8000-0000000000a1'
   and p.brand_id is null
   and b.organization_id = 'd0000000-0000-4000-8000-000000000001'
   and b.code = case
         when p.sku like 'VIT-%' then 'vitalis'
         when p.sku like 'CPE-%' then 'dermacare'
         else 'miquimica'
       end;

update public.products p
   set family_id = f.id
  from public.product_families f
 where p.store_id = 'd0000000-0000-4000-8000-0000000000a1'
   and p.family_id is null
   and f.organization_id = 'd0000000-0000-4000-8000-000000000001'
   and f.code = case
         when p.sku like 'MED-%' then 'medicamentos'
         when p.sku like 'VIT-%' then 'suplementos'
         else 'cuidado'
       end;
