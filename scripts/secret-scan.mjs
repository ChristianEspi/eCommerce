#!/usr/bin/env node
/**
 * Búsqueda explícita de secretos y de `service_role` en el frontend (P16-SaaS).
 *
 * El encargo de la fase pide *ejecutar* esa búsqueda. Ejecutarla a mano una vez
 * y escribir el resultado en un documento no vale: al día siguiente el
 * documento dice «limpio» y el repositorio ya no lo está. Esto es un GATE —
 * sale con código 1— y por eso puede vivir en CI.
 *
 * ## Qué mira, y por qué eso y no otra cosa
 *
 *  1. **Los archivos versionados** (`git ls-files`). No el árbol de trabajo: un
 *     `.env` local con la clave de servicio es correcto y no debe fallar. Lo que
 *     no puede ocurrir es que esté *versionado*.
 *  2. **El bundle construido** (`dist/`), si existe. Es la comprobación que de
 *     verdad importa y la única que no se puede razonar leyendo el código: da
 *     igual lo que diga `src/` si una variable `VITE_*` mal nombrada arrastró un
 *     secreto al JavaScript que descarga cualquiera. Se avisa —no se falla— si
 *     `dist/` no existe todavía, para que el gate se pueda ejecutar antes del
 *     build.
 *  3. **Que `.env` esté ignorado.** Un `.gitignore` que deja de cubrirlo es el
 *     paso previo a todo lo anterior.
 *
 * ## Las excepciones son NOMINALES, nunca por patrón
 *
 * `src/shared/lib/env.ts` contiene la cadena `service_role` porque es el guard
 * que la prohíbe, y su test contiene `sb_secret_xyz` porque comprueba que el
 * guard salta. Excluirlos por un patrón —«ignora los .test.ts»— convertiría la
 * lista en una puerta trasera. Se excluyen por RUTA y por el motivo escrito al
 * lado, exactamente como `REFERENCE_CATALOG` en `schema-invariants.test.ts`.
 *
 * Uso:  node scripts/secret-scan.mjs        (o `npm run scan:secrets`)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * La raiz del repositorio.
 *
 * Se deriva de `import.meta.url` cuando eso es una URL de fichero —que es el
 * caso al ejecutarlo como programa— y se cae a `process.cwd()` cuando no lo es:
 * bajo el corredor de pruebas el modulo llega por una URL transformada, y sin
 * este respaldo el propio test del gate no podria importarlo.
 */
function repoRoot() {
  try {
    return fileURLToPath(new URL('..', import.meta.url))
  } catch {
    return process.cwd()
  }
}

const ROOT = repoRoot()

/**
 * Lo que nunca puede estar en un archivo versionado ni en el bundle.
 *
 * Cada patrón lleva el porqué: sin él, el siguiente que vea un falso positivo
 * no sabrá si puede quitarlo.
 */
const PATTERNS = [
  {
    id: 'supabase-secret-key',
    // Formato actual de las claves de servicio de Supabase.
    re: /sb_secret_[A-Za-z0-9_-]{8,}/g,
    why: 'clave de servicio de Supabase',
  },
  {
    id: 'legacy-service-jwt',
    // Las claves legacy son JWT HS256; la cabecera codificada empieza siempre
    // igual. Coincide también con la anon legacy, y eso es deseado: una clave
    // legacy en el bundle es un hallazgo aunque sea la publicable.
    re: /eyJhbGciOiJIUzI1NiI[A-Za-z0-9_-]{10,}/g,
    why: 'JWT de clave legacy de Supabase',
  },
  {
    id: 'service-role-assignment',
    // `SUPABASE_SERVICE_ROLE_KEY=<algo>` con valor real, no el comentario del
    // `.env.example`.
    re: /(SERVICE_ROLE_KEY|SERVICE_KEY|CLIENT_SECRET|PROVISIONING_KEY|WORKER_KEY|AI_API_KEY)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{16,}/g,
    why: 'asignación de una clave de servidor con valor',
  },
  {
    id: 'anthropic-api-key',
    // Clave del proveedor de IA (fase 12). Vive SOLO en los secretos de las
    // Edge Functions (`EBIM_AI_API_KEY`). Las reales llevan ~95 caracteres de
    // cuerpo; el umbral de 40 deja pasar los literales cortos que los tests de
    // redacción usan para comprobar que `redact.ts` la tapa.
    re: /sk-ant-[A-Za-z0-9_-]{40,}/g,
    why: 'clave de API del proveedor de IA',
  },
  {
    id: 'private-key-block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    why: 'clave privada en PEM',
  },
  {
    id: 'aws-access-key',
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    why: 'identificador de clave de AWS',
  },
  {
    id: 'stripe-live-key',
    re: /\b[sr]k_live_[A-Za-z0-9]{16,}/g,
    why: 'clave viva de pasarela',
  },
  {
    id: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    why: 'token de Slack',
  },
]

