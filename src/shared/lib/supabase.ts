import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertNoServiceKey, isSupabaseConfigured } from './env'

let client: SupabaseClient | null = null

/**
 * Cliente Supabase del navegador. Usa únicamente la clave publicable:
 * el aislamiento lo hace RLS con `organization_id`/`company_id` del JWT,
 * nunca un filtro que declare el cliente.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase no está configurado. Copia `.env.example` a `.env` y define ' +
        'VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.',
    )
  }
  if (!client) {
    assertNoServiceKey()
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ecommerce-auth',
      },
    })
  }
  return client
}

/** Para pantallas que deben degradar a estado vacío en vez de reventar. */
export function tryGetSupabaseClient(): SupabaseClient | null {
  return isSupabaseConfigured ? getSupabaseClient() : null
}

let storefrontClient: SupabaseClient | null = null

/**
 * Cliente del STOREFRONT público: anónimo siempre, aunque el visitante tenga
 * sesión de backoffice abierta.
 *
 * No es un detalle: las policies públicas son `to anon`, así que un usuario
 * logueado navegando la vitrina vería cero productos con el cliente normal.
 * Y al revés — dar esas policies a `authenticated` dejaría a un usuario del
 * tenant A leer columnas internas del catálogo del tenant B. Separar el cliente
 * resuelve las dos cosas y encaja con la separación storefront/backoffice.
 */
export function getStorefrontClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase no está configurado. Copia `.env.example` a `.env` y define ' +
        'VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.',
    )
  }
  if (!storefrontClient) {
    assertNoServiceKey()
    storefrontClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }
  return storefrontClient
}

/** Variante tolerante para pantallas públicas mientras no haya backend. */
export function tryGetStorefrontClient(): SupabaseClient | null {
  return isSupabaseConfigured ? getStorefrontClient() : null
}

/**
 * Cliente para las FUNCIONES de la vitrina que dependen de QUIÉN compra.
 *
 * La regla de arriba —la vitrina navega siempre anónima— vale para las vistas,
 * que es donde nació: sus policies son `to anon` y darlas a `authenticated`
 * abriría el catálogo interno de un tenant al usuario de otro.
 *
 * Con las funciones el problema es el contrario, y costó verlo: cotizar es
 * `security definer`, no depende de ninguna policy, y **necesita saber quién
 * pregunta**. Desde P19 el precio del acuerdo sale de `ebim.user_id()`, así que
 * pedirlo con el cliente anónimo es garantizar que el comprador B2B vea el
 * precio de catálogo aunque tenga sesión — que es exactamente lo que pasaba: el
 * motor resolvía bien y el navegador no le decía a quién.
 *
 * Sin sesión, `supabase-js` manda la clave publicable y la llamada entra como
 * `anon`, igual que antes. Con sesión manda el token del comprador. Las dos
 * cosas están concedidas en la base, así que no hay caso degradado.
 *
 * Es el mismo criterio que ya usaba el carrito de servidor, que lleva desde P07
 * eligiendo cliente según haya sesión o no.
 */
export function tryGetStorefrontRpcClient(): SupabaseClient | null {
  return isSupabaseConfigured ? getSupabaseClient() : null
}
