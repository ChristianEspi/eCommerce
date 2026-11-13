#!/usr/bin/env node
/**
 * Catalogo de MiQuimica (Quimica Suiza) con datos de verdad: descripciones,
 * fichas tecnicas, variantes y kits (pedido del operador, 2026-11-13).
 *
 *   node scripts/enriquecer-miquimica/index.mjs           revisa y cuenta, NO escribe
 *   node scripts/enriquecer-miquimica/index.mjs --apply   escribe en el Supabase del .env (hoy: QAS)
 *
 * Idempotente: se puede correr las veces que haga falta.
 *
 * ## Que hace, en orden
 *
 *  1. Vocabulario: atributos de ficha (principio activo, forma farmaceutica,
 *     via, condicion de venta...) y ejes de variante (concentracion,
 *     presentacion, sabor, tono, formato). Apaga los atributos de calzado que
 *     dejaron las pruebas de zapatillas. Va por el importador del backoffice
 *     COMO el owner, con sus mismas validaciones.
 *  2. Variantes: cada grupo de `grupos.mjs` pasa a ser UN producto con
 *     variantes. Los productos sueltos NO se borran: se archivan y su SKU pasa
 *     a `…-ARCH`, para que la variante herede el SKU del ERP y los pedidos
 *     viejos sigan apuntando a algo. La variante se lleva su precio, su EAN,
 *     sus existencias, sus fotos y los kits, listas y promociones que la usaban.
 *  3. Kits: rehace «ki-Limpieza» y da de alta los de `kits.mjs`.
 *  4. Fichas: descripcion, destacados, GTIN y ficha tecnica de cada producto
 *     publicado (`fichas.mjs`).
 *  5. Limpieza: borra los 201 productos de calzado (`ZAP…`, «Zapatillas
 *     Puma»), que no estan en ninguna tienda ni en ningun pedido.
 *
 * Los productos de demo (`MED-`, `CPE-`, `VIT-`, `BOT-`) no se tocan: estan
 * escritos a mano y algunos ensenan un caso (descontinuado, ficha pendiente).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { norm } from './farmacos.mjs'
import { fichaDe } from './fichas.mjs'
import { EJES, GRUPOS } from './grupos.mjs'
import { KITS } from './kits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
/** `--grupos=N`: crea solo los N primeros grupos pendientes (para probar uno antes que todos). */
const LIMITE = Number(process.argv.find((a) => a.startsWith('--grupos='))?.split('=')[1] ?? Infinity)

const ORG = 'd0000000-0000-4000-8000-000000000001'
const COMPANY = 'd0000000-0000-4000-8000-0000000000c1'
const STORE_SLUG = 'miquimica'
const OWNER_EMAIL = 'emoreno@grupoebim.com'

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]

