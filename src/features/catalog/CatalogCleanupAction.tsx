import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { fetchCatalogCleanupRows } from './api/products'
import { analizarCatalogo, type CleanupRow, type GrupoLimpieza, type ProblemaNombre } from './cleanup'

type Seccion = 'duplicados' | 'tamanos' | 'sinFoto' | 'sinDescripcion' | 'sinAtributos' | 'sinCategoria' | 'nombres'
const SECCIONES: readonly Seccion[] = ['duplicados', 'tamanos', 'sinFoto', 'sinDescripcion', 'sinAtributos', 'sinCategoria', 'nombres']

const PROBLEMA: Record<ProblemaNombre, MessageKey> = {
  mayusculas: 'catalogCleanup.name.uppercase',
  espacios: 'catalogCleanup.name.spaces',
  repetido: 'catalogCleanup.name.repeated',
}

/** Tope por sección en pantalla: la lista completa sale del buscador. */
const MAX_FILAS = 60

/**
 * «Revisar catálogo» (2026-11-22): duplicados, tamaños sueltos que deberían ser
 * variantes, productos sin foto, descripción o categoría y nombres con formato
 * raro. La detección es por reglas (`cleanup.ts`); nada se corrige solo: cada
 * fila lleva al producto en la lista con «Ver».
 */
export function CatalogCleanupAction({
  storeId,
  onSearch,
  open: controlado,
  onClose,
}: {
  storeId: string | null
  onSearch: (texto: string) => void
  /** Modo controlado (p. ej. desde un menú): sin botón propio, abre con `open`. */
  open?: boolean
  onClose?: () => void
}) {
  const { t } = useI18n()
  const [abiertoPropio, setAbiertoPropio] = useState(false)
  const abierto = controlado ?? abiertoPropio
  const setAbierto = (valor: boolean) => {
    setAbiertoPropio(valor)
    if (!valor) onClose?.()
  }
  const [seccion, setSeccion] = useState<Seccion>('duplicados')

  const query = useQuery({
    queryKey: ['catalog', 'cleanup', storeId],
    queryFn: () => fetchCatalogCleanupRows(storeId),
    enabled: abierto && Boolean(storeId),
    staleTime: 60_000,
  })
  const hallazgos = useMemo(() => (query.data ? analizarCatalogo(query.data) : null), [query.data])

  const cuenta = (s: Seccion) => (hallazgos ? hallazgos[s].length : 0)
  const ver = (p: CleanupRow) => {
    onSearch(p.sku ?? p.name)
    setAbierto(false)
  }

  const fila = (p: CleanupRow, extra?: string) => (
    <Stack key={p.product_id} direction="row" sx={{ alignItems: 'center', gap: 1 }} data-cleanup-product={p.product_id}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{p.name}</Typography>
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          {[p.sku, p.brand_name, extra].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <Button size="small" onClick={() => ver(p)} aria-label={`${t('catalogCleanup.view')} · ${p.name}`}>
        {t('catalogCleanup.view')}
      </Button>
    </Stack>
  )

  const grupos = (lista: readonly GrupoLimpieza[]) => (
    <Stack sx={{ gap: 1.5 }}>
      {lista.slice(0, MAX_FILAS).map((g) => (
        <Box key={g.clave} sx={{ p: 1.25, border: '1px solid var(--border)', borderRadius: 0.67 }} data-cleanup-group>
          <Stack sx={{ gap: 0.75 }}>{g.productos.map((p) => fila(p))}</Stack>
        </Box>
      ))}
    </Stack>
  )

  function contenido() {
    if (!hallazgos) return null
    const vacia = cuenta(seccion) === 0
    if (vacia) return <EmptyState title={t('catalogCleanup.cleanTitle')} description={t('catalogCleanup.clean')} />
    switch (seccion) {
      case 'duplicados':
        return grupos(hallazgos.duplicados)
      case 'tamanos':
        return grupos(hallazgos.tamanos)
      case 'nombres':
        return <Stack sx={{ gap: 0.75 }}>{hallazgos.nombres.slice(0, MAX_FILAS).map((n) => fila(n.producto, t(PROBLEMA[n.problema])))}</Stack>
      default:
        return <Stack sx={{ gap: 0.75 }}>{hallazgos[seccion].slice(0, MAX_FILAS).map((p) => fila(p))}</Stack>
    }
  }

  return (
    <>
      {controlado === undefined && (
        <Button variant="outlined" startIcon={<FactCheckRoundedIcon />} onClick={() => setAbierto(true)} disabled={!storeId}>
          {t('catalogCleanup.action')}
        </Button>
      )}
      <Dialog open={abierto} onClose={() => setAbierto(false)} fullWidth maxWidth="md" aria-labelledby="catalog-cleanup-title">
        <DialogTitle id="catalog-cleanup-title">{t('catalogCleanup.title')}</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ color: 'var(--muted)', mb: 1.5 }}>{t('catalogCleanup.intro')}</Typography>
          {query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <>
              <Tabs
                value={seccion}
                onChange={(_, v: Seccion) => setSeccion(v)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                centered={false}
                aria-label={t('catalogCleanup.title')}
                sx={{ mb: 1.5 }}
              >
                {SECCIONES.map((s) => (
                  <Tab key={s} value={s} label={`${t(`catalogCleanup.tab.${s}` as MessageKey)} (${cuenta(s)})`} />
                ))}
              </Tabs>
              <Alert severity="info" sx={{ mb: 1.5 }}>
                {t(`catalogCleanup.hint.${seccion}` as MessageKey)}
              </Alert>
              {contenido()}
              {cuenta(seccion) > MAX_FILAS && (
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'var(--muted)' }}>
                  {t('catalogCleanup.more').replace('{count}', String(cuenta(seccion) - MAX_FILAS))}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAbierto(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
