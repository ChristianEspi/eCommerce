/**
 * Kit de integración GENERADO desde la tabla de rutas (`API_ROUTES`), la misma
 * con la que el gateway despacha:
 *
 *   docs/integrations/openapi-v1.json                       contrato OpenAPI 3.1
 *   scripts/integrations/postman/eCommerce-API-v1.postman_collection.json
 *   scripts/integrations/postman/eCommerce-QAS.postman_environment.json
 *
 * Uso:  npx vite-node scripts/integrations/generate-api-kit.ts
 *
 * No se edita a mano ninguno de los tres archivos: una ruta nueva entra
 * volviendo a correr esto. Los secretos NO viajan: el entorno trae
 * `clientId` / `clientSecret` vacíos.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildOpenApiDocument } from '../../supabase/functions/_shared/api/openapi.ts'
import { API_ROUTES, type ApiRoute } from '../../supabase/functions/_shared/api/routes.ts'
import { API_SCOPES } from '../../supabase/functions/_shared/api/contract.ts'

const QAS_BASE = 'https://ehxlxbhtlmfgneiagdcj.supabase.co/functions/v1/api'

const FOLDERS: Array<{ name: string; description: string; ops: string[] }> = [
  {
    name: '1 · Pedidos',
    description: 'Leer pedidos, crear uno y devolver su ciclo (estado, pago, entrega) con las referencias del ERP.',
    ops: ['listOrders', 'getOrder', 'createOrder', 'updateOrderStatus'],
  },
  {
    name: '2 · Catálogo y stock',
    description: 'Productos por lote, catálogo publicado de la tienda, disponibilidad y saldo por almacén.',
    ops: ['upsertCatalogProducts', 'listProducts', 'getProduct', 'readStock', 'setStock'],
  },
  {
    name: '3 · Clientes',
    description: 'Clientes por código, con el código del ERP.',
    ops: ['upsertCustomers', 'listCustomers', 'getCustomer'],
  },
  {
    name: '4 · Precios',
    description: 'Precios de una lista (la lista se crea en el backoffice, en Precios › Listas).',
    ops: ['upsertPriceListItems'],
  },
]

/** Valor de ejemplo de cada parámetro: variables del entorno donde tiene sentido. */
const PARAM_VALUE: Record<string, string> = {
  store: '{{store}}',
  number: '{{orderNumber}}',
  sku: '{{sku}}',
  code: '{{priceList}}',
  limit: '50',
  dry_run: 'true',
  updated_since: '{{updatedSince}}',
}

/** El mismo nombre de parámetro con otro significado según la ruta. */
const PATH_VALUE_BY_ROUTE: Record<string, Record<string, string>> = {
  getCustomer: { code: '{{customerCode}}' },
}

/** Parámetros que se dejan activos; el resto va desactivado, listo para marcar. */
const ACTIVE_QUERY = new Set(['store', 'dry_run'])

/** Los ejemplos usan los SKU y almacenes del entorno, no los de un cliente. */
function bodyFor(route: ApiRoute): unknown {
  const example = JSON.parse(JSON.stringify(route.requestExample ?? {})) as Record<string, unknown>
  const text = JSON.stringify(example, null, 2)
    .replaceAll('"QS-514574"', '"{{sku}}"')
    .replaceAll('"QS-514575"', '"{{sku2}}"')
    .replaceAll('"SKU-001"', '"{{sku}}"')
    .replaceAll('"ALM-LIMA"', '"{{warehouse}}"')
    .replaceAll('"mi-tienda"', '"{{store}}"')
  return text
}

