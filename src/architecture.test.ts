/**
 * Fronteras de arquitectura, comprobadas sobre el código real (P01-SaaS).
 *
 * Un mapa de arquitectura en un documento envejece en semanas: nadie lo lee al
 * abrir un archivo y nada falla cuando se incumple. Estas reglas son las mismas
 * del ADR 001 escritas de forma que la suite se ponga roja el día que alguien
 * las cruce, que es la única versión que sigue siendo verdad dentro de un año.
 *
 * Cada regla dice qué protege. Ninguna es estilística: si una se relaja, se
 * pierde una propiedad concreta del producto.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOUNDARIES, DOMAIN_IDS, boundaryForPath } from '@/domain/boundaries'

const SRC = dirname(fileURLToPath(import.meta.url))

interface SourceFile {
  /** Ruta relativa a `src/`, con `/` siempre. */
  readonly path: string
  readonly text: string
  /** El mismo texto sin comentarios: un comentario que NOMBRA lo prohibido
   *  para explicar por qué no está no puede dar un falso positivo. */
  readonly code: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const ALL: readonly SourceFile[] = walk(SRC).map((full) => {
  const text = readFileSync(full, 'utf8')
  return { path: relative(SRC, full).replace(/\\/g, '/'), text, code: stripComments(text) }
})

const isTest = (file: SourceFile) => /\.test\.tsx?$/.test(file.path) || file.path.startsWith('test/')
const PRODUCTION = ALL.filter((file) => !isTest(file))

/** Todos los `from '...'` e `import('...')` de un archivo. */
function importsOf(file: SourceFile): string[] {
  const found: string[] = []
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(file.code)) !== null) found.push(match[1] as string)
  return found
}

// ---------------------------------------------------------------------------