/**
 * El otro eje: una credencial de SERVIDOR dentro de lo que se envia al
 * navegador.
 *
 * Aqui no se busca la PALABRA `service_role`. Buscarla da tres falsos positivos
 * garantizados —`assertNoServiceKey` viaja en el bundle porque es el guard, y
 * `supabase-js` lleva dentro los prefijos de clave para poder validarlos— y un
 * gate que empieza con tres falsos positivos se desactiva en la primera
 * semana. Lo que se busca es una credencial con VALOR:
 *
 *  · `sb_secret_` seguido de cuerpo de clave (patron `supabase-secret-key`).
 *  · un JWT cuyo payload declare `role: service_role`, decodificandolo de
 *    verdad en vez de adivinar por la forma. Una clave legacy ANON en el bundle
 *    es correcta y no puede hacer fallar esto; una legacy de servicio no.
 */
function serviceRoleJwtFindings(text, file, label) {
  const findings = []
  const jwt = /eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g
  let match
  while ((match = jwt.exec(text)) !== null) {
    let payload
    try {
      payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
    } catch {
      continue
    }
    if (payload && payload.role === 'service_role') {
      findings.push({
        scope: label,
        file,
        line: text.slice(0, match.index).split(String.fromCharCode(10)).length,
        id: 'service-role-jwt',
        why: 'un JWT con `role: service_role`',
        hits: 1,
      })
    }
  }
  return findings
}

/**
 * Excepciones por RUTA, con motivo. Un archivo entra aquí solo si la
 * coincidencia ES la defensa contra el hallazgo.
 */
const ALLOWED = new Map([
  [
    'src/shared/lib/env.ts',
    'es el guard `assertNoServiceKey`: la expresión regular y su mensaje contienen la palabra prohibida',
  ],
  [
    'src/shared/lib/env.test.ts',
    'comprueba que el guard salta; los valores son literales de prueba, no claves',
  ],
  ['scripts/secret-scan.mjs', 'este mismo escáner: los patrones son el fichero'],
  [
    'scripts/secret-scan.test.mjs',
    'planta una credencial falsa de cada clase para comprobar que el patrón salta: la coincidencia ES la prueba del gate',
  ],
])

/** Rutas del árbol de trabajo que nunca se recorren. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'supabase/tests/tmp'])

/** Binarios y demás: no se leen como texto. */
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|pdf|zip|gz|map)$/i

function posix(path) {
  return path.split(sep).join('/')
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}

/**
 * Archivos NUEVOS que todavía no están versionados pero tampoco ignorados
 * (fase 12). Son los que entrarán en el próximo commit: esperar a que estén
 * versionados para mirarlos es enterarse tarde. Lo ignorado (`.env`) sigue
 * fuera, que es su sitio.
 */
function untrackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out.split('\0').filter(Boolean)
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = posix(relative(ROOT, full))
    if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry)) continue
    const info = statSync(full)
    if (info.isDirectory()) walk(full, acc)
    else acc.push(rel)
  }
  return acc
}

