import { Skeleton } from '@mui/material'
import { Suspense, lazy } from 'react'
import type { LatLng } from '@/shared/lib/geo'

export interface MapPlace {
  readonly id: string
  readonly position: LatLng
  readonly label: string
  readonly selected?: boolean
  /** Se pinta en gris y no se puede elegir (p. ej. tienda sin stock). */
  readonly disabled?: boolean
}

export interface MapViewProps {
  /** El punto propio (entrega o tienda que se edita). Arrastrable si se pide. */
  readonly pin?: {
    readonly position: LatLng | null
    readonly draggable?: boolean
    readonly onMove?: (point: LatLng) => void
    readonly label?: string
  }
  /** Lugares para elegir (tiendas de recojo). */
  readonly places?: readonly MapPlace[]
  readonly onPlaceSelect?: (id: string) => void
  readonly height?: number
  readonly zoom?: number
  readonly ariaLabel: string
}

const LeafletMap = lazy(() => import('./LeafletMap'))

/**
 * Mapa de OpenStreetMap, cargado bajo demanda (2026-11-15).
 *
 * Esta es la única puerta: las pantallas usan `MapView` y nunca Leaflet
 * directamente, así que cambiar de proveedor de mapas es cambiar un archivo.
 */
export function MapView(props: MapViewProps) {
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={props.height ?? 260} />}>
      <LeafletMap {...props} />
    </Suspense>
  )
}
