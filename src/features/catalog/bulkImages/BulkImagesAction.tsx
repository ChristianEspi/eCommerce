import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { prepareProductPhoto, type PhotoWarning } from '@/shared/lib/productPhoto'
import { fetchImageCounts, fetchSkuIndex, fetchVariantSkuIndex, type VariantTarget } from '../api/bulkImages'
import { CatalogError } from '../api/errors'
import { ALLOWED_IMAGE_TYPES, uploadProductImage } from '../api/images'
import { CATALOG_KEY } from '../useProducts'
import { matchFiles } from './match'

/**
 * «Subir imágenes»: muchas fotos a la vez, emparejadas por SKU.
 *
 * Tres pasos que no se saltan:
 *
 *  1. **Elegir** fotos sueltas o una carpeta entera. Antes se decide si se
 *     preparan en cuadrado blanco (recomendado y marcado).
 *  2. **Revisar** lo que va a pasar, foto por foto, ANTES de escribir nada: qué
 *     producto le toca, cuáles traen fondo que no es blanco, cuáles no tienen
 *     producto y qué productos ya tenían fotos. Cada fila se puede quitar.
 *  3. **Subir** con el mismo camino que la ficha (`uploadProductImage`: ruta del
 *     tenant, policy de Storage, fila en `product_images`).
 *
 * Una foto con fondo que no es claro sale DESMARCADA: se pidió que la vitrina
 * sea de fondo blanco, y meterla por defecto sería decidir por quien sube. Un
 * producto que ya tiene fotos, también: volver a subir la misma carpeta no
 * debe duplicar la galería.
 */

/** Fotos a la vez: el navegador prepara cada una en un lienzo y eso es memoria. */
const MAX_FILES = 1500
/** Trabajos en paralelo al preparar y al subir. */
const PARALELO = 3

type Estado = 'ready' | 'warning' | 'hasImages' | 'unmatched' | 'uploaded' | 'error'

interface Fila {
  readonly key: string
  readonly name: string
  readonly productId: string | null
  /** Si el archivo lleva el SKU de una variante, la foto es de ella. */
  readonly variantId: string | null
  readonly sku: string | null
  readonly order: number
  file: File
  warnings: readonly PhotoWarning[]
  estado: Estado
  include: boolean
  preview: string | null
  errorKey: MessageKey | null
}

type Fase = 'pick' | 'analyzing' | 'review' | 'uploading' | 'done'

const ESTADO_LABEL: Record<Estado, MessageKey> = {
  ready: 'bulkImages.status.ready',
  warning: 'bulkImages.status.warning',
  hasImages: 'bulkImages.status.hasImages',
  unmatched: 'bulkImages.status.unmatched',
  uploaded: 'bulkImages.status.uploaded',
  error: 'bulkImages.status.error',
}

const ESTADO_COLOR: Record<Estado, 'success' | 'warning' | 'default' | 'info' | 'error'> = {
  ready: 'success',
  warning: 'warning',
  hasImages: 'info',
  unmatched: 'default',
  uploaded: 'success',
  error: 'error',
}

const AVISO_LABEL: Record<PhotoWarning, MessageKey> = {
  background: 'bulkImages.warning.background',
  lowResolution: 'bulkImages.warning.lowResolution',
}

export interface BulkImagesScope {
  organizationId: string
  companyId: string
  storeId: string
}

export function BulkImagesAction({
  scope,
  open: controlado,
  onClose,
}: {
  scope: BulkImagesScope
  /** Modo controlado (p. ej. desde un menú): sin botón propio, abre con `open`. */
  open?: boolean
  onClose?: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      {controlado === undefined && (
        <Button variant="outlined" startIcon={<AddPhotoAlternateRoundedIcon />} onClick={() => setOpen(true)}>
          {t('bulkImages.action')}
        </Button>
      )}
      {(controlado ?? open) && (
        <BulkImagesDialog
          scope={scope}
          onClose={() => {
            setOpen(false)
            onClose?.()
          }}
        />
      )}
    </>
  )
}

/** Corre `tarea` sobre `items` con `n` a la vez, en orden de llegada. */
async function enParalelo<T>(items: readonly T[], n: number, tarea: (item: T) => Promise<void>): Promise<void> {
  let siguiente = 0
  const trabajadores = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (siguiente < items.length) {
      const item = items[siguiente++] as T
      await tarea(item)
    }
  })
  await Promise.all(trabajadores)
}