/**
 * Un hallazgo se describe SIN el valor encontrado. Un escáner de secretos que
 * imprime el secreto en el log de CI acaba de publicarlo otra vez.
 */
function scan(files, patterns, label) {
  const findings = []
  for (const file of files) {
    if (BINARY.test(file)) continue
    if (ALLOWED.has(file)) continue
    let text
    try {
      text = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    // Contenido binario que se coló con extensión de texto: no se analiza.
    if (text.indexOf(String.fromCharCode(0)) !== -1) continue
    for (const pattern of patterns) {
      pattern.re.lastIndex = 0
      const matches = text.match(pattern.re)
      if (!matches) continue
      const lines = text.slice(0, text.search(pattern.re)).split('\n').length
      findings.push({ scope: label, file, line: lines, id: pattern.id, why: pattern.why, hits: matches.length })
    }
  }
  return findings
}

/**
 * El escaneo entero. Devuelve el codigo de salida en vez de llamar a
 * `process.exit` para que se pueda ejecutar desde un test sin matar al
 * proceso de pruebas — que es la unica forma de comprobar que este gate
 * DETECTA algo, y no solo que no se queja.
 */
export function runSecretScan({ quiet = false } = {}) {
  const say = quiet ? () => {} : (line) => console.log(line)
  const shout = quiet ? () => {} : (line) => console.error(line)
  const findings = []

  // 1 · Archivos versionados
  findings.push(...scan(trackedFiles(), PATTERNS, 'versionado'))

  // 1b · Archivos nuevos aún sin versionar (no ignorados)
  const nuevos = untrackedFiles()
  findings.push(...scan(nuevos, PATTERNS, 'sin versionar'))

  // 2 · El bundle
  const dist = join(ROOT, 'dist')
  if (existsSync(dist)) {
    const bundle = walk(dist).filter((file) => /\.(js|mjs|cjs|css|html|json|txt|xml)$/i.test(file))
    findings.push(...scan(bundle, PATTERNS, 'bundle'))
    for (const file of bundle) {
      findings.push(...serviceRoleJwtFindings(readFileSync(join(ROOT, file), 'utf8'), file, 'bundle'))
    }
    say(`· dist/: ${bundle.length} archivos de texto revisados`)
  } else {
    say('· dist/ no existe todavia: el bundle no se ha revisado. Ejecuta `npm run build` antes.')
  }

  // 3 · `.env` fuera del control de versiones
  const tracked = new Set(trackedFiles())
  for (const candidate of ['.env', '.env.local', '.env.production']) {
    if (tracked.has(candidate)) {
      findings.push({
        scope: 'versionado',
        file: candidate,
        line: 0,
        id: 'env-tracked',
        why: 'un archivo de entorno esta versionado',
        hits: 1,
      })
    }
  }

  say(`· versionado: ${tracked.size} archivos revisados`)
  say(`· sin versionar (no ignorados): ${nuevos.length} archivos revisados`)
  say(`· excepciones nominales: ${[...ALLOWED.keys()].join(', ')}`)

  if (findings.length === 0) {
    say('\nSIN HALLAZGOS: ni secretos ni `service_role` fuera de su sitio.')
    return { findings, code: 0 }
  }

  shout(`\n${findings.length} HALLAZGO(S):`)
  for (const f of findings) {
    shout(`  [${f.scope}] ${f.file}:${f.line} — ${f.why} (${f.id}, ${f.hits} coincidencia/s)`)
  }
  shout('\nEl valor no se imprime a proposito: un escaner que enseña el secreto lo publica otra vez.')
  return { findings, code: 1 }
}

/** Exportado para que el test pueda plantar una credencial y ver que salta. */
export { PATTERNS, serviceRoleJwtFindings, scan }

// Solo cuando se ejecuta como programa. Importado desde un test, no sale.
if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))) {
  process.exit(runSecretScan().code)
}
