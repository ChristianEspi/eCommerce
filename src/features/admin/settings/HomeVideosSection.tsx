import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import VideoCallRoundedIcon from '@mui/icons-material/VideoCallRounded'
import { Alert, Box, Button, Chip, IconButton, Stack, Typography } from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useEffect, useRef, useState } from 'react'
import { HOME_VIDEO_RULES, type HomeVideoIssue } from '@/features/storefront/homeVideos'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'
import { R, T } from '@/theme/tokens'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import {
  inspectHomeVideo,
  uploadHomeVideo,
  useHomeVideos,
  useSaveHomeVideos,
  useVideoProductLabels,
  useVideoProductSearch,
  type AdminHomeVideo,
  type VideoProductOption,
} from './homeVideosAdmin'

const comoOpcion = (p: VideoProductOption): PickerOption => ({ id: p.id, primary: p.name, secondary: p.sku })

/**
 * El producto que enseña un video: su tarjeta sale bajo el video en la tienda.
 * Se busca por nombre o SKU entre los productos de la sociedad.
 */
function VideoProductPicker({
  companyId,
  value,
  disabled,
  label,
  onChange,
}: {
  companyId: string | null
  value: VideoProductOption | null
  disabled: boolean
  label: string
  onChange: (next: VideoProductOption | null) => void
}) {
  const { t } = useI18n()
  const [term, setTerm] = useState('')
  const busqueda = useVideoProductSearch(companyId, term)
  const opciones = busqueda.data ?? []
  return (
    <EntityPicker
      label={label}
      placeholder={t('settings.videos.productSearch')}
      term={term}
      onTermChange={setTerm}
      options={opciones.map(comoOpcion)}
      value={value ? comoOpcion(value) : null}
      loading={busqueda.isFetching}
      disabled={disabled}
      onPick={(opcion) => onChange(opciones.find((p) => p.id === opcion.id) ?? null)}
      onClear={() => onChange(null)}
    />
  )
}

const REQUISITOS: ReadonlyArray<{ issues: HomeVideoIssue[]; key: MessageKey }> = [
  { issues: ['type', 'unreadable'], key: 'settings.videos.rule.type' },
  { issues: ['short', 'long'], key: 'settings.videos.rule.duration' },
  { issues: ['orientation'], key: 'settings.videos.rule.vertical' },
  { issues: ['weight'], key: 'settings.videos.rule.weight' },
]

const conValores = (texto: string) =>
  texto
    .replace('{min}', String(HOME_VIDEO_RULES.minSeconds))
    .replace('{max}', String(HOME_VIDEO_RULES.maxSeconds))
    .replace('{mb}', String(HOME_VIDEO_RULES.maxBytes / 1024 / 1024))
    .replace('{n}', String(HOME_VIDEO_RULES.maxVideos))

/**
 * Videos del carrusel de la portada (2026-10-04).
 *
 * Se suben aquí y se ordenan aquí; la SECCIÓN se enciende y se coloca en
 * «Portada de la tienda», como cualquier otra. Cada archivo se comprueba antes
 * de subir: lo que no cumple no llega al bucket y la lista dice qué falló.
 */
