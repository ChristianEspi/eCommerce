import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { renderPdf } from '@/shared/lib/pdf/renderPdf'
import { BrandLoader } from './BrandLoader'

/**
 * Visor de PDF dentro de la web (2026-11-20).
 *
 * Recibe una función que trae los bytes —quien llama decide de dónde y con qué
 * permiso— y los dibuja con pdf.js a su TAMAÑO REAL: un ticket de 80 mm se ve
 * como ticket y un A4 como A4; solo se reduce si no cabe (el celular). Zoom de
 * 50 % a 200 %. Pantalla completa en el celular. Descargar e Imprimir usan el
 * MISMO archivo que se ve, nunca un enlace externo.
 */
export interface PdfSource {
  readonly bytes: Uint8Array
  readonly filename: string
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function PdfPreviewDialog({
  open,
  title,
  load,
  onClose,
}: {
  open: boolean
  title: string
  load: () => Promise<PdfSource>
  onClose: () => void
}) {
  const { t } = useI18n()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const pagesRef = useRef<HTMLDivElement | null>(null)
  const [source, setSource] = useState<PdfSource | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [zoomIndex, setZoomIndex] = useState(2)
  const zoom = ZOOMS[zoomIndex] ?? 1

  // 1 · Al abrir: traer los bytes una sola vez.
  useEffect(() => {
    if (!open) return
    let alive = true
    setState('loading')
    setSource(null)
    setZoomIndex(2)
    load()
      .then((pdf) => {
        if (alive) setSource(pdf)
      })
      .catch(() => {
        if (alive) setState('error')
      })
    return () => {
      alive = false
    }
    // `load` cambia en cada render del padre; abrir es lo que dispara la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 2 · Dibujar (y volver a dibujar al cambiar el zoom) sin volver a pedirlo.
  useEffect(() => {
    if (!open || !source) return
    let alive = true
    const host = pagesRef.current
    const maxWidth = Math.max(240, (host?.clientWidth ?? 720) - 8)
    renderPdf(source.bytes, maxWidth, zoom)
      .then((pages) => {
        if (!alive || !pagesRef.current) return
        pagesRef.current.replaceChildren(
          ...pages.map((p, i) => {
            const style = p.canvas.style
            style.width = `${p.width}px`
            style.maxWidth = '100%'
            style.height = 'auto'
            style.display = 'block'
            style.margin = '0 auto 12px'
            style.background = '#fff'
            style.boxShadow = '0 1px 4px rgba(0,0,0,.18)'
            p.canvas.setAttribute('role', 'img')
            p.canvas.setAttribute('aria-label', `${title} · ${t('pdf.page')} ${i + 1}`)
            return p.canvas
          }),
        )
        setState('ready')
      })
      .catch(() => {
        if (alive) setState('error')
      })
    return () => {
      alive = false
    }
  }, [open, source, zoom, title, t])

  const blobUrl = () =>
    source ? URL.createObjectURL(new Blob([source.bytes as BlobPart], { type: 'application/pdf' })) : null

  const download = () => {
    const url = blobUrl()
    if (!url || !source) return
    const a = document.createElement('a')
    a.href = url
    a.download = source.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const print = () => {
    const url = blobUrl()
    if (!url) return
    // Imprimir el PDF original (no la pantalla): en una pestaña propia, donde el
    // visor del navegador lo imprime con su formato.
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="md"
      aria-labelledby="pdf-preview-title"
    >
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ alignItems: 'center', px: 1.5, py: 1, borderBottom: '1px solid var(--line)' }}
      >
        <Typography id="pdf-preview-title" sx={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0 }} noWrap>
          {title}
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center' }} aria-label={t('pdf.zoom')} role="group">
          <IconButton
            size="small"
            aria-label={t('pdf.zoomOut')}
            disabled={state !== 'ready' || zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
          >
            <RemoveRoundedIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ fontSize: 12, minWidth: 40, textAlign: 'center', color: 'var(--muted)' }} aria-live="polite">
            {`${Math.round(zoom * 100)} %`}
          </Typography>
          <IconButton
            size="small"
            aria-label={t('pdf.zoomIn')}
            disabled={state !== 'ready' || zoomIndex === ZOOMS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}
          >
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Button
          size="small"
          startIcon={<PrintRoundedIcon fontSize="small" />}
          onClick={print}
          disabled={state !== 'ready'}
          sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
        >
          {t('pdf.print')}
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<DownloadRoundedIcon fontSize="small" />}
          onClick={download}
          disabled={state !== 'ready'}
        >
          {t('pdf.download')}
        </Button>
        <IconButton onClick={onClose} aria-label={t('common.close')} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <DialogContent sx={{ bgcolor: 'var(--neutral-soft, #eef1f0)', p: { xs: 1, sm: 2 }, minHeight: { sm: 420 } }}>
        {state === 'loading' && <BrandLoader />}
        {state === 'error' && <Alert severity="error">{t('pdf.error')}</Alert>}
        <Box ref={pagesRef} sx={{ display: state === 'error' ? 'none' : 'block' }} />
      </DialogContent>
    </Dialog>
  )
}
