import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * Piezas para los paneles de DETALLE (2026-11-17).
 *
 * Los cajones de solo lectura —un cobro, una devolución, un incidente— se
 * armaban cada uno a su manera: un `subtitle2` suelto, texto gris, filas de
 * chips sin alinear y el código de máquina tal cual. Estas tres piezas dan el
 * mismo esqueleto a todos: un título de sección que se distingue del contenido,
 * datos en rejilla etiqueta/valor, y una línea de tiempo con fecha y origen.
 */

const HEADING_SX = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
} as const

/** El título de una sección de un panel, suelto (cuando la sección no es un `DetailSection`). */
export function DetailHeading({ children }: { children: ReactNode }) {
  return (
    <Typography component="h3" sx={HEADING_SX}>
      {children}
    </Typography>
  )
}

/** Una sección con su título; `aside` va a la derecha del título (un chip, un botón). */
export function DetailSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Stack component="section" spacing={1.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <DetailHeading>{title}</DetailHeading>
        {aside}
      </Stack>
      {children}
    </Stack>
  )
}

export interface DetailFact {
  label: string
  value: ReactNode
  /** Ocupa las dos columnas (direcciones, notas largas). */
  wide?: boolean
}

/** Datos en rejilla: dos columnas desde `sm`, una en móvil. */
export function DetailFacts({ facts }: { facts: readonly DetailFact[] }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        p: 2,
        borderRadius: 2,
        border: '1px solid var(--border)',
        bgcolor: 'var(--bg)',
      }}
    >
      {facts.map((fact) => (
        <Box key={fact.label} sx={{ minWidth: 0, gridColumn: fact.wide ? { sm: '1 / -1' } : undefined }}>
          <Typography component="dt" sx={{ fontSize: 12, color: 'var(--muted)', mb: 0.25 }}>
            {fact.label}
          </Typography>
          <Typography component="dd" sx={{ m: 0, fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
            {fact.value}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export interface TimelineEntry {
  id: string
  title: string
  /** Fecha ya formateada. */
  when?: string
  /** Una línea secundaria: origen, quién, detalle. */
  meta?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'error'
}

const DOT: Record<NonNullable<TimelineEntry['tone']>, string> = {
  default: 'var(--muted)',
  success: 'var(--accent)',
  warning: 'var(--amber)',
  error: 'var(--red)',
}

/** Línea de tiempo vertical: punto, qué pasó, cuándo y de dónde vino. */
export function DetailTimeline({ entries, empty }: { entries: readonly TimelineEntry[]; empty: string }) {
  if (entries.length === 0) {
    return <Typography sx={{ color: 'var(--muted)', fontSize: 14 }}>{empty}</Typography>
  }
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {entries.map((entry, index) => (
        <Box
          component="li"
          key={entry.id}
          sx={{ display: 'grid', gridTemplateColumns: '20px 1fr', columnGap: 1.25 }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                mt: '5px',
                borderRadius: '50%',
                bgcolor: DOT[entry.tone ?? 'default'],
                flexShrink: 0,
              }}
            />
            {index < entries.length - 1 && (
              <Box aria-hidden sx={{ flex: 1, width: 2, bgcolor: 'var(--border)', my: 0.5 }} />
            )}
          </Box>
          <Box sx={{ pb: index < entries.length - 1 ? 2 : 0, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{entry.title}</Typography>
            {(entry.when || entry.meta) && (
              <Typography component="div" sx={{ fontSize: 12.5, color: 'var(--muted)', mt: 0.25 }}>
                {entry.when}
                {entry.when && entry.meta ? ' · ' : ''}
                {entry.meta}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