async function sql(query) {
  for (let intento = 1; ; intento++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    if (r.ok) return cuerpo
    // La API de gestion limita la cadencia: reintentar, no fallar.
    if ((r.status === 429 || r.status >= 500) && intento < 5) {
      await new Promise((ok) => setTimeout(ok, 2000 * intento))
      continue
    }
    throw new Error(`SQL ${r.status}: ${JSON.stringify(cuerpo).slice(0, 1500)}`)
  }
}

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`

let OWNER_ID
function comoOwner(query) {
  const claims = {
    sub: OWNER_ID,
    email: OWNER_EMAIL,
    role: 'authenticated',
    org_id: ORG,
    companies: [{ id: COMPANY, role: 'owner' }],
    active_company: COMPANY,
    apps: ['ecommerce'],
  }
  return sql(`set local role authenticated;
    select set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true);
    ${query}`)
}

/** Si el importador no aplico, revienta la transaccion entera con su informe dentro. */
const exigirAplicado = (llamada) =>
  `select case when (r->>'applied')::boolean then r
          else (('IMPORT_FALLIDO ' || (r->'rows')::text)::int)::text::jsonb end as r
     from (select ${llamada} as r) x;`

// ---------------------------------------------------------------------------
// Estado actual
// ---------------------------------------------------------------------------

async function cargar() {
  const [owner] = await sql(`select id from auth.users where lower(email) = lower(${lit(OWNER_EMAIL)})`)
  if (!owner) throw new Error(`No existe el owner ${OWNER_EMAIL}`)
  OWNER_ID = owner.id
  const [store] = await sql(`select id from public.stores where slug = ${lit(STORE_SLUG)} and company_id = ${lit(COMPANY)}`)
  const productos = await sql(`
    select p.id, p.sku, p.name, p.kind, p.description, p.custom_fields as cf, p.gtin, p.highlights,
           p.status as pstatus, sp.status as spstatus, sp.price as sprice, sp.compare_at_price as scompare,
           c.slug as catslug, b.name as brand, b.code as brandcode
      from public.products p
      left join public.store_products sp on sp.product_id = p.id and sp.store_id = ${lit(store.id)}
      left join public.categories c on c.id = sp.category_id
      left join public.brands b on b.id = p.brand_id
     where p.company_id = ${lit(COMPANY)}`)
  const atributos = await sql(`select id, code, name, data_type, is_variant_axis, is_active from public.attributes where company_id = ${lit(COMPANY)}`)
  const valores = await sql(`select av.attribute_id, av.label from public.attribute_values av join public.attributes a on a.id = av.attribute_id where a.company_id = ${lit(COMPANY)}`)
  return { storeId: store.id, productos, atributos, valores }
}

/** Busca un producto original por SKU (con o sin `-ARCH`) o por nombre exacto. */
function resolver(productos, ref) {
  if (/^[A-Z]{2,4}-/.test(ref) || /^kit-/.test(ref)) {
    const hits = productos.filter((p) => p.sku === ref || p.sku === `${ref}-ARCH`)
    if (hits.length !== 1) throw new Error(`SKU ${ref}: ${hits.length} coincidencias`)
    return hits[0]
  }
  const n = norm(ref)
  const hits = productos.filter((p) => p.kind === 'simple' && norm(p.name) === n)
  if (hits.length !== 1) throw new Error(`Nombre «${ref}»: ${hits.length} coincidencias`)
  return hits[0]
}

const skuOriginal = (p) => p.sku.replace(/-ARCH$/, '')

// ---------------------------------------------------------------------------
// 1 · Vocabulario
// ---------------------------------------------------------------------------

const FICHA = [
  { code: 'principio_activo', name: 'Principio activo', data_type: 'texto' },
  { code: 'dosis', name: 'Concentración por unidad', data_type: 'texto' },
  { code: 'forma_farmaceutica', name: 'Forma farmacéutica', data_type: 'opción', filtrable: true },
  { code: 'via_administracion', name: 'Vía de administración', data_type: 'opción', filtrable: true },
  { code: 'grupo_terapeutico', name: 'Grupo terapéutico', data_type: 'texto' },
  { code: 'condicion_venta', name: 'Condición de venta', data_type: 'opción', filtrable: true },
  { code: 'contenido_neto', name: 'Presentación', data_type: 'texto' },
  { code: 'tipo_producto', name: 'Tipo de producto', data_type: 'texto' },
  { code: 'indicado_para', name: 'Indicado para', data_type: 'texto' },
  { code: 'edad_recomendada', name: 'Edad recomendada', data_type: 'texto' },
  { code: 'modo_uso', name: 'Modo de uso', data_type: 'texto' },
]
const CALZADO = ['talla', 'color', 'material', 'genero', 'tipo', 'coleccion', 'estilo']
// `contenido` (numero en ml) y `principio` (eje) eran de la demo de botica; la
// ficha nueva los cubre con texto libre, que admite «30 tabletas» y combinaciones.
const RETIRADOS = [...CALZADO, 'contenido', 'principio']

function vocabulario(fichas) {
  const attributes = [
    ...EJES.map((e, i) => ({ code: e.code, name: e.name, data_type: 'opción', is_variant_axis: 'sí', is_filterable: 'sí', position: i + 1, is_active: 'sí' })),
    ...FICHA.map((a, i) => ({
      code: a.code,
      name: a.name,
      data_type: a.data_type,
      is_variant_axis: 'no',
      is_filterable: a.filtrable ? 'sí' : 'no',
      position: 20 + i,
      is_active: 'sí',
    })),
    ...RETIRADOS.map((code) => ({ code, is_active: 'no' })),
  ]
  const valores = new Map()
  const anadir = (code, label) => {
    if (!label) return
    if (!valores.has(code)) valores.set(code, new Set())
    valores.get(code).add(label)
  }
  for (const g of GRUPOS) for (const m of g.miembros) for (const [eje, v] of Object.entries(m.valores)) anadir(eje, v)
  for (const f of fichas.values()) {
    for (const code of ['forma_farmaceutica', 'via_administracion', 'condicion_venta']) anadir(code, f.ficha[code])
  }
  const attribute_values = [...valores.entries()].flatMap(([attribute_code, labels]) =>
    [...labels].map((label, i) => ({ attribute_code, label, position: i + 1 })),
  )
  return { brands: [], families: [], units: [], attributes, attribute_values }
}

// ---------------------------------------------------------------------------
// 2 · Variantes
// ---------------------------------------------------------------------------

function planGrupo(estado, g) {
  const miembros = g.miembros.map((m) => ({ ...m, p: resolver(estado.productos, m.ref) }))
  const padre = estado.productos.find((p) => p.sku === g.sku)
  const etiquetas = miembros.map((m) => g.ejes.map((e) => m.valores[e]).join(' · '))
  if (new Set(etiquetas).size !== etiquetas.length) throw new Error(`${g.sku}: dos miembros con los mismos valores`)
  for (const m of miembros) {
    if (m.p.sprice == null) throw new Error(`${g.sku}: ${m.p.sku} no esta publicado en la tienda`)
  }
  return { ...g, miembros, padre }
}

async function crearGrupo(estado, g) {
  const base = g.miembros[0].p
  const precioPadre = Math.min(...g.miembros.map((m) => Number(m.p.sprice)))
  const rows = g.miembros.map((m, i) => ({
    ...(i === 0
      ? {
          sku: g.sku,
          name: g.nombre,
          category_slug: base.catslug,
          brand_code: base.brandcode,
          price: precioPadre,
          status: 'publicado',
        }
      : { sku: g.sku }),
    variant_sku: skuOriginal(m.p),
    variant_price: Number(m.p.sprice),
    variant_stock: 0,
    axes: m.valores,
  }))
  const ids = g.miembros.map((m) => lit(m.p.id)).join(',')
  await comoOwner(`
    update public.products set sku = sku || '-ARCH' where id in (${ids}) and sku not like '%-ARCH';
    update public.store_products set status = 'archived' where product_id in (${ids}) and store_id = ${lit(estado.storeId)};
    update public.products set status = 'archived' where id in (${ids});
    ${exigirAplicado(`public.import_catalog_products(${lit(estado.storeId)}, ${jlit(rows)}, false)`)}
  `)
}

/**
 * Lo que la variante hereda del producto suelto. Idempotente: cada paso mira
 * si ya esta hecho. Va como servicio porque toca inventario y fotos, que el
 * importador no lleva.
 */
async function heredar(estado, g) {
  const T = `${lit(ORG)}::uuid, ${lit(COMPANY)}::uuid`
  const pares = g.miembros.map((m) => ({ miembro: m.p.id, sku: skuOriginal(m.p), ean: m.p.cf?.ean ?? null, cf: m.p.cf ?? {} }))
  const v = `(select r.miembro, r.ean, r.cf, pv.id as variant_id, pv.product_id as padre, r.orden
                from jsonb_to_recordset(${jlit(pares.map((p, i) => ({ ...p, orden: i })))})
                     as r(miembro uuid, sku text, ean text, cf jsonb, orden int)
                join public.product_variants pv on pv.company_id = ${lit(COMPANY)} and pv.sku = r.sku and pv.product_kind = 'variant')`
  await sql(`
    -- EAN y datos del ERP en la variante.
    update public.product_variants pv set
      barcode = coalesce(pv.barcode, case when v.ean ~ '^[0-9]{8,14}$' then v.ean end),
      custom_fields = pv.custom_fields || v.cf
      from ${v} v where pv.id = v.variant_id;

    -- Existencias por almacen.
    insert into public.inventory_levels (organization_id, company_id, warehouse_id, store_id, product_id, variant_id, on_hand_qty, allow_backorder, safety_stock, reorder_point)
    select ${T}, il.warehouse_id, il.store_id, v.padre, v.variant_id, il.on_hand_qty, il.allow_backorder, il.safety_stock, il.reorder_point
      from ${v} v join public.inventory_levels il on il.product_id = v.miembro and il.variant_id is null
     where not exists (select 1 from public.inventory_levels x where x.warehouse_id = il.warehouse_id
                         and x.product_id = v.padre and x.variant_id = v.variant_id);

    -- Fotos: se MUEVEN (la ruta es unica en la tabla) del suelto archivado a su
    -- variante; solo la principal del primero queda como principal del padre.
    update public.product_images i set product_id = v.padre, variant_id = v.variant_id,
           is_primary = i.is_primary and v.orden = 0
      from ${v} v where i.product_id = v.miembro;

    -- Kits, listas de precios, promociones y vitrinas que usaban el suelto.
    update public.bundle_items b set component_product_id = v.padre, component_kind = 'variant', component_variant_id = v.variant_id
      from ${v} v where b.component_product_id = v.miembro;
    update public.price_list_items x set product_id = v.padre, variant_id = v.variant_id
      from ${v} v where x.product_id = v.miembro and x.variant_id is null;
    update public.promotion_scopes x set product_id = v.padre, variant_id = v.variant_id,
           scope_kind = case when x.scope_kind = 'product' then 'variant'::public.promotion_scope_kind else x.scope_kind end
      from ${v} v where x.product_id = v.miembro and x.variant_id is null;
    update public.store_price_overrides x set product_id = v.padre
      from ${v} v where x.product_id = v.miembro and x.variant_id is null
       and not exists (select 1 from public.store_price_overrides y where y.store_id = x.store_id and y.product_id = v.padre and y.variant_id is null);
    insert into public.product_favorites (organization_id, company_id, store_id, user_id, product_id)
    select distinct ${T}, f.store_id, f.user_id, v.padre
      from ${v} v join public.product_favorites f on f.product_id = v.miembro
     where not exists (select 1 from public.product_favorites y where y.user_id = f.user_id and y.product_id = v.padre and y.store_id is not distinct from f.store_id);
  `)
}

// ---------------------------------------------------------------------------
// 3 · Kits
// ---------------------------------------------------------------------------

async function crearKits(estado, mapaVariantes) {
  const kitsCat = estado.productos.find((p) => p.sku === 'KIT-RUTINA-FACIAL')?.catslug
  const marcas = new Map((await sql(`select name, id from public.brands where company_id = ${lit(COMPANY)}`)).map((b) => [b.name, b.id]))
  const [cat] = await sql(`select id from public.categories where store_id = ${lit(estado.storeId)} and slug = ${lit(kitsCat)}`)
  const out = []
  for (const k of KITS) {
    const comps = k.componentes.map(([ref, qty]) => {
      if (typeof ref === 'object') {
        const p = resolver(estado.productos, ref.sku)
        return { product_id: p.id, kind: 'variant', variant_sku: ref.variante, qty, precio: null }
      }
      const p = resolver(estado.productos, ref)
      const m = mapaVariantes.get(p.id)
      return m
        ? { product_id: m.padre, kind: 'variant', variant_sku: skuOriginal(p), qty, precio: Number(p.sprice) }
        : { product_id: p.id, kind: p.kind, variant_sku: null, qty, precio: Number(p.sprice) }
    })
    if (comps.some((c) => c.precio === null)) {
      const [r] = await sql(`select price from public.product_variants where sku = 'MED-PAR-500-C20' and company_id = ${lit(COMPANY)}`)
      for (const c of comps) if (c.precio === null) c.precio = Number(r.price)
    }
    const suma = comps.reduce((s, c) => s + c.precio * c.qty, 0)
    const precio = Math.max(1, Math.floor(suma * (1 - k.descuento)) + 0.9)
    out.push({ sku: k.sku, precio, suma: Math.round(suma * 100) / 100 })
    if (!APPLY) continue

    const marca = marcas.get(k.marca) ?? null
    const slug = norm(k.nombre).replace(/ /g, '-').slice(0, 100)
    await sql(`
      with existente as (select id from public.products where company_id = ${lit(COMPANY)} and sku = ${lit(k.sku)}),
      nuevo as (
        insert into public.products (organization_id, company_id, store_id, sku, slug, name, description, kind, brand_id, status, published_at, category_id, price, currency, highlights)
        select ${lit(ORG)}, ${lit(COMPANY)}, ${lit(estado.storeId)}, ${lit(k.sku)}, ${lit(slug)}, ${lit(k.nombre)}, ${lit(k.descripcion)}, 'bundle', ${lit(marca)},
               'published', now(), ${lit(cat.id)}, ${precio}, 'PEN', ${lit(`{${k.highlights.map((h) => `"${h.replace(/"/g, '\\"')}"`).join(',')}}`)}::text[]
         where not exists (select 1 from existente)
        returning id)
      update public.products p set name = ${lit(k.nombre)}, description = ${lit(k.descripcion)}, brand_id = ${lit(marca)},
             highlights = ${lit(`{${k.highlights.map((h) => `"${h.replace(/"/g, '\\"')}"`).join(',')}}`)}::text[], status = 'published'
        from existente e where p.id = e.id;

      insert into public.store_products (organization_id, company_id, store_id, product_id, category_id, slug, status, published_at, price, currency)
      select ${lit(ORG)}, ${lit(COMPANY)}, ${lit(estado.storeId)}, p.id, ${lit(cat.id)}, ${lit(slug)}, 'published', now(), ${precio}, 'PEN'
        from public.products p where p.company_id = ${lit(COMPANY)} and p.sku = ${lit(k.sku)}
       on conflict (product_id, store_id) do update set status = 'published', price = excluded.price, category_id = excluded.category_id,
          published_at = coalesce(public.store_products.published_at, now());

      -- Una tarifa que ya listaba el kit (el «ki-Limpieza» viejo estaba en la
      -- base a S/ 70) manda sobre el precio de tienda: se alinea al kit nuevo.
      update public.price_list_items x set unit_price = ${precio}, compare_at_price = null
        from public.products p
       where p.company_id = ${lit(COMPANY)} and p.sku = ${lit(k.sku)} and x.product_id = p.id
         and x.variant_id is null and x.min_quantity = 1;

      delete from public.bundle_items b using public.products p
       where p.company_id = ${lit(COMPANY)} and p.sku = ${lit(k.sku)} and b.bundle_product_id = p.id;

      insert into public.bundle_items (organization_id, company_id, bundle_product_id, component_product_id, component_kind, component_variant_id, quantity, position)
      select ${lit(ORG)}, ${lit(COMPANY)}, k.id, c.product_id, c.kind::public.product_kind,
             (select pv.id from public.product_variants pv where pv.company_id = ${lit(COMPANY)} and pv.sku = c.variant_sku and pv.product_kind = 'variant'),
             c.qty, c.pos
        from public.products k,
             jsonb_to_recordset(${jlit(comps.map((c, i) => ({ product_id: c.product_id, kind: c.kind, variant_sku: c.variant_sku, qty: c.qty, pos: i })))})
               as c(product_id uuid, kind text, variant_sku text, qty numeric, pos int)
       where k.company_id = ${lit(COMPANY)} and k.sku = ${lit(k.sku)};
    `)
  }
  return out
}

// ---------------------------------------------------------------------------
// 4 · Fichas
// ---------------------------------------------------------------------------

const unir = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)

/** La ficha del producto padre: lo comun a sus variantes, y que hay para elegir. */
function fichaPadre(g) {
  const base = g.miembros[0].p
  const f = fichaDe({ ...base, name: g.nombre })
  if (!f) return null
  const fichas = g.miembros.map((m) => fichaDe(m.p)?.ficha ?? {})
  const ficha = {}
  for (const [k, val] of Object.entries(f.ficha)) {
    if (val === undefined) continue
    if (fichas.every((x) => x[k] === val) || ['principio_activo', 'grupo_terapeutico', 'condicion_venta', 'receta', 'tipo_producto', 'modo_uso', 'edad_recomendada', 'via_administracion', 'forma_farmaceutica'].includes(k)) {
      ficha[k] = val
    }
  }
  delete ficha.dosis
  delete ficha.contenido_neto
  const opciones = g.ejes.map((eje) => {
    const vals = [...new Set(g.miembros.map((m) => m.valores[eje]))]
    const nombre = EJES.find((e) => e.code === eje).name.toLowerCase()
    return { nombre, vals }
  })
  const disponible = opciones.map((o) => `${o.vals.length} ${o.nombre === 'presentación' ? 'presentaciones' : o.nombre === 'concentración' ? 'concentraciones' : o.nombre === 'sabor' ? 'sabores' : o.nombre === 'tono' ? 'tonos' : 'formatos'} (${unir(o.vals)})`)
  return {
    descripcion: `${f.descripcion} Disponible en ${unir(disponible)}.`,
    highlights: [...f.highlights.filter((h) => !/^(caja|frasco|tubo|contenido|polvo:|líquido)/i.test(h)), `Disponible en ${unir(opciones.map((o) => `${o.vals.length} ${o.nombre === 'presentación' ? 'presentaciones' : o.nombre === 'concentración' ? 'concentraciones' : o.nombre === 'sabor' ? 'sabores' : o.nombre === 'tono' ? 'tonos' : 'formatos'}`))}`]
      .map((h) => h.slice(0, 120))
      .slice(0, 6),
    ficha,
  }
}

async function escribirFichas(estado, lista) {
  const T = `${lit(ORG)}, ${lit(COMPANY)}, ${lit(estado.storeId)}`
  for (let i = 0; i < lista.length; i += 150) {
    const lote = lista.slice(i, i + 150)
    const productos = lote.map((x) => ({ id: x.id, d: x.descripcion, h: x.highlights, g: x.gtin ?? null }))
    const valores = lote.flatMap((x) =>
      Object.entries(x.ficha)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([code, v]) => ({ product_id: x.id, code, v: String(v).slice(0, 500) })),
    )
    await sql(`
      update public.products p set
        description = r.d,
        highlights = array(select jsonb_array_elements_text(r.h)),
        gtin = coalesce(p.gtin, r.g)
        from jsonb_to_recordset(${jlit(productos)}) as r(id uuid, d text, h jsonb, g text)
       where p.id = r.id and p.company_id = ${lit(COMPANY)};

      insert into public.product_attribute_values (organization_id, company_id, store_id, product_id, attribute_id, value_id, value_text, value_boolean)
      select ${T}, r.product_id, a.id,
             case when a.data_type = 'option' then av.id end,
             case when a.data_type = 'text' then r.v end,
             case when a.data_type = 'boolean' then r.v::boolean end
        from jsonb_to_recordset(${jlit(valores)}) as r(product_id uuid, code text, v text)
        join public.attributes a on a.company_id = ${lit(COMPANY)} and a.code = r.code
        left join public.attribute_values av on av.attribute_id = a.id and av.label = r.v
       where a.data_type <> 'option' or av.id is not null
      on conflict (product_id, attribute_id) do update set
        value_id = excluded.value_id, value_text = excluded.value_text, value_number = null,
        value_boolean = excluded.value_boolean, value_date = null;
    `)
    process.stdout.write(`  fichas ${Math.min(i + 150, lista.length)}/${lista.length}\r`)
  }
  process.stdout.write('\n')
}

// ---------------------------------------------------------------------------
// 5 · Limpieza
// ---------------------------------------------------------------------------

async function limpiar() {
  const filtro = `p.company_id = ${lit(COMPANY)} and (p.sku like 'ZAP%' or p.sku = 'ZP-00001')`
  const [antes] = await sql(`
    select count(*)::int as total,
           count(*) filter (where exists (select 1 from public.order_items o where o.product_id = p.id)
                               or exists (select 1 from public.quote_items q where q.product_id = p.id)
                               or exists (select 1 from public.bundle_items b where b.component_product_id = p.id)
                               or exists (select 1 from public.store_products s where s.product_id = p.id))::int as con_uso
      from public.products p where ${filtro}`)
  if (!APPLY) return antes
  const marcas = await sql(`
    select distinct p.brand_id from public.products p where ${filtro} and p.brand_id is not null
    except select brand_id from public.products p where p.company_id = ${lit(COMPANY)} and not (p.sku like 'ZAP%' or p.sku = 'ZP-00001') and brand_id is not null`)
  await sql(`
    delete from public.products p where ${filtro}
       and not exists (select 1 from public.order_items o where o.product_id = p.id)
       and not exists (select 1 from public.quote_items q where q.product_id = p.id)
       and not exists (select 1 from public.bundle_items b where b.component_product_id = p.id)
       and not exists (select 1 from public.store_products s where s.product_id = p.id);
    ${marcas.length ? `update public.brands set is_active = false where id in (${marcas.map((m) => lit(m.brand_id)).join(',')});` : ''}
  `)
  return { ...antes, marcas_apagadas: marcas.length }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(APPLY ? '== APLICANDO en' : '== REVISION (sin escribir) en', REF)
  let estado = await cargar()

  // Grupos: se valida TODO antes de escribir nada.
  const planes = GRUPOS.map((g) => planGrupo(estado, g))
  const nuevos = planes.filter((g) => !g.padre)
  console.log(`grupos de variantes: ${planes.length} (${nuevos.length} por crear), ${planes.reduce((s, g) => s + g.miembros.length, 0)} productos sueltos se vuelven variantes`)
  for (const k of KITS) for (const [ref] of k.componentes) resolver(estado.productos, typeof ref === 'object' ? ref.sku : ref)

  const miembros = new Set(planes.flatMap((g) => g.miembros.map((m) => m.p.id)))
  const publicados = estado.productos.filter(
    (p) => p.sku.startsWith('QS-') && !p.sku.endsWith('-ARCH') && p.spstatus === 'published' && !miembros.has(p.id),
  )
  const fichas = new Map()
  for (const p of publicados) {
    const f = fichaDe(p)
    if (f) fichas.set(p.id, f)
  }
  const fichasPadre = new Map(planes.map((g) => [g.sku, fichaPadre(g)]))
  for (const fp of fichasPadre.values()) if (fp) fichas.set(Symbol(), { ficha: fp.ficha })
  console.log(`fichas: ${fichas.size} de ${publicados.length} productos sueltos publicados + ${planes.length} padres`)
  const sinFicha = publicados.filter((p) => !fichas.has(p.id))
  if (sinFicha.length) console.log('  sin ficha:', sinFicha.map((p) => p.name).join(' | '))

  // Referencias que heredan las variantes.
  if (miembros.size) {
    const ids = [...miembros].map(lit).join(',')
    const [refs] = await sql(`select
      (select count(*) from public.bundle_items where component_product_id in (${ids}))::int as kits,
      (select count(*) from public.price_list_items where product_id in (${ids}))::int as listas,
      (select count(*) from public.promotion_scopes where product_id in (${ids}))::int as promociones,
      (select count(*) from public.store_price_overrides where product_id in (${ids}))::int as overrides,
      (select count(*) from public.product_favorites where product_id in (${ids}))::int as favoritos,
      (select count(*) from public.inventory_levels where product_id in (${ids}))::int as inventario,
      (select count(*) from public.product_images where product_id in (${ids}))::int as fotos,
      (select count(*) from public.order_items where product_id in (${ids}))::int as lineas_de_pedido`)
    console.log('referencias de los sueltos:', refs)
  }

  const limpieza = await limpiar()
  console.log('calzado:', limpieza)

  if (!APPLY) {
    const kits = await crearKits(estado, new Map())
    console.log('kits:', kits.map((k) => `${k.sku} S/ ${k.precio} (piezas S/ ${k.suma})`).join(' | '))
    const muestra = publicados.slice(0, 3).map((p) => ({ name: p.name, ...fichas.get(p.id) }))
    console.log(JSON.stringify(muestra, null, 1).slice(0, 3000))
    console.log('\nNada escrito. Para aplicar: --apply')
    return
  }

  // 1 · Vocabulario
  const [voc] = await comoOwner(exigirAplicado(`public.import_catalog_vocabulary(${jlit(vocabulario(fichas))}, false)`))
  console.log('vocabulario:', JSON.stringify({ ...voc.r, rows: undefined }))

  // 2 · Variantes
  for (const g of nuevos.slice(0, LIMITE)) {
    await crearGrupo(estado, g)
    console.log(`  + ${g.sku} (${g.miembros.length})`)
  }
  estado = await cargar()
  const planesFinales = GRUPOS.map((g) => planGrupo(estado, g)).filter((g) => g.padre)
  for (const g of planesFinales) await heredar(estado, g)
  console.log('variantes: herencia de existencias, fotos, EAN y referencias hecha')

  // 3 · Kits
  const variantes = await sql(`select id, product_id, sku from public.product_variants where company_id = ${lit(COMPANY)} and product_kind = 'variant'`)
  const porSku = new Map(variantes.map((v) => [v.sku, v]))
  const mapaVariantes = new Map()
  for (const g of planesFinales) for (const m of g.miembros) mapaVariantes.set(m.p.id, { padre: porSku.get(skuOriginal(m.p)).product_id })
  const kits = await crearKits(estado, mapaVariantes)
  console.log('kits:', kits.map((k) => `${k.sku} S/ ${k.precio}`).join(' | '))

  // 4 · Fichas (sueltos + padres). Los miembros de grupos que aun no se
  // crearon (con --grupos=N) siguen sueltos y publicados: tambien llevan ficha.
  estado = await cargar()
  const creados = new Set(planesFinales.flatMap((g) => g.miembros.map((m) => m.p.id)))
  for (const g of planes) {
    if (creados.has(g.miembros[0].p.id)) continue
    for (const m of g.miembros) {
      const f = fichaDe(m.p)
      if (f) {
        publicados.push(m.p)
        fichas.set(m.p.id, f)
      }
    }
  }
  const usados = new Set(estado.productos.filter((p) => p.gtin).map((p) => p.gtin))
  const lista = []
  for (const p of publicados) {
    const f = fichas.get(p.id)
    if (!f) continue
    const ean = p.cf?.ean
    const gtin = !p.gtin && /^([0-9]{8}|[0-9]{12,14})$/.test(ean ?? '') && !usados.has(ean) ? ean : null
    if (gtin) usados.add(gtin)
    lista.push({ id: p.id, descripcion: f.descripcion, highlights: f.highlights.slice(0, 6), gtin, ficha: f.ficha })
  }
  for (const g of planesFinales) {
    const padre = estado.productos.find((p) => p.sku === g.sku)
    const fp = fichasPadre.get(g.sku)
    if (padre && fp) lista.push({ id: padre.id, descripcion: fp.descripcion, highlights: fp.highlights, gtin: null, ficha: fp.ficha })
  }
  await escribirFichas(estado, lista)

  // Resumen
  const [fin] = await sql(`select
    (select count(*) from public.store_products where store_id = ${lit(estado.storeId)} and status = 'published')::int as publicados,
    (select count(*) from public.products where company_id = ${lit(COMPANY)} and kind = 'variant')::int as con_variantes,
    (select count(*) from public.product_variants where company_id = ${lit(COMPANY)} and product_kind = 'variant')::int as variantes,
    (select count(*) from public.products where company_id = ${lit(COMPANY)} and kind = 'bundle')::int as kits,
    (select count(*) from public.product_attribute_values where company_id = ${lit(COMPANY)})::int as valores_de_ficha,
    (select count(*) from public.products p join public.store_products sp on sp.product_id = p.id and sp.status = 'published'
      where p.company_id = ${lit(COMPANY)} and coalesce(p.description, '') = '')::int as publicados_sin_descripcion`)
  console.log('resultado:', fin)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
