import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
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
 * permiso— y los dibuja con pdf.js. Pantalla completa en el celular. Descargar
 * e Imprimir usan el MISMO archivo que se ve, nunca un enlace externo.
 */
export interface PdfSource {
  readonly bytes: Uint8Array
  readonly filename: string
}

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

  useEffect(() => {
    if (!open) return
    let alive = true
    setState('loading')
    setSource(null)
    load()
      .then(async (pdf) => {
        if (!alive) return
        setSource(pdf)
        const host = pagesRef.current
        const width = Math.max(280, Math.min((host?.clientWidth ?? 720) - 16, 900))
        const pages = await renderPdf(pdf.bytes, width)
        if (!alive || !pagesRef.current) return
        pagesRef.current.replaceChildren(
          ...pages.map((p, i) => {
            p.canvas.style.width = `${p.width}px`
            p.canvas.style.height = `${p.height}px`
            p.canvas.style.maxWidth = '100%'
            p.canvas.style.height = 'auto'
            p.canvas.style.display = 'block'
            p.canvas.style.margin = '0 auto 12px'
            p.canvas.style.background = '#fff'
            p.canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.18)'
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
    // `load` cambia en cada render del padre; abrir es lo que dispara la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const blobUrl = () => (source ? URL.createObjectURL(new Blob([source.bytes as BlobPart], { type: 'application/pdf' })) : null)

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
    // Imprimir el PDF original (no la pantalla): se abre en una pestaña propia,
    // donde el visor del navegador lo imprime con su formato.
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="md" aria-labelledby="pdf-preview-title">
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid var(--line)' }}
      >
        <Typography id="pdf-preview-title" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
          {title}
        </Typography>
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
      <DialogContent sx={{ bgcolor: 'var(--neutral-soft, #eef1f0)', p: { xs: 1, sm: 2 }, minHeight: { sm: 480 } }}>
        {state === 'loading' && <BrandLoader />}
        {state === 'error' && <Alert severity="error">{t('pdf.error')}</Alert>}
        <Box ref={pagesRef} sx={{ display: state === 'error' ? 'none' : 'block' }} />
      </DialogContent>
    </Dialog>
  )
}