function urlFor(route: ApiRoute) {
  const segments = route.path
    .split('/')
    .filter(Boolean)
    .map((piece) =>
      piece.startsWith('{')
        ? (PATH_VALUE_BY_ROUTE[route.operationId]?.[piece.slice(1, -1)] ??
          PARAM_VALUE[piece.slice(1, -1)] ??
          `:${piece.slice(1, -1)}`)
        : piece,
    )
  const query = (route.query ?? []).map((param) => ({
    key: param.name,
    value: PARAM_VALUE[param.name] ?? '',
    description: param.description,
    disabled: !ACTIVE_QUERY.has(param.name),
  }))
  const active = query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`)
  return {
    raw: `{{base}}/${segments.join('/')}${active.length > 0 ? `?${active.join('&')}` : ''}`,
    host: ['{{base}}'],
    path: segments,
    query,
  }
}

function testsFor(route: ApiRoute): string[] {
  if (route.method === 'GET') {
    return [
      'pm.test("200", () => pm.response.to.have.status(200));',
      'const body = pm.response.json();',
      'if (body.server_time) { pm.environment.set("updatedSince", body.server_time); }',
    ]
  }
  if (route.batchReport) {
    return [
      'pm.test("200 (aplicado o simulado) o 422 con informe", () => pm.expect([200, 422]).to.include(pm.response.code));',
      'const body = pm.response.json();',
      'if (body.rows) { console.log("informe", body); }',
    ]
  }
  return [`pm.test("${route.successStatus ?? 201}", () => pm.response.to.have.status(${route.successStatus ?? 201}));`]
}

function itemFor(route: ApiRoute) {
  const headers: Array<Record<string, unknown>> = []
  if (route.method === 'POST') headers.push({ key: 'Content-Type', value: 'application/json' })
  return {
    name: `${route.method} ${route.path}`,
    request: {
      method: route.method,
      header: headers,
      url: urlFor(route),
      description: `**Permiso:** \`${route.scope}\`\n\n${route.summary}${
        route.requiresIdempotencyKey ? '\n\nLleva `Idempotency-Key` (la pone sola el script de la colección).' : ''
      }`,
      ...(route.method === 'POST'
        ? { body: { mode: 'raw', raw: bodyFor(route), options: { raw: { language: 'json' } } } }
        : {}),
    },
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: testsFor(route) } }],
  }
}

const tokenItem = {
  name: 'POST /v1/oauth/token — pedir token',
  request: {
    auth: { type: 'noauth' },
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    url: { raw: '{{base}}/v1/oauth/token', host: ['{{base}}'], path: ['v1', 'oauth', 'token'] },
    description:
      'OAuth 2.0 `client_credentials`. Guarda el token en `{{token}}` (script de Post-response). Dura una hora: si otra petición da 401, vuelve a enviar esta.',
    body: {
      mode: 'raw',
      raw: JSON.stringify(
        {
          grant_type: 'client_credentials',
          client_id: '{{clientId}}',
          client_secret: '{{clientSecret}}',
          scope: '{{scopes}}',
        },
        null,
        2,
      ),
      options: { raw: { language: 'json' } },
    },
  },
  event: [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'pm.test("token emitido", () => pm.response.to.have.status(200));',
          'pm.environment.set("token", pm.response.json().access_token);',
          'console.log("scopes concedidos:", pm.response.json().scope);',
        ],
      },
    },
  ],
}

const contractItem = {
  name: 'GET /v1/openapi.json — contrato',
  request: {
    auth: { type: 'noauth' },
    method: 'GET',
    header: [],
    url: { raw: '{{base}}/v1/openapi.json', host: ['{{base}}'], path: ['v1', 'openapi.json'] },
    description: 'El contrato OpenAPI, público y sin token.',
  },
}

const byOp = new Map(API_ROUTES.map((route) => [route.operationId, route]))
const placed = new Set(FOLDERS.flatMap((f) => f.ops))
const missing = API_ROUTES.filter((route) => !placed.has(route.operationId)).map((r) => r.operationId)
if (missing.length > 0) throw new Error(`Rutas sin carpeta en la colección: ${missing.join(', ')}`)

const collection = {
  info: {
    name: 'eCommerce by EBIM · API v1',
    description:
      'Colección GENERADA desde la tabla de rutas de la API (`scripts/integrations/generate-api-kit.ts`). Contrato: `docs/integrations/CONTRATO_INTEGRACION_v1.md`.\n\n1. Importa también el entorno `eCommerce-QAS` y llena `clientId` y `clientSecret`.\n2. Envía **0 · Inicio › pedir token**.\n3. Prueba el resto. Los lotes van con `dry_run=true` (simulación); desmarca el parámetro para aplicar.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  event: [
    {
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          '// Toda escritura exige Idempotency-Key: una distinta en cada envío.',
          '// Para probar un reintento, pon la cabecera a mano con un valor fijo.',
          'if (pm.request.method === "POST" && !pm.request.url.toString().includes("/oauth/token") && !pm.request.headers.has("Idempotency-Key")) {',
          '  pm.request.headers.add({ key: "Idempotency-Key", value: "pm-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10) });',
          '}',
        ],
      },
    },
  ],
  item: [
    { name: '0 · Inicio', item: [tokenItem, contractItem] },
    ...FOLDERS.map((folder) => ({
      name: folder.name,
      description: folder.description,
      item: folder.ops.map((op) => itemFor(byOp.get(op) as ApiRoute)),
    })),
  ],
}