export function BulkImagesDialog({ scope, onClose }: { scope: BulkImagesScope; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const [whiteSquare, setWhiteSquare] = useState(true)
  const [fase, setFase] = useState<Fase>('pick')
  const [filas, setFilas] = useState<Fila[]>([])
  const [ignorados, setIgnorados] = useState(0)
  const [recortados, setRecortados] = useState(0)
  const [sinFoto, setSinFoto] = useState<number | null>(null)
  const [avance, setAvance] = useState({ hechas: 0, total: 0 })
  const [fallo, setFallo] = useState<MessageKey | null>(null)

  // Las miniaturas son URLs de objeto: se liberan al cerrar.
  const previews = useRef<string[]>([])
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url)
    },
    [],
  )

  function actualizar(key: string, cambio: Partial<Fila>) {
    setFilas((actuales) => actuales.map((fila) => (fila.key === key ? { ...fila, ...cambio } : fila)))
  }

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const elegidos = [...(event.target.files ?? [])]
    event.target.value = ''
    if (elegidos.length === 0) return

    const imagenes = elegidos.filter((file) => Boolean(ALLOWED_IMAGE_TYPES[file.type]))
    const aceptadas = imagenes.slice(0, MAX_FILES)
    setIgnorados(elegidos.length - imagenes.length)
    setRecortados(imagenes.length - aceptadas.length)
    setFallo(null)
    if (aceptadas.length === 0) {
      setFilas([])
      return
    }

    setFase('analyzing')
    let indice = new Map<string, string>()
    let variantes = new Map<string, VariantTarget>()
    let productos = new Map<string, string>()
    let cuentas = new Map<string, number>()
    const emparejadas = await (async () => {
      try {
        ;[productos, variantes] = await Promise.all([
          fetchSkuIndex(scope.companyId),
          fetchVariantSkuIndex(scope.companyId),
        ])
        // Un archivo con el SKU de una VARIANTE va a su producto, marcado con
        // ella. Si un SKU es a la vez de producto y de variante, manda el del
        // producto: es lo que significaba ese nombre antes de que existiera esto.
        indice = new Map(productos)
        for (const [sku, destino] of variantes) if (!indice.has(sku)) indice.set(sku, destino.productId)
        const pares = matchFiles(aceptadas, indice)
        const ids = [...new Set(pares.flatMap((par) => (par.productId ? [par.productId] : [])))]
        cuentas = await fetchImageCounts(ids)
        return pares
      } catch (error) {
        setFallo(error instanceof CatalogError ? error.key : 'bulkImages.error.generic')
        setFase('pick')
        return null
      }
    })()
    if (!emparejadas) return

    const nuevas: Fila[] = emparejadas.map((par, index) => {
      const yaTiene = par.productId ? (cuentas.get(par.productId) ?? 0) > 0 : false
      const estado: Estado = !par.productId ? 'unmatched' : yaTiene ? 'hasImages' : 'ready'
      // La que no casa con ningún SKU no se prepara, pero se ve tal cual: un
      // cuadro en blanco no ayuda a saber qué foto es.
      const preview = par.productId ? null : URL.createObjectURL(par.file)
      if (preview) previews.current.push(preview)
      return {
        key: `${index}-${par.file.name}`,
        name: par.file.name,
        productId: par.productId,
        variantId: par.sku && !productos.has(par.sku) ? (variantes.get(par.sku)?.variantId ?? null) : null,
        sku: par.sku,
        order: par.order,
        file: par.file,
        warnings: [],
        estado,
        include: estado === 'ready',
        preview,
        errorKey: null,
      }
    })
    setFilas(nuevas)

    // Productos de la sociedad que se quedan sin ninguna foto aunque se suba todo.
    const conFoto = new Set([...cuentas.keys(), ...nuevas.flatMap((fila) => (fila.productId ? [fila.productId] : []))])
    setSinFoto([...new Set(indice.values())].filter((id) => !conFoto.has(id)).length)

    const aPreparar = nuevas.filter((fila) => fila.productId)
    setAvance({ hechas: 0, total: aPreparar.length })
    await enParalelo(aPreparar, PARALELO, async (fila) => {
      const lista: { file: File; warnings: readonly PhotoWarning[] } = whiteSquare
        ? await prepareProductPhoto(fila.file)
        : { file: fila.file, warnings: [] }
      const url = URL.createObjectURL(lista.file)
      previews.current.push(url)
      const conAviso = lista.warnings.includes('background')
      actualizar(fila.key, {
        file: lista.file,
        warnings: lista.warnings,
        preview: url,
        ...(fila.estado === 'ready' && lista.warnings.length > 0
          ? { estado: 'warning' as const, include: !conAviso }
          : {}),
      })
      setAvance((actual) => ({ ...actual, hechas: actual.hechas + 1 }))
    })
    setFase('review')
  }

  async function onUpload() {
    const elegidas = filas.filter((fila) => fila.include && fila.productId)
    if (elegidas.length === 0) return
    setFase('uploading')
    setAvance({ hechas: 0, total: elegidas.length })

    // Por producto y en su orden: la posición sigue a las fotos que ya tenía y
    // la primera que entra en un producto sin fotos es la principal.
    const porProducto = new Map<string, Fila[]>()
    for (const fila of elegidas) {
      const lista = porProducto.get(fila.productId as string) ?? []
      lista.push(fila)
      porProducto.set(fila.productId as string, lista)
    }
    let cuentas = new Map<string, number>()
    try {
      cuentas = await fetchImageCounts([...porProducto.keys()])
    } catch {
      // Sin la cuenta se sube igual; el orden solo pierde el hueco exacto.
    }

    await enParalelo([...porProducto.entries()], PARALELO, async ([productId, lista]) => {
      let posicion = cuentas.get(productId) ?? 0
      for (const fila of lista) {
        try {
          await uploadProductImage({
            ...scope,
            productId,
            variantId: fila.variantId,
            file: fila.file,
            position: posicion,
          })
          posicion += 1
          actualizar(fila.key, { estado: 'uploaded', include: false })
        } catch (error) {
          actualizar(fila.key, {
            estado: 'error',
            errorKey: error instanceof CatalogError ? error.key : 'bulkImages.error.generic',
          })
        }
        setAvance((actual) => ({ ...actual, hechas: actual.hechas + 1 }))
      }
    })

    void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    setFase('done')
  }

  const cuenta = useMemo(() => {
    const por = (estado: Estado) => filas.filter((fila) => fila.estado === estado).length
    return {
      ready: por('ready'),
      warning: por('warning'),
      hasImages: por('hasImages'),
      unmatched: por('unmatched'),
      uploaded: por('uploaded'),
      error: por('error'),
      incluidas: filas.filter((fila) => fila.include && fila.productId).length,
    }
  }, [filas])

  const ocupado = fase === 'analyzing' || fase === 'uploading'
  const carpeta = { webkitdirectory: '', directory: '' } as Record<string, string>

  return (
    <Dialog open onClose={ocupado ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="bulk-images-title">
      <DialogTitle id="bulk-images-title">{t('bulkImages.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            {t('bulkImages.help')}
          </Typography>

          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'var(--surface-2, rgba(0,0,0,0.03))',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            FMX-0158.jpg · FMX-0158-2.jpg · FMX-0158-NEGRO.jpg · FMX-0158-NEGRO-2.jpg
          </Box>

          <FormControlLabel
            control={
              <Checkbox
                checked={whiteSquare}
                disabled={fase !== 'pick'}
                onChange={(event) => setWhiteSquare(event.target.checked)}
              />
            }
            label={
              <Stack>
                <Typography sx={{ fontWeight: 700 }}>{t('bulkImages.whiteSquare')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('bulkImages.whiteSquareHelp')}
                </Typography>
              </Stack>
            }
          />

          {(fase === 'pick' || fase === 'review') && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="outlined" startIcon={<PhotoLibraryRoundedIcon />} onClick={() => filesRef.current?.click()}>
                {t('bulkImages.chooseFiles')}
              </Button>
              <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => folderRef.current?.click()}>
                {t('bulkImages.chooseFolder')}
              </Button>
              <input
                ref={filesRef}
                type="file"
                hidden
                multiple
                accept={Object.keys(ALLOWED_IMAGE_TYPES).join(',')}
                aria-label={t('bulkImages.chooseFiles')}
                onChange={(event) => void onPick(event)}
              />
              <input
                ref={folderRef}
                type="file"
                hidden
                multiple
                {...carpeta}
                aria-label={t('bulkImages.chooseFolder')}
                onChange={(event) => void onPick(event)}
              />
            </Stack>
          )}

          {fallo && <Alert severity="error">{t(fallo)}</Alert>}
          {ignorados > 0 && (
            <Alert severity="info">{t('bulkImages.ignored').replace('{n}', String(ignorados))}</Alert>
          )}
          {recortados > 0 && (
            <Alert severity="warning">
              {t('bulkImages.tooMany').replace('{max}', String(MAX_FILES)).replace('{n}', String(recortados))}
            </Alert>
          )}

          {ocupado && (
            <Stack spacing={1}>
              <Typography variant="body2">
                {t(fase === 'uploading' ? 'bulkImages.uploading' : 'bulkImages.analyzing')} {avance.hechas}/{avance.total}
              </Typography>
              <LinearProgress
                variant={avance.total > 0 ? 'determinate' : 'indeterminate'}
                value={avance.total > 0 ? (avance.hechas / avance.total) * 100 : 0}
              />
            </Stack>
          )}

          {filas.length > 0 && (fase === 'review' || fase === 'done' || fase === 'uploading') && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {fase === 'review' ? (
                  <>
                    <Chip color="success" variant="outlined" label={`${t('bulkImages.status.ready')}: ${cuenta.ready}`} />
                    <Chip color="warning" variant="outlined" label={`${t('bulkImages.status.warning')}: ${cuenta.warning}`} />
                    <Chip color="info" variant="outlined" label={`${t('bulkImages.status.hasImages')}: ${cuenta.hasImages}`} />
                    <Chip variant="outlined" label={`${t('bulkImages.status.unmatched')}: ${cuenta.unmatched}`} />
                  </>
                ) : (
                  <>
                    <Chip color="success" variant="outlined" label={`${t('bulkImages.status.uploaded')}: ${cuenta.uploaded}`} />
                    <Chip
                      color={cuenta.error > 0 ? 'error' : 'default'}
                      variant={cuenta.error > 0 ? 'filled' : 'outlined'}
                      label={`${t('bulkImages.status.error')}: ${cuenta.error}`}
                    />
                  </>
                )}
              </Stack>

              {fase === 'review' && sinFoto !== null && sinFoto > 0 && (
                <Alert severity="info">{t('bulkImages.stillMissing').replace('{n}', String(sinFoto))}</Alert>
              )}
              {fase === 'done' && (
                <Alert severity={cuenta.error > 0 ? 'warning' : 'success'}>
                  {t(cuenta.error > 0 ? 'bulkImages.doneWithErrors' : 'bulkImages.done')}
                </Alert>
              )}

              {/* Sin scroll propio: con dos barras anidadas (la del dialogo y la
                  de la tabla) la lista se perdia. Se desplaza el dialogo y la
                  cabecera se queda pegada arriba. */}
              <Box sx={{ border: '1px solid var(--border)', borderRadius: 1 }}>
                <Table
                  size="small"
                  stickyHeader
                  aria-label={t('bulkImages.review')}
                  sx={{ '& .MuiTableCell-stickyHeader': { top: -16, bgcolor: 'background.paper' } }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell>{t('bulkImages.col.photo')}</TableCell>
                      <TableCell>{t('bulkImages.col.file')}</TableCell>
                      <TableCell>{t('bulkImages.col.product')}</TableCell>
                      <TableCell>{t('bulkImages.col.status')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filas.map((fila) => (
                      <TableRow key={fila.key}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={fila.include}
                            disabled={fase !== 'review' || !fila.productId}
                            onChange={(event) => actualizar(fila.key, { include: event.target.checked })}
                            inputProps={{ 'aria-label': `${t('bulkImages.include')}: ${fila.name}` }}
                          />
                        </TableCell>
                        <TableCell>
                          <Box
                            sx={{
                              width: 48,
                              height: 48,
                              borderRadius: 1,
                              border: '1px solid var(--border)',
                              bgcolor: '#fff',
                              overflow: 'hidden',
                              display: 'grid',
                              placeItems: 'center',
                            }}
                          >
                            {fila.preview && (
                              <Box
                                component="img"
                                src={fila.preview}
                                alt=""
                                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell sx={{ wordBreak: 'break-all' }}>{fila.name}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {fila.sku ? `${fila.sku}${fila.order > 1 ? ` · ${fila.order}` : ''}` : '—'}
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                            <Chip size="small" color={ESTADO_COLOR[fila.estado]} variant="outlined" label={t(ESTADO_LABEL[fila.estado])} />
                            {fila.warnings.map((aviso) => (
                              <Typography key={aviso} variant="caption" color="text.secondary">
                                {t(AVISO_LABEL[aviso])}
                              </Typography>
                            ))}
                            {fila.errorKey && (
                              <Typography variant="caption" color="error">
                                {t(fila.errorKey)}
                              </Typography>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={ocupado}>
          {t('bulkImages.close')}
        </Button>
        {fase === 'review' && (
          <Button variant="contained" disabled={cuenta.incluidas === 0} onClick={() => void onUpload()}>
            {t('bulkImages.upload').replace('{n}', String(cuenta.incluidas))}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
