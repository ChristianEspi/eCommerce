import { en } from './messages.en'
import { es as esCore } from './messages.es'
import { esBackoffice } from './messages.es.backoffice'
import type { Dictionary, Locale } from './messages'

/** El español ENTERO: vitrina + backoffice, como lo ve una pantalla ya cargada. */
const es: Dictionary = { ...esCore, ...esBackoffice }

/**
 * Los dos diccionarios juntos, para los TESTS de paridad.
 *
 * Deliberadamente fuera de `messages.ts`: importar los dos de forma estática es
 * exactamente lo que P15-SaaS dejó de hacer en producción (61,76 kB gzip en el
 * bundle de entrada, la mitad de un idioma que no se lee). Aquí no molesta —los
 * tests no se descargan— y permite comparar clave a clave sin `await`.
 *
 * Si alguna vez aparece un `import` de este módulo desde `src/features` o
 * `src/app`, el ahorro se ha perdido: hay un test que lo comprueba.
 */
export const MESSAGES: Readonly<Record<Locale, Dictionary>> = { es, en }
