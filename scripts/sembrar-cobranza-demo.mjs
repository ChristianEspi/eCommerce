/**
 * Siembra una cartera de cobranza de EJEMPLO en una tienda, para que la
 * pestaña «Análisis IA» de Cobranza tenga algo que mostrar.
 *
 * Tres clientes B2B que ya existen en la sociedad reciben documentos por
 * cobrar con fechas RELATIVAS a hoy (siempre caen en los mismos tramos):
 *
 *  1. Laboratorio Vega SAC     · +90 días vencido (dos facturas) · cuenta en observación
 *  2. Centro Medico Surco SAC  · 31–60 días vencido + una factura que vence en 4 días
 *  3. Clinica San Rafael SAC   · 1–30 días vencido + un cobro SIN aplicar
 *
 * Todo lo sembrado lleva el prefijo `DEMO-COB-` en su número: se reconoce y se
 * borra con `--limpiar`. Idempotente: correrlo dos veces deja lo mismo.
 *
 * Uso:  node scripts/sembrar-cobranza-demo.mjs <slug> [--limpiar]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = process.argv[2]
const LIMPIAR = process.argv.includes('--limpiar')

if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: node scripts/sembrar-cobranza-demo.mjs <slug> [--limpiar]')
  process.exit(1)
}

const archivoEnv = join(ROOT, '.env')
const env = {
  ...(existsSync(archivoEnv)
    ? Object.fromEntries(
        readFileSync(archivoEnv, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#') && line.includes('='))
          .map((line) => {
            const i = line.indexOf('=')
            return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
          }),
      )
    : {}),
  ...process.env,
}

if (!env.VITE_SUPABASE_URL || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('Faltan VITE_SUPABASE_URL o SUPABASE_ACCESS_TOKEN (entorno o .env).')
  process.exit(1)
}

const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]

async function sql(query) {
  const respuesta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await respuesta.text()
  if (!respuesta.ok) throw new Error(cuerpo.slice(0, 500))
  return cuerpo ? JSON.parse(cuerpo) : []
}

const lit = (valor) => `'${String(valor).replace(/'/g, "''")}'`

/** Documentos: [cliente, número, importe, días vencido (negativo = por vencer)]. */
const DOCUMENTOS = [
  ['Laboratorio Vega SAC', 'DEMO-COB-F001-2101', 3450.0, 112],
  ['Laboratorio Vega SAC', 'DEMO-COB-F001-2114', 1280.5, 95],
  ['Centro Medico Surco SAC', 'DEMO-COB-F001-2152', 1860.0, 45],
  ['Centro Medico Surco SAC', 'DEMO-COB-F001-2190', 920.0, -4],
  ['Clinica San Rafael SAC', 'DEMO-COB-F001-2175', 2140.0, 12],
]
/** Cobro recibido y todavía sin aplicar a ninguna factura. */
const COBROS = [['Clinica San Rafael SAC', 'DEMO-COB-R-0301', 1000.0, 3]]
/** La cuenta con la deuda más vieja queda en observación. */
const OBSERVACION = 'Laboratorio Vega SAC'

const [tienda] = await sql(
  `select id, name, currency, organization_id, company_id from public.stores where slug = ${lit(SLUG)}`,
)
if (!tienda) {
  console.error(`No hay ninguna tienda con slug «${SLUG}» en ${REF}.`)
  process.exit(1)
}
const tenant = `organization_id = ${lit(tienda.organization_id)} and company_id = ${lit(tienda.company_id)}`
console.log(`Tienda «${tienda.name}» (${SLUG}) · ${tienda.currency} · proyecto ${REF}`)

if (LIMPIAR) {
  await sql(`
begin;
delete from public.ar_receipts  where ${tenant} and receipt_number  like 'DEMO-COB-%';
delete from public.ar_documents where ${tenant} and document_number like 'DEMO-COB-%';
update public.business_accounts set credit_status = 'ok'
 where ${tenant} and customer_id in (select id from public.customers where ${tenant} and name = ${lit(OBSERVACION)})
   and credit_status = 'watch';
commit;`)
  console.log('Cartera de ejemplo borrada.')
  process.exit(0)
}

const nombres = [...new Set([...DOCUMENTOS, ...COBROS].map(([n]) => n))]
const clientes = await sql(`
select c.id, c.name, a.id as account_id
  from public.customers c
  left join public.business_accounts a
    on a.customer_id = c.id and a.organization_id = c.organization_id and a.company_id = c.company_id
 where c.organization_id = ${lit(tienda.organization_id)} and c.company_id = ${lit(tienda.company_id)}
   and c.name in (${nombres.map(lit).join(', ')})`)
const porNombre = new Map(clientes.map((c) => [c.name, c]))
const faltan = nombres.filter((n) => !porNombre.has(n))
if (faltan.length > 0) {
  console.error(`Faltan clientes en la sociedad: ${faltan.join(', ')}`)
  process.exit(1)
}

const valoresDocs = DOCUMENTOS.map(([nombre, numero, importe, atraso]) => {
  const c = porNombre.get(nombre)
  return `(${lit(tienda.organization_id)}, ${lit(tienda.company_id)}, ${lit(c.id)}, ${c.account_id ? lit(c.account_id) : 'null'},
    'invoice', ${lit(numero)}, ${lit(tienda.currency)}, current_date - ${atraso + 30}, current_date - ${atraso}, ${importe})`
}).join(',\n  ')

const valoresCobros = COBROS.map(([nombre, numero, importe, hace]) => {
  const c = porNombre.get(nombre)
  return `(${lit(tienda.organization_id)}, ${lit(tienda.company_id)}, ${lit(c.id)}, ${lit(numero)}, ${lit(tienda.currency)}, current_date - ${hace}, ${importe}, 'transfer')`
}).join(',\n  ')

await sql(`
begin;
insert into public.ar_documents
  (organization_id, company_id, customer_id, business_account_id, kind, document_number, currency, issued_at, due_at, amount)
values
  ${valoresDocs}
on conflict (organization_id, company_id, document_number) do nothing;

insert into public.ar_receipts
  (organization_id, company_id, customer_id, receipt_number, currency, received_at, amount, method)
values
  ${valoresCobros}
on conflict (organization_id, company_id, receipt_number) do nothing;

update public.business_accounts set credit_status = 'watch'
 where id = ${lit(porNombre.get(OBSERVACION).account_id)} and credit_status = 'ok';
commit;`)

const [resumen] = await sql(`
select count(*)::int as documentos, sum(balance)::numeric(14,2)::text as saldo,
       count(*) filter (where due_at < current_date)::int as vencidos
  from public.ar_documents where ${tenant} and document_number like 'DEMO-COB-%'`)
console.log('Sembrado:', resumen)
