/**
 * Mapas y direcciones sin costo (2026-11-15): OpenStreetMap.
 *
 *  · Teselas: `tile.openstreetmap.org` (con su atribución, obligatoria).
 *  · Buscar una dirección y su inversa: Nominatim.
 *
 * Nominatim es gratuito con condiciones: como mucho UNA consulta por segundo,
 * sin autocompletar mientras se teclea y con caché. Por eso aquí hay una cola
 * que espacia las llamadas y una caché en memoria, y quien llama solo busca al
 * dejar de escribir. Para mucho tráfico la salida es un Nominatim propio o un
 * proveedor con plan: este módulo es el único sitio que cambia.
 *
 * Lo que se envía es la dirección que el comprador escribió (o su punto, si
 * pulsa «Usar mi ubicación»): nada de su nombre, correo ni pedido.
 */

export interface LatLng {
  readonly lat: number
  readonly lng: number
}

/** Partes de una dirección, con los nombres del formulario de entrega. */
export interface AddressParts {
  readonly address: string
  readonly district: string
  readonly city: string
  readonly region: string
  readonly postalCode: string
  readonly country: string
}

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const NOMINATIM = 'https://nominatim.openstreetmap.org'

/** Lima, para abrir el mapa en algún sitio con sentido antes de saber nada. */
export const DEFAULT_CENTER: LatLng = { lat: -12.0464, lng: -77.0428 }

/** Enlace para el repartidor: abre el punto en Google Maps (o su app). */
export function mapsLink(point: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`
}

export function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false
  const { lat, lng } = value as Record<string, unknown>
  return (
    typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  )
}

/** Coordenadas de un `shipping_address` guardado (`latitude`/`longitude`). */
export function pointOfAddress(address: Record<string, unknown> | null | undefined): LatLng | null {
  if (!address) return null
  const lat = Number(address.latitude)
  const lng = Number(address.longitude)
  const point = { lat, lng }
  return address.latitude != null && address.longitude != null && isLatLng(point) ? point : null
}

// ---------------------------------------------------------------------------
// Cola: una consulta por segundo como mucho (condición de uso de Nominatim)
// ---------------------------------------------------------------------------
let ultima = 0
let cola: Promise<unknown> = Promise.resolve()
const cache = new Map<string, unknown>()

async function nominatim<T>(path: string): Promise<T | null> {
  if (cache.has(path)) return cache.get(path) as T
  const turno = cola.then(async () => {
    const espera = ultima + 1100 - Date.now()
    if (espera > 0) await new Promise((ok) => setTimeout(ok, espera))
    ultima = Date.now()
    const respuesta = await fetch(`${NOMINATIM}${path}`, { headers: { Accept: 'application/json' } })
    if (!respuesta.ok) return null
    return (await respuesta.json()) as T
  })
  cola = turno.catch(() => null)
  const resultado = await turno.catch(() => null)
  if (resultado !== null) cache.set(path, resultado)
  return resultado
}

interface NominatimPlace {
  lat?: string
  lon?: string
  address?: Record<string, string>
}

/** «Provincia de Lima» → «Lima»; «Gobierno Regional de Lima» → «Lima». */
function limpiar(nombre: string | undefined): string {
  return (nombre ?? '')
    .replace(/^(Provincia de|Gobierno Regional de|Departamento de|Regi[oó]n)\s+/i, '')
    .trim()
}

function partesDe(address: Record<string, string> | undefined): AddressParts {
  const a = address ?? {}
  const calle = [a.road ?? a.pedestrian ?? a.footway ?? '', a.house_number ?? ''].join(' ').trim()
  const distrito = a.city_district ?? a.suburb ?? a.town ?? a.village ?? a.city ?? ''
  return {
    address: calle || a.neighbourhood || '',
    district: limpiar(distrito),
    city: limpiar(a.county ?? a.city ?? a.state_district ?? ''),
    region: limpiar(a.state ?? a.region ?? ''),
    postalCode: a.postcode ?? '',
    country: (a.country_code ?? '').toUpperCase(),
  }
}

/** Dónde está una dirección escrita, o null si no se encuentra. */
export async function geocodeAddress(
  parts: { address: string; district?: string; city?: string; region?: string; country?: string },
): Promise<LatLng | null> {
  const q = [parts.address, parts.district, parts.city, parts.region]
    .map((parte) => (parte ?? '').trim())
    .filter(Boolean)
    .join(', ')
  if (q.length < 4) return null
  const pais = (parts.country ?? '').trim().toLowerCase()
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', 'accept-language': 'es', q })
  if (/^[a-z]{2}$/.test(pais)) params.set('countrycodes', pais)
  const lugares = await nominatim<NominatimPlace[]>(`/search?${params.toString()}`)
  const primero = lugares?.[0]
  const punto = { lat: Number(primero?.lat), lng: Number(primero?.lon) }
  return primero && isLatLng(punto) ? punto : null
}

/** Qué dirección hay en un punto (para «Usar mi ubicación»). */
export async function reverseGeocode(point: LatLng): Promise<AddressParts | null> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'es',
    lat: point.lat.toFixed(6),
    lon: point.lng.toFixed(6),
  })
  const lugar = await nominatim<NominatimPlace>(`/reverse?${params.toString()}`)
  return lugar?.address ? partesDe(lugar.address) : null
}

/** El GPS del navegador. Rechaza con `GEO_DENEGADA` / `GEO_NO_DISPONIBLE`. */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('GEO_NO_DISPONIBLE'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? 'GEO_DENEGADA' : 'GEO_NO_DISPONIBLE')),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  })
}

/** «a 1.2 km» / «a 350 m». */
export function formatDistance(km: number, locale: string): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(km)} km`
}