const environment = {
  name: 'eCommerce QAS',
  values: [
    { key: 'base', value: QAS_BASE, type: 'default', enabled: true },
    { key: 'clientId', value: '', type: 'secret', enabled: true },
    { key: 'clientSecret', value: '', type: 'secret', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'scopes', value: API_SCOPES.join(' '), type: 'default', enabled: true },
    { key: 'store', value: 'miquimica', type: 'default', enabled: true },
    { key: 'orderNumber', value: '', type: 'default', enabled: true },
    { key: 'sku', value: '', type: 'default', enabled: true },
    { key: 'sku2', value: '', type: 'default', enabled: true },
    { key: 'warehouse', value: 'ALM-ERP', type: 'default', enabled: true },
    { key: 'priceList', value: 'mayorista', type: 'default', enabled: true },
    { key: 'customerCode', value: '', type: 'default', enabled: true },
    { key: 'updatedSince', value: '2026-01-01T00:00:00Z', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
}

function saveText(path: string, text: string) {
  const target = resolve(path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text, 'utf8')
  console.log(`escrito: ${path}`)
}

function save(path: string, data: unknown) {
  saveText(path, `${JSON.stringify(data, null, 2)}\n`)
}

/**
 * Visor del contrato (Redoc) con el contrato EMBEBIDO: se abre sin servidor y
 * sin depender de CORS (el `openapi.json` publicado no lo trae, a propósito:
 * es una API servidor-a-servidor). Para llamar de verdad, la colección Postman.
 */
function viewerHtml(document: Record<string, unknown>): string {
  const writes = API_ROUTES.filter((r) => r.method === 'POST').length
  const reads = API_ROUTES.length - writes
  const json = JSON.stringify(document).replaceAll('</', '<\\/')
  return `<title>eCommerce API v1</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  /* Cabecera de marca EBIM + contrato en Redoc a todo el ancho. */
  :root {
    --bg: #f6f9f8; --surface: #ffffff; --fg: #15302a; --muted: #55706a; --line: #d9e6e1;
    --accent: #5aa97f; --accent-deep: #056769; --code-bg: #eef5f2;
    --font: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg: #0e1715; --surface: #15211e; --fg: #e3efea; --muted: #94aca5; --line: #26372f;
    --accent: #5aa97f; --accent-deep: #7fd0a8; --code-bg: #1b2a26; color-scheme: dark } }
  :root[data-theme="dark"] {
    --bg: #0e1715; --surface: #15211e; --fg: #e3efea; --muted: #94aca5; --line: #26372f;
    --accent: #5aa97f; --accent-deep: #7fd0a8; --code-bg: #1b2a26; color-scheme: dark }
  body { background: var(--bg); color: var(--fg); font-family: var(--font); }
  .top { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
         padding-block: 28px 20px; border-bottom: 1px solid var(--line); background: var(--surface); }
  .wrap { max-width: 1180px; margin: 0 auto; display: grid; gap: 18px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; letter-spacing: .04em; }
  .brand svg { width: 22px; height: 22px; flex: none; }
  h1 { margin: 0; font-size: clamp(24px, 4vw, 32px); line-height: 1.15; text-wrap: balance; }
  h1 span { color: var(--accent-deep); }
  .lead { margin: 0; max-width: 68ch; color: var(--muted); line-height: 1.55; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .pill { font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
          font-variant-numeric: tabular-nums; }
  .base { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
  .base code { font-family: var(--mono); font-size: 13px; background: var(--code-bg); padding: 6px 10px; border-radius: 6px;
               overflow-wrap: anywhere; min-width: 0; }
  button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--accent);
           background: var(--accent); color: #0b2a20; cursor: pointer; font-weight: 500; }
  button:focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 2px; }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px;
           grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .steps li { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 4px; min-width: 0;
              background: var(--bg); }
  .steps b { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent-deep); }
  .steps span { font-size: 14px; line-height: 1.45; }
  .steps code, .note code { font-family: var(--mono); font-size: 12.5px; }
  .note { margin: 0; font-size: 13px; color: var(--muted); }
  #redoc { background: var(--surface); min-height: 60vh; }
  #redoc-loading { padding: 40px max(16px, env(safe-area-inset-left, 0px)); color: var(--muted); }
</style>

<header class="top">
  <div class="wrap">
    <div class="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="var(--accent)"/><path d="M10 11h12M10 16h9M10 21h12" stroke="var(--surface)" stroke-width="2.6" stroke-linecap="round"/></svg>
      eCommerce by EBIM
    </div>
    <h1>API de integración <span>v1</span></h1>
    <p class="lead">El contrato con el que cualquier ERP se conecta a la tienda: pedidos, catálogo, stock por almacén, clientes y listas de precios. Es una API de servidor a servidor con OAuth 2.0 y permisos por credencial.</p>
    <div class="meta">
      <span class="pill">OpenAPI ${String(document.openapi)}</span>
      <span class="pill">${API_ROUTES.length} rutas · ${reads} de lectura · ${writes} de escritura</span>
      <span class="pill">${API_SCOPES.length} permisos</span>
    </div>
    <div class="base">
      <code id="base-url">${QAS_BASE}</code>
      <button type="button" id="copy-base">Copiar URL base (QAS)</button>
    </div>
    <ol class="steps" aria-label="Cómo se usa">
      <li><b>Token</b><span><code>POST /v1/oauth/token</code> con el <code>client_id</code> y el secreto de tu credencial. El token dura una hora.</span></li>
      <li><b>Llamada</b><span><code>Authorization: Bearer &lt;token&gt;</code>. Cada ruta pide un permiso, que se ve en su ficha.</span></li>
      <li><b>Escrituras</b><span>Todo POST lleva <code>Idempotency-Key</code>: si reintentas con la misma clave, recibes la misma respuesta.</span></li>
      <li><b>Lotes</b><span>Todo o nada. Con <code>?dry_run=true</code> se simula; si una fila falla, responde 422 con el informe y no se escribe nada.</span></li>
    </ol>
    <p class="note">Esta página muestra el contrato; no hace llamadas. Para probarlo usa la colección de Postman de <code>scripts/integrations/postman/</code>.</p>
  </div>
</header>

<main id="redoc"><p id="redoc-loading">Cargando el contrato…</p></main>

<script id="spec" type="application/json">${json}</script>
<script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script>
<script>
  (function () {
    var copy = document.getElementById('copy-base');
    copy.addEventListener('click', function () {
      var text = document.getElementById('base-url').textContent;
      function selectIt() {
        var range = document.createRange();
        range.selectNodeContents(document.getElementById('base-url'));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        copy.textContent = 'Selecciona y copia con Ctrl+C';
      }
      try {
        navigator.clipboard.writeText(text).then(function () { copy.textContent = 'Copiada'; }, selectIt);
      } catch (e) { selectIt(); }
    });

    var root = document.documentElement;
    var dark = root.getAttribute('data-theme') === 'dark' ||
      (root.getAttribute('data-theme') !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var css = getComputedStyle(root);
    function v(name) { return css.getPropertyValue(name).trim(); }
    var spec = JSON.parse(document.getElementById('spec').textContent);
    if (!window.Redoc) {
      document.getElementById('redoc-loading').textContent = 'No se pudo cargar el visor. El contrato está en docs/integrations/openapi-v1.json.';
      return;
    }
    Redoc.init(spec, {
      hideDownloadButton: true,
      expandResponses: '200,201',
      jsonSampleExpandLevel: 3,
      requiredPropsFirst: true,
      sortPropsAlphabetically: false,
      pathInMiddlePanel: true,
      theme: {
        spacing: { sectionVertical: 28 },
        colors: {
          primary: { main: v('--accent-deep') },
          success: { main: '#2e8b57' },
          text: { primary: v('--fg'), secondary: v('--muted') },
          border: { dark: v('--line'), light: v('--line') },
          http: { get: '#2f7fb8', post: '#3c9a6a' }
        },
        typography: {
          fontFamily: v('--font'), fontSize: '15px', lineHeight: '1.55',
          headings: { fontFamily: v('--font'), fontWeight: '700' },
          code: { fontFamily: v('--mono'), fontSize: '13px', color: v('--accent-deep'), backgroundColor: v('--code-bg') },
          links: { color: v('--accent-deep') }
        },
        sidebar: { backgroundColor: v('--bg'), textColor: v('--fg'), activeTextColor: v('--accent-deep') },
        rightPanel: { backgroundColor: dark ? '#0a110f' : '#16302a', textColor: '#e3efea' },
        codeBlock: { backgroundColor: dark ? '#060b0a' : '#0f2420' }
      }
    }, document.getElementById('redoc'));
  })();
</script>
`
}

const spec = buildOpenApiDocument(QAS_BASE)
save('docs/integrations/openapi-v1.json', spec)
saveText('docs/integrations/openapi-v1.html', viewerHtml(spec))
save('scripts/integrations/postman/eCommerce-API-v1.postman_collection.json', collection)
save('scripts/integrations/postman/eCommerce-QAS.postman_environment.json', environment)
