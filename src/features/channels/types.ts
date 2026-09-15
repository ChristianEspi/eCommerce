import { z } from 'zod'

export {
  CHANNELS_TABLE,
  CHANNEL_SET_DEFAULT_RPC,
  CHANNEL_CATALOG_SUMMARY_RPC,
} from '@/shared/lib/db-schema'

/**
 * Canales de venta en el CLIENTE (cierre · item 7).
 *
 * Mitad de pantalla de `20260827130000_channels.sql` y
 * `20260914150000_channels_admin.sql`. El canal NO es una tienda: es una
 * dimension sobre el catalogo unico, y por eso esta pantalla no duplica ni un
 * producto — solo dice por donde se vende y quien puede entrar.
 *
 * Este modulo es la UNICA lectura de canales en el navegador. Precios lo
 * reutiliza para sus desplegables en vez de tener su propia consulta: dos
 * lecturas de la misma tabla acaban enseñando dos listas distintas.
 */

export const CHANNEL_KINDS = ['b2c', 'b2b', 'internal'] as const
export type ChannelKind = (typeof CHANNEL_KINDS)[number]

/**
 * Si un canal exige sesion lo decide su TIPO, no una casilla.
 *
 * La base lo impone con `channels_auth_matches_kind`: un canal publico que pide
 * sesion es una contradiccion, y uno cerrado que no la pide es una fuga. La
 * pantalla lo deriva en vez de preguntarlo para que no exista el formulario que
 * la base rechazaria.
 */
export function requiresAuthFor(kind: ChannelKind): boolean {
  return kind !== 'b2c'
}

export const channelSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(CHANNEL_KINDS),
  is_default: z.boolean(),
  requires_auth: z.boolean(),
  is_active: z.boolean(),
})
export type Channel = z.infer<typeof channelSchema>
/**
 * La forma minima que usan los desplegables de precios. Un `Channel` completo
 * la cumple, asi que la misma lectura sirve a las dos pantallas.
 */
export const channelOptionSchema = channelSchema.pick({
  id: true,
  code: true,
  name: true,
  kind: true,
  is_default: true,
  is_active: true,
})
export type ChannelOption = z.infer<typeof channelOptionSchema>

/** Una fila de `channel_catalog_summary`. `bigint` llega como texto o numero. */
export const channelCatalogCountSchema = z.object({
  channel_id: z.string().uuid(),
  product_count: z.coerce.number().int().nonnegative(),
})
export type ChannelCatalogCount = z.infer<typeof channelCatalogCountSchema>

/**
 * Por que un canal no puede ser el de defecto, o `null` si puede.
 *
 * Es la MISMA regla que aplica `channel_set_default` en el servidor —activo y
 * B2C—, repetida aqui solo para apagar el boton y decir por que. La autoridad
 * sigue siendo la base: si esta copia se quedara atras, el servidor responde
 * con su codigo y la pantalla lo traduce.
 */
export function defaultBlocker(channel: Channel): 'already' | 'inactive' | 'closed' | null {
  if (channel.is_default) return 'already'
  if (!channel.is_active) return 'inactive'
  if (channel.requires_auth) return 'closed'
  return null
}

export const channelFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,40}$/, 'channels.error.code'),
  name: z.string().trim().min(1, 'channels.error.name').max(120, 'channels.error.name'),
  kind: z.enum(CHANNEL_KINDS),
  is_active: z.boolean(),
})
export type ChannelFormValues = z.infer<typeof channelFormSchema>

export function emptyChannelForm(): ChannelFormValues {
  // B2B por defecto: el canal publico ya lo crea la base con cada tienda, asi
  // que quien pulsa «Nuevo canal» casi siempre viene a abrir uno cerrado.
  return { code: '', name: '', kind: 'b2b', is_active: true }
}