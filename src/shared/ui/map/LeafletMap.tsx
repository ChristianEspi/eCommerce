import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { DEFAULT_CENTER, OSM_ATTRIBUTION, OSM_TILES, type LatLng } from '@/shared/lib/geo'
import type { MapViewProps } from './MapView'

/**
 * El mapa de verdad (Leaflet + OpenStreetMap). Se carga bajo demanda desde
 * `MapView`: quien no llega a un paso con mapa no descarga Leaflet.
 *
 * Los pines son `divIcon` con SVG en línea y colores de los tokens, no las
 * imágenes PNG de Leaflet: esas rompen con el empaquetador y no siguen el tema.
 */
function pinIcon(kind: 'pin' | 'place' | 'selected' | 'disabled'): L.DivIcon {
  const color =
    kind === 'pin'
      ? 'var(--accent-deep, #056769)'
      : kind === 'selected'
        ? 'var(--accent, #5AA97F)'
        : kind === 'disabled'
          ? '#9aa4a8'
          : 'var(--accent, #5AA97F)'
  const size = kind === 'selected' || kind === 'pin' ? 34 : 28
  return L.divIcon({
    className: 'ebim-map-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    tooltipAnchor: [0, -size],
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 2C8 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>`,
  })
}

/** Encuadra lo que hay que ver: el pin, o todas las tiendas, o el centro. */
function Encuadre({ points, zoom }: { points: readonly LatLng[]; zoom: number }) {
  const map = useMap()
  const clave = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
  useEffect(() => {
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], Math.max(map.getZoom(), zoom))
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 15 })
    // `clave` resume `points`: re-encuadrar solo cuando cambian de verdad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, map, zoom])
  return null
}

function ClickParaMover({ onMove }: { onMove?: (point: LatLng) => void }) {
  useMapEvents({
    click: (evento) => onMove?.({ lat: evento.latlng.lat, lng: evento.latlng.lng }),
  })
  return null
}

export default function LeafletMap({ pin, places = [], onPlaceSelect, height = 260, zoom = 16, ariaLabel }: MapViewProps) {
  const encuadre = useMemo<LatLng[]>(
    () => (pin?.position ? [pin.position] : places.map((p) => p.position)),
    [pin?.position, places],
  )
  const centro = encuadre[0] ?? DEFAULT_CENTER

  return (
    <div role="region" aria-label={ariaLabel} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <MapContainer center={[centro.lat, centro.lng]} zoom={encuadre.length ? zoom : 11} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} maxZoom={19} />
        <Encuadre points={encuadre} zoom={zoom} />
        {pin?.draggable && <ClickParaMover onMove={pin.onMove} />}
        {places.map((place) => (
          <Marker
            key={place.id}
            position={[place.position.lat, place.position.lng]}
            icon={pinIcon(place.disabled ? 'disabled' : place.selected ? 'selected' : 'place')}
            eventHandlers={{ click: () => !place.disabled && onPlaceSelect?.(place.id) }}
            keyboard
            title={place.label}
          >
            <Tooltip direction="top">{place.label}</Tooltip>
          </Marker>
        ))}
        {pin?.position && (
          <Marker
            position={[pin.position.lat, pin.position.lng]}
            icon={pinIcon('pin')}
            draggable={pin.draggable}
            eventHandlers={{
              dragend: (evento) => {
                const p = (evento.target as L.Marker).getLatLng()
                pin.onMove?.({ lat: p.lat, lng: p.lng })
              },
            }}
            title={pin.label}
          />
        )}
      </MapContainer>
    </div>
  )
}