export function HomeVideosSection({
  storeId,
  organizationId,
  companyId,
  canManage,
}: {
  storeId: string | null
  organizationId: string | null
  /** La sociedad activa: alcance del buscador de productos. */
  companyId: string | null
  canManage: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const actual = useHomeVideos(storeId)
  const guardar = useSaveHomeVideos(storeId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [lista, setLista] = useState<AdminHomeVideo[]>([])
  const [fallos, setFallos] = useState<HomeVideoIssue[] | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  // Lo que ya se eligió en esta sesión, para pintarlo sin volver a buscarlo.
  const [elegidos, setElegidos] = useState<Record<string, VideoProductOption>>({})
  const etiquetas = useVideoProductLabels(lista.flatMap((video) => (video.product_id ? [video.product_id] : [])))
  const productoDe = (id: string | null): VideoProductOption | null =>
    id ? (elegidos[id] ?? etiquetas.data?.find((p) => p.id === id) ?? null) : null

  useEffect(() => {
    if (actual.data) setLista(actual.data)
  }, [actual.data])

  if (actual.isPending) return <LoadingState />
  if (actual.isError) return <Alert severity="error">{t('settings.error.generic')}</Alert>

  const firma = (videos: readonly AdminHomeVideo[]) =>
    JSON.stringify(videos.map(({ path, title, duration, product_id }) => ({ path, title, duration, product_id })))
  const cambiado = firma(lista) !== firma(actual.data)
  const ocupado = !canManage || subiendo || guardar.isPending
  const lleno = lista.length >= HOME_VIDEO_RULES.maxVideos

  async function elegir(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = ''
    if (!file || !storeId || !organizationId) return
    const { issues, seconds } = await inspectHomeVideo(file)
    setFallos(issues)
    if (issues.length > 0 || seconds === null) return
    setSubiendo(true)
    try {
      const nuevo = await uploadHomeVideo({
        organizationId,
        storeId,
        file,
        seconds,
      })
      setLista((previa) => [...previa, nuevo])
    } catch {
      notify(t('settings.videos.uploadError'), 'error')
    } finally {
      setSubiendo(false)
    }
  }

  function mover(desde: number, hasta: number) {
    setLista((previa) => {
      const copia = [...previa]
      const [item] = copia.splice(desde, 1)
      if (item) copia.splice(hasta, 0, item)
      return copia
    })
  }

  async function onGuardar() {
    try {
      await guardar.mutateAsync(lista)
      notify(t('settings.videos.saved'), 'success')
    } catch {
      notify(t('settings.error.generic'), 'error')
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: { md: 'flex-start' } }}>
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h4" sx={{ fontWeight: 700, fontSize: T.bodyStrong }}>
            {t('settings.videos.rules')}
          </Typography>
          <Stack component="ul" spacing={0.75} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {REQUISITOS.map((req) => {
              const falla = fallos?.some((issue) => req.issues.includes(issue)) ?? false
              const cumple = fallos !== null && !falla
              return (
                <Stack component="li" key={req.key} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  {falla ? (
                    <CancelRoundedIcon
                      sx={{
                        fontSize: 18,
                        color: 'var(--danger, #C62828)',
                        mt: '1px',
                      }}
                      aria-hidden
                    />
                  ) : (
                    <CheckCircleRoundedIcon
                      sx={{
                        fontSize: 18,
                        mt: '1px',
                        color: cumple ? 'var(--accent-deep)' : 'var(--border)',
                      }}
                      aria-hidden
                    />
                  )}
                  <Typography
                    sx={{
                      fontSize: 13.5,
                      lineHeight: 1.45,
                      color: falla ? 'var(--danger, #C62828)' : 'var(--text)',
                    }}
                  >
                    {conValores(t(req.key))}
                  </Typography>
                </Stack>
              )
            })}
            <Stack component="li" direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <CheckCircleRoundedIcon sx={{ fontSize: 18, mt: '1px', color: 'var(--border)' }} aria-hidden />
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.45 }}>
                {conValores(t('settings.videos.rule.count'))}
              </Typography>
            </Stack>
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('settings.videos.soundNote')}</Typography>
          {fallos && fallos.length > 0 && <Alert severity="error">{t('settings.videos.rejected')}</Alert>}
        </Stack>

        <Box sx={{ flexShrink: 0 }}>
          <Button
            variant="outlined"
            startIcon={<VideoCallRoundedIcon />}
            disabled={ocupado || lleno}
            onClick={() => inputRef.current?.click()}
          >
            {subiendo ? t('settings.videos.uploading') : t('settings.videos.add')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={HOME_VIDEO_RULES.types.join(',')}
            hidden
            aria-label={t('settings.videos.add')}
            onChange={(event) => void elegir(event.target.files?.[0])}
          />
        </Box>
      </Stack>

      {lista.length === 0 ? (
        <Box
          sx={{
            p: 3,
            textAlign: 'center',
            borderRadius: `${R.md}px`,
            border: '1px dashed var(--border)',
            color: 'var(--muted)',
            fontSize: 13.5,
          }}
        >
          {t('settings.videos.empty')}
        </Box>
      ) : (
        <Stack component="ol" spacing={1.25} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {lista.map((video, i) => (
            <Stack
              component="li"
              key={video.path}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{
                p: 1.25,
                borderRadius: `${R.md}px`,
                border: '1px solid var(--border)',
                alignItems: { sm: 'center' },
              }}
            >
              <Box
                sx={{
                  // Vertical, como se verá en la tienda.
                  width: { xs: 120, sm: 96 },
                  aspectRatio: '9 / 16',
                  borderRadius: `${R.sm}px`,
                  overflow: 'hidden',
                  bgcolor: '#0b0b0b',
                  flexShrink: 0,
                }}
              >
                {video.preview ? (
                  <Box
                    component="video"
                    src={video.preview}
                    muted
                    playsInline
                    preload="metadata"
                    controls
                    sx={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : null}
              </Box>
              <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0 }}>
                <Field
                  rule="text" maxLength={HOME_VIDEO_RULES.titleMax}
                  size="small"
                  fullWidth
                  label={`${t('settings.videos.titleLabel')} ${i + 1}`}
                  value={video.title ?? ''}
                  disabled={!canManage}
                  inputProps={{ maxLength: HOME_VIDEO_RULES.titleMax }}
                  onChange={(event) =>
                    setLista((previa) => previa.map((v, j) => (j === i ? { ...v, title: event.target.value } : v)))
                  }
                />
                <VideoProductPicker
                  companyId={companyId}
                  label={`${t('settings.videos.product')} ${i + 1}`}
                  value={productoDe(video.product_id)}
                  disabled={!canManage}
                  onChange={(producto) => {
                    if (producto) setElegidos((previos) => ({ ...previos, [producto.id]: producto }))
                    setLista((previa) =>
                      previa.map((v, j) => (j === i ? { ...v, product_id: producto?.id ?? null } : v)),
                    )
                  }}
                />
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                <Chip size="small" label={`${video.duration} s`} />
                <IconButton
                  size="small"
                  disabled={!canManage || i === 0}
                  onClick={() => mover(i, i - 1)}
                  aria-label={`${t('settings.videos.up')} ${i + 1}`}
                >
                  <ArrowUpwardRoundedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  disabled={!canManage || i === lista.length - 1}
                  onClick={() => mover(i, i + 1)}
                  aria-label={`${t('settings.videos.down')} ${i + 1}`}
                >
                  <ArrowDownwardRoundedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  disabled={!canManage}
                  onClick={() => setLista((previa) => previa.filter((_, j) => j !== i))}
                  aria-label={`${t('settings.videos.remove')} ${i + 1}`}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('settings.videos.sectionHint')}</Typography>
        <Button variant="contained" disabled={ocupado || !cambiado} onClick={() => void onGuardar()}>
          {t('settings.videos.save')}
        </Button>
      </Stack>
    </Stack>
  )
}
