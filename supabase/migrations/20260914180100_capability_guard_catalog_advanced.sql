-- =============================================================================
-- Cierre · D3 (2/4) — `catalog.advanced`: candado en las once tablas del PIM
--
-- Fallback y razonamiento general: cabecera de 20260914180000.
--
-- ## Qué se cierra
--
-- Las once tablas de P03 (20260827170000) —vocabulario de sociedad (`brands`,
-- `product_families`, `attributes`, `attribute_values`, `units_of_measure`) y
-- lo que cuelga del producto (`product_variants`, `variant_attribute_values`,
-- `product_attribute_values`, `product_uoms`, `bundle_items`,
-- `product_relations`)— se escriben por PostgREST directo desde el backoffice
-- (`/app/pim` y las pestañas avanzadas del cajón de producto), sin RPC. La
-- autoridad son sus policies, y es ahí donde entra
-- `ebim.has_capability(organization_id, company_id, 'catalog.advanced')`.
--
-- ## La regla, igual para las once
--
-- · INSERT y UPDATE (fila nueva) exigen rol de catálogo Y la capacidad.
-- · En las tablas con `is_active`, una fila INACTIVA pasa sin capacidad. Es la
--   misma forma que 160000 dio a la marca blanca («not white_label or
--   has_capability»): una sociedad a la que se le retira el addon tiene que
--   poder APAGAR lo que ya tiene —una variante que no quiere seguir vendiendo—,
--   y apagar no le da nada del módulo.
-- · UPDATE (fila vieja) y DELETE exigen solo el rol: retirar datos nunca
--   concede el módulo, y dejar a un tenant sin poder deshacer su catálogo
--   avanzado sería retenerle el dato para cobrarle.
-- · LECTURA no se toca (ADR 017 «Cómo se cierra» §2): apagar un addon no hace
--   desaparecer lo que el tenant ya generó pagando, y la vitrina, la resolución
--   de precios y `create_order` siguen leyendo variantes, unidades y kits que
--   ya existen — un pedido no se rompe porque el comercio deje de pagar el PIM.
--
-- ## Qué NO se cierra aquí, a propósito
--
-- · `products.kind` (`variant` | `bundle`) vive en `products`, que es baseline.
--   Sin poder escribir variantes ni recetas, marcar el tipo no da nada.
-- · Las funciones que LEEN el PIM (`build_quote`, `resolve_prices`,
--   `create_order`, `product_relations_for_slug`...) son del camino del
--   comprador y del checkout, fuera del alcance del candado y del carril.
-- =============================================================================

do $migration$
declare
  v_roles constant text :=
    'ebim.has_role(organization_id, company_id, array[''owner'',''admin'',''catalog'']::public.app_role[])';
  v_cap constant text :=
    'ebim.has_capability(organization_id, company_id, ''catalog.advanced'')';
  v_table  text;
  v_active boolean;
  v_check  text;
begin
  for v_table, v_active in
    select t.name, t.has_active
      from (values
        ('brands',                   true),
        ('product_families',         true),
        ('attributes',               true),
        ('attribute_values',         true),
        ('units_of_measure',         true),
        ('product_variants',         true),
        ('variant_attribute_values', false),
        ('product_attribute_values', false),
        ('product_uoms',             false),
        ('bundle_items',             false),
        ('product_relations',        false)
      ) as t(name, has_active)
  loop
    -- Comprobación defensiva: si una tabla dejara de tener `is_active`, la
    -- policy compilaría contra una columna inexistente y la migración entera
    -- fallaría con un mensaje que no dice cuál.
    if v_active <> exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = v_table and c.column_name = 'is_active'
    ) then
      raise exception 'D3: la forma de %.is_active no es la esperada', v_table;
    end if;

    v_check := case when v_active
                    then format('%s and (not is_active or %s)', v_roles, v_cap)
                    else format('%s and %s', v_roles, v_cap) end;

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_catalog', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_update_catalog', v_table);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      v_table || '_insert_catalog', v_table, v_check);

    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      v_table || '_update_catalog', v_table, v_roles, v_check);

    -- `<tabla>_delete_catalog` y `<tabla>_select_*` se quedan como estaban.
  end loop;
end;
$migration$;
