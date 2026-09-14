import { defineConfig, devices } from '@playwright/test'

/**
 * E2E de la vitrina.
 *
 * ## Por qué `.e2e.ts` y no `.spec.ts`
 *
 * Vitest no declara `include`, así que usa el patrón por defecto —`.test.` y
 * `.spec.`— y se llevaría estos archivos por delante: intentaría ejecutarlos en
 * jsdom, sin navegador ni servidor, y 2924 tests verdes pasarían a rojo por un
 * problema de nombres. Con otra extensión los dos corredores se ignoran sin que
 * haya que tocar la configuración del que ya funciona.
 *
 * ## Contra datos REALES
 *
 * El servidor de desarrollo levanta con el `.env` del repositorio, así que esto
 * recorre el catálogo de verdad del proyecto de demo. Es deliberado: lo que hay
 * que validar antes de una demo es la demo, no un catálogo de mentira. El precio
 * de esa decisión es que la suite depende de la red y del estado del tenant, y
 * por eso `demo-preflight.mjs` existe y se corre antes.
 *
 * ## Móvil y escritorio, siempre las dos
 *
 * El punto 5 del prompt de validación pide las dos, y una vitrina que solo se ha
 * mirado en escritorio es media vitrina: la mitad de quien compra llega por
 * teléfono.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // Contra un servidor real hay latencia de red en cada paso.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // En serie: comparten el mismo tenant y el mismo carrito de localStorage.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    // Rastro solo del intento fallido: es lo que se abre para entender el fallo,
    // y guardarlo siempre llena el disco de recorridos que nadie mira.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-PE',
  },

  /**
   * Dos familias de proyectos.
   *
   * `escritorio` y `movil` recorren la vitrina SIN crear nada: se pueden correr
   * contra la demo real antes de enseñarla.
   *
   * `comercio-*` (hardening H09-H11) recorren las tres experiencias de compra
   * —consumidor, comercio y empresa— hasta el PEDIDO, con cuentas de fixture que
   * llegan por entorno (`scripts/e2e-local-fixtures.mjs` en una pila local). Van
   * aparte porque crean pedidos de verdad: no se lanzan contra una demo por
   * accidente al escribir `--project=escritorio`.
   */
  projects: [
    { name: 'escritorio', testIgnore: '**/commerce/**', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil', testIgnore: '**/commerce/**', use: { ...devices['Pixel 5'] } },
    {
      name: 'comercio-escritorio',
      testMatch: '**/commerce/*.e2e.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'comercio-movil', testMatch: '**/commerce/*.e2e.ts', use: { ...devices['Pixel 5'] } },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