describe('el dominio es puro', () => {
  // Solo produccion: el test del dominio importa `vitest`, que es exactamente
  // el tipo de dependencia que la regla persigue en un modulo de producto.
  const domain = PRODUCTION.filter((f) => f.path.startsWith('domain/'))

  it('hay dominio que comprobar', () => {
    expect(domain.length).toBeGreaterThan(5)
  })

  /**
   * Protege la reutilización. Supabase es la persistencia de HOY y el ERP del
   * tenant puede ser la de mañana para la mitad de estas preguntas. Un dominio
   * que sabe de `PostgrestError`, de `useQuery` o de un componente no se
   * reutiliza: se reescribe.
   */
  it('no importa nada de infraestructura, UI ni features', () => {
    const allowed = /^(\.\.?\/|zod$)/
    const offenders: string[] = []

    for (const file of domain) {
      for (const specifier of importsOf(file)) {
        if (!allowed.test(specifier)) offenders.push(`${file.path} -> ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /** Un import relativo que sale de `domain/` es la misma fuga por la puerta de atrás. */
  it('ningún import relativo escapa de src/domain', () => {
    const offenders = domain.flatMap((file) =>
      importsOf(file)
        .filter((s) => s.startsWith('.'))
        .filter((s) => {
          const resolved = join(SRC, dirname(file.path), s)
          return relative(join(SRC, 'domain'), resolved).startsWith('..')
        })
        .map((s) => `${file.path} -> ${s}`),
    )
    expect(offenders).toEqual([])
  })

  /**
   * Protege el contrato multitenant. `organization_id` y `company_id` salen
   * SIEMPRE del JWT en el servidor; un puerto que los acepte como parámetro
   * invita a pasarlos desde el navegador, que es exactamente lo que el
   * contrato prohíbe. Un parámetro que se puede pasar se puede pasar mal.
   */
  it('ningún puerto recibe el tenant como parámetro', () => {
    const offenders = domain
      .filter((f) => f.path.startsWith('domain/ports/'))
      .filter((f) => /organization_?[Ii]d|company_?[Ii]d|orgId/.test(f.code))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('Supabase es persistencia, no vocabulario de la UI', () => {
  const components = PRODUCTION.filter((f) => f.path.endsWith('.tsx'))

  /**
   * Protege la sustituibilidad del transporte y, sobre todo, la revisión de
   * seguridad: si una consulta puede nacer en cualquier componente, verificar
   * que ninguna declara su tenant obliga a leer las 60 pantallas en vez de la
   * docena de módulos de datos.
   *
   * `SessionProvider` es la única excepción y está justificada: la sesión de
   * Supabase Auth ES un estado de React (`onAuthStateChange` es una
   * suscripción), y envolverla en un módulo de datos solo movería el import.
   */
  const AUTH_STATE = 'features/auth/SessionProvider.tsx'

  it('ningún componente consulta la base directamente', () => {
    const offenders = components
      .filter((f) => /\.from\(\s*['"`]|\.rpc\(|functions\.invoke\(/.test(f.code))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('ningún componente crea un cliente de Supabase salvo el de la sesión', () => {
    const offenders = components
      .filter((f) => f.path !== AUTH_STATE)
      .filter((f) => importsOf(f).some((s) => /supabase/i.test(s)))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('el error del servidor no llega crudo a la pantalla', () => {
  /**
   * Protege dos cosas a la vez. Fuga: un `message` de PostgREST lleva dentro
   * nombres de tabla, de columna y de policy, y la vitrina la ve un comprador
   * anónimo. Y lógica: ramificar por texto se rompe en cuanto el servidor
   * cambia una palabra o responde en otro idioma. La regla del proyecto existe
   * desde P02; hasta P01 no se comprobaba, y había siete puntos que la
   * incumplían —cinco de ellos en la vitrina pública—.
   *
   * La única interpretación de texto admitida vive en `shared/lib/appError.ts`
   * y `shared/lib/edgeError.ts`, y de ahí sale un CÓDIGO.
   */
  const TEXT_READERS = [
    'shared/lib/appError.ts',
    'shared/lib/edgeError.ts',
    // Excepción documentada: el SDK de Supabase Auth no da código estable para
    // credenciales inválidas ni correo sin confirmar. La lectura muere en
    // `mapAuthError`, que devuelve una clave de i18n. Se retira en P16.
    'features/auth/authApi.ts',
  ]

  it('nadie construye un Error con el mensaje del servidor', () => {
    const offenders = PRODUCTION.filter((f) => /new Error\([^)]*\.message/.test(f.code)).map(
      (f) => f.path,
    )
    expect(offenders).toEqual([])
  })

  /**
   * Solo sobre módulos que NO son de presentación. En un `.tsx`,
   * `errors.name?.message` es un error de validación de React Hook Form —cuyo
   * `message` es, por convención de este repositorio, una clave de i18n— y no
   * tiene nada que ver con esto. La regla de arriba ya garantiza que ningún
   * `Error` lleva dentro el texto del servidor, así que pintarlo es seguro.
   */
  it('solo tres módulos de datos leen el texto de un error', () => {
    const offenders = PRODUCTION.filter((f) => !f.path.endsWith('.tsx'))
      .filter((f) => !TEXT_READERS.includes(f.path))
      .filter((f) => /error\??\.message|\.message\s*\.\s*(includes|match|startsWith)/.test(f.code))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('el contenido del tenant no puede convertirse en marcado (P11-SaaS)', () => {
  /**
   * Protege la decisión central del CMS: **el contenido enriquecido no es
   * HTML**. Se guarda como un documento de cuatro tipos de nodo
   * (`src/domain/content.ts`), lo valida un CHECK en Postgres y lo pinta
   * `shared/ui/RichText.tsx` mapeando nodo → componente.
   *
   * Toda esa cadena se cae con una sola línea: un `dangerouslySetInnerHTML`
   * puesto «solo para este caso». Por eso la regla no es «sanea antes de
   * inyectar» —que exige acordarse cada vez— sino «no existe el punto de
   * inyección», y esto es lo que la mantiene cierta.
   *
   * Incluye los tests: si un test lo usa, es que alguien está probando una ruta
   * de renderizado que no debería existir. Se mira el CÓDIGO y no el texto,
   * como el resto de reglas: nombrar lo prohibido en un comentario para
   * explicar por qué no está no puede poner la suite roja.
   */
  it('`dangerouslySetInnerHTML` no aparece en ningún archivo de src/', () => {
    const offenders = ALL.filter((file) => file.path !== 'architecture.test.ts')
      .filter((file) => /dangerouslySetInnerHTML/.test(file.code))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  /**
   * La otra mitad: `innerHTML`, `outerHTML` y `document.write` son la misma
   * puerta sin pasar por React.
   */
  it('nadie escribe HTML en el DOM a mano', () => {
    const offenders = PRODUCTION.filter((file) =>
      /\.(inner|outer)HTML\s*=|document\.write\(/.test(file.code),
    ).map((file) => file.path)
    expect(offenders).toEqual([])
  })
})

describe('el core no conoce a ningún cliente ni proveedor por su nombre', () => {
  /**
   * Protege la respuesta a AA0004 del pliego —«personalización por
   * configuración, no por modificación de código»— y el principio 2 del
   * contrato EBIM. El día que un nombre propio entra en `src/`, deja de ser
   * cierto que el mismo binario sirve a dos clientes.
   *
   * Los proveedores concretos son DATOS: filas de `integration_providers`. Los
   * nombres de cliente solo pueden aparecer en fixtures de test, donde son
   * tienda de mentira y no configuración.
   */
  const FORBIDDEN = [
    /\bsap\b/i,
    /\bbapi/i,
    /s\/?4hana/i,
    /\bodoo\b/i,
    /alicorp/i,
    /casa[-\s]nordica/i,
    /lib[eé]lula/i,
    /gurusoft/i,
    /drivein/i,
    /\bcognos\b/i,
  ]

  it('ni en código ni en comentarios de producto', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION) {
      if (file.path === 'architecture.test.ts') continue
      for (const pattern of FORBIDDEN) {
        if (pattern.test(file.text)) offenders.push(`${file.path} ~ ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('un módulo se activa por configuración, nunca por quién es el cliente', () => {
  /**
   * Los tres anti-patrones que P02-SaaS tiene que hacer imposibles, escritos
   * como reglas que fallan:
   *
   *  1. **Ningún uuid literal en producción.** `if (org === '3f2a…')` es la
   *     versión que sobrevive a la regla de arriba —no lleva el nombre del
   *     cliente dentro— y es exactamente igual de mortal: el mismo binario
   *     deja de servir a dos clientes. Los uuid de prueba viven en fixtures.
   *  2. **Ningún plan comercial en el código.** Los nombres de plan y el
   *     catálogo de addons son del hub (contrato §6); una tabla local de
   *     planes es el catálogo duplicado que el principio 2 prohíbe.
   */
  it('ningún uuid literal en código de producción', () => {
    const UUID = /['"`][0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}['"`]/
    const offenders = PRODUCTION.filter((f) => !f.path.startsWith('test/'))
      .filter((f) => UUID.test(f.code))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  /**
   * `plan` se guarda y se enseña en diagnóstico, pero NADA decide con él: la
   * traducción plan → módulos vive en el hub. El día que aparezca aquí una
   * lista de planes, esta app tendrá dos fuentes de verdad comerciales y la
   * segunda irá siempre por detrás de la facturación.
   */
  it('ningún nombre de plan comercial decide nada en el código', () => {
    const PLAN_DECISION = /\bplan\s*===?\s*['"`]|\bPLANS?\b\s*[:=]\s*[[{]/
    const offenders = PRODUCTION.filter((f) => PLAN_DECISION.test(f.code)).map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('el mapa de fronteras describe el código que hay', () => {
  /**
   * Protege el mapa de la obsolescencia. Una carpeta nueva bajo `features/`
   * sin dominio declarado rompe la suite, así que quien la crea tiene que
   * decidir a qué frontera pertenece — que es justo la decisión que, tomada
   * tarde, produce el módulo que no se sabe dónde va.
   */
  it('todo archivo de features pertenece a una frontera declarada', () => {
    const orphans = ALL.filter((f) => f.path.startsWith('features/'))
      .filter((f) => boundaryForPath(f.path) === null)
      .map((f) => f.path)
    expect(orphans).toEqual([])
  })

  it('las rutas declaradas existen', () => {
    const missing = BOUNDARIES.flatMap((b) => b.paths)
      .filter((p) => !existsSync(join(SRC, p)))
      .map((p) => `src/${p}`)
    expect(missing).toEqual([])
  })

  it('los doce dominios de negocio están todos declarados', () => {
    const declared = BOUNDARIES.filter((b) => b.kind === 'domain').map((b) => b.id)
    expect([...declared].sort()).toEqual([...DOMAIN_IDS].sort())
  })

  /**
   * Una frontera `implemented` sin una sola ruta en `src/` es una casilla
   * marcada por optimismo. Las `declared` y `partial` sí pueden no tener
   * código: eso es exactamente lo que declaran.
   */
  it('lo declarado como implementado tiene código', () => {
    const empty = BOUNDARIES.filter((b) => b.state === 'implemented' && b.paths.length === 0).map(
      (b) => b.id,
    )
    expect(empty).toEqual([])
  })
})

describe('la frontera de tipos generados no vuelve a quedar en cero (R11)', () => {
  /**
   * `npm run db:types` escribía con `> archivo`, y esa redirección TRUNCA antes
   * de ejecutar el comando: un fallo del CLI dejaba el archivo en 0 bytes y un
   * exit code que nadie miraba. Pasó, y nadie lo notó porque ningún módulo lo
   * importaba. El generador se arregló en `scripts/gen-db-types.mjs`; esto es
   * la segunda red, por si alguien vuelve a la redirección.
   */
  const GENERATED = join(SRC, 'shared/lib/database.types.ts')

  it('si el archivo existe, tiene contenido y declara Database', () => {
    if (!existsSync(GENERATED)) return
    const text = readFileSync(GENERATED, 'utf8')
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).toMatch(/export type Database\b/)
  })
})

/**
 * Storefront V3 · P14 · La vitrina no puede arrastrarse de lado (R12).
 *
 * ## El fallo que esto impide
 *
 * `100vw` incluye el ancho de la barra de desplazamiento vertical. En cuanto hay
 * barra —o sea, en casi cualquier página de tienda— una caja de `100vw` mide más
 * que el hueco disponible y aparece una **barra horizontal en toda la tienda**.
 * El visitante la nota como una página que «se mueve» al deslizar, y en un
 * teléfono es peor: el gesto de desplazar vertical arrastra de lado.
 *
 * Es un fallo caro y de una línea, y la vitrina tiene seis sitios que podrían
 * cometerlo: cada sección que se saca a sangre.
 *
 * ## La regla, con su única excepción
 *
 * El ancho de ventana se saca con `50vw` y el truco vive en **un solo sitio**
 * —`StoreSectionFrame`, desde V3 · P06—. Ningún archivo de la vitrina escribe
 * `100vw` para MEDIR algo.
 *
 * La excepción es `maxWidth`, y es lo contrario de este fallo: un tope de ancho
 * no puede provocar desbordamiento, lo evita. Lo usa el panel de sugerencias del
 * buscador para no salirse de la pantalla en un teléfono. Se permite nombrada,
 * no en general.
 *
 * Se mira el texto SIN comentarios —este comentario nombra lo prohibido— y se
 * dejan fuera los archivos de prueba, que lo nombran para comprobar que NO está.
 */
describe('la vitrina no usa 100vw para medir (R12)', () => {
  it('ningún archivo de la vitrina lo escribe fuera de un tope de ancho', () => {
    const culpables: string[] = []

    for (const file of ALL) {
      if (!file.path.startsWith('features/storefront/')) continue
      if (file.path.endsWith('.test.ts') || file.path.endsWith('.test.tsx')) continue

      for (const linea of file.code.split('\n')) {
        if (!linea.includes('100vw')) continue
        // Un tope de ancho es la excepción declarada arriba.
        if (/maxWidth/.test(linea)) continue
        culpables.push(`${file.path}: ${linea.trim()}`)
      }
    }

    expect(culpables).toEqual([])
  })

  it('ni el archivo de estilos de la vitrina', () => {
    const css = join(SRC, 'features/storefront/storefront.css')
    if (!existsSync(css)) return
    // Los comentarios de un `.css` no se quitan aquí: si alguno nombrara el
    // valor prohibido, es mejor que salte y se reescriba el comentario.
    expect(readFileSync(css, 'utf8')).not.toMatch(/100vw/)
  })
})
