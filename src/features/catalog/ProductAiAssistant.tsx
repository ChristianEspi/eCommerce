import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import type { AiErrorKind } from '@/features/ai/result'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import {
  aEntradaDeAtributo,
  claveDeMotivoPim,
  pedirSugerenciasDeFicha,
  type AsistenciaDeFicha,
  type ValorAtributoPropuesto,
} from './api/copy'
import { CatalogError } from './api/errors'
import { useSaveProductAttribute } from './pim/hooks'
import type { ProductPublication } from './types'
import { useUpdatePublication } from './useProducts'

/** Campos del formulario General que una sugerencia puede rellenar. */
export type CampoAplicable = 'name' | 'description'

/** Lo que se hizo con cada sugerencia. Nada de esto guarda solo. */
type Decision = 'applied' | 'discarded'

const NUMERO = /^\d{1,12}(?:\.\d{1,6})?$/

/**
 * Asistente de ficha con IA (fase 03).
 *
 * Enseña ACTUAL frente a SUGERENCIA y deja aplicar, editar o descartar cada
 * una. Aplicar NO guarda por sí solo lo del formulario General (nombre,
 * descripción): lo escribe en el formulario y quien edita decide con
 * «Guardar», como si lo hubiera tecleado. Categoría y atributos no tienen
 * formulario aquí: aplicar llama al MISMO comando que su pestaña, con la
 * validación de la base, y solo al pulsar — propuesta → confirmación humana →
 * validación del sistema → ejecución.
 *
 * Descripción corta, SEO y etiquetas no tienen columna en el maestro todavía:
 * se editan y se copian; el aviso lo dice en vez de fingir que se guardan.
 */
export function ProductAiAssistant({
  productId,
  storeId,
  canWrite,
  disabled,
  current,
  publication,
  scope,
  onApplyText,
}: {
  productId: string
  storeId: string
  canWrite: boolean
  disabled?: boolean
  /** Valores actuales del formulario, para la comparación. */
  current: { name: string; description: string }
  /** Publicación en la tienda activa (para aplicar la categoría). */
  publication: ProductPublication | null
  scope: { organizationId: string; companyId: string; storeId: string }
  onApplyText: (field: CampoAplicable, value: string) => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { availability } = useAiFeature('catalog.copy')
  const saveAttribute = useSaveProductAttribute()
  const updatePublication = useUpdatePublication()

  const [pidiendo, setPidiendo] = useState(false)
  const [resultado, setResultado] = useState<AsistenciaDeFicha | null>(null)
  const [errorRed, setErrorRed] = useState<MessageKey | null>(null)
  const [decisiones, setDecisiones] = useState<Record<string, Decision>>({})
  const [ediciones, setEdiciones] = useState<Record<string, string>>({})
  const [aplicando, setAplicando] = useState<string | null>(null)

  // Sin permiso de rol no se enseña nada; sin escritura no hay nada que aplicar.
  // Mientras se sabe el saldo, tampoco: un botón que parpadea deshabilitado
  // confunde más que uno que aparece cuando ya se puede usar.
  if (availability === 'forbidden' || availability === 'loading' || !canWrite) return null

  async function pedir() {
    setPidiendo(true)
    setErrorRed(null)
    setDecisiones({})
    setEdiciones({})
    try {
      setResultado(await pedirSugerenciasDeFicha({ productId, storeId, locale }))
    } catch (error) {
      setResultado(null)
      setErrorRed(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    } finally {
      setPidiendo(false)
    }
  }

  const decidir = (clave: string, decision: Decision) =>
    setDecisiones((prev) => ({ ...prev, [clave]: decision }))
  const valorEditado = (clave: string, original: string) => ediciones[clave] ?? original
  const editar = (clave: string, valor: string) => setEdiciones((prev) => ({ ...prev, [clave]: valor }))

  const s = resultado?.suggestions ?? null
  const sistema = resultado?.system ?? null
  const motivo: AiErrorKind | null = resultado?.motivo ?? null

  async function aplicarCategoria(categoryId: string) {
    if (!publication || !publication.slug || !publication.price || !publication.status) return
    setAplicando('category')
    try {
      await updatePublication.mutateAsync({
        productId,
        storeId,
        current: publication,
        values: {
          slug: publication.slug,
          price: publication.price,
          status: publication.status,
          category_id: categoryId,
        },
      })
      decidir('category', 'applied')
      notify(t('aiPim.applied.saved'))
    } catch (error) {
      setErrorRed(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    } finally {
      setAplicando(null)
    }
  }

  async function aplicarAtributo(attributeId: string, valor: ValorAtributoPropuesto) {
    const clave = `attr:${attributeId}`
    const editado = valor.kind === 'text' || valor.kind === 'number' ? ediciones[clave] : undefined
    const entrada = aEntradaDeAtributo(valor, editado)
    if (entrada.kind === 'number' && !NUMERO.test(entrada.number)) return
    if (entrada.kind === 'text' && !entrada.text) return
    setAplicando(clave)
    try {
      await saveAttribute.mutateAsync({ productId, attributeId, scope, value: entrada })
      decidir(clave, 'applied')
      notify(t('aiPim.applied.saved'))
    } catch (error) {
      setErrorRed(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    } finally {
      setAplicando(null)
    }
  }

  async function copiar(clave: string, valor: string) {
    try {
      await navigator.clipboard.writeText(valor)
      notify(t('aiPim.copied'))
      decidir(clave, 'applied')
    } catch {
      notify(t('aiPim.copyFailed'))
    }
  }

  const bloqueado = availability !== 'available'

  return (
    <Card
      component="section"
      variant="outlined"
      aria-labelledby="ai-pim-title"
      sx={{ borderColor: 'var(--accent)' }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <AutoAwesomeRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)' }} aria-hidden />
            <Typography id="ai-pim-title" component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
              {t('aiPim.title')}
            </Typography>
            <Chip size="small" label={t('aiPim.badge')} variant="outlined" />
          </Stack>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void pedir()}
            disabled={pidiendo || disabled || bloqueado}
            startIcon={pidiendo ? <CircularProgress size={14} color="inherit" /> : undefined}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {pidiendo ? t('aiPim.generating') : resultado ? t('aiPim.regenerate') : t('aiPim.generate')}
          </Button>
        </Stack>

        <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiPim.notice')}</Typography>

        {availability === 'not_entitled' && <Alert severity="info">{t('ai.motivo.sin_contratar')}</Alert>}
        {availability === 'quota_exhausted' && <Alert severity="info">{t('ai.motivo.sin_cuota')}</Alert>}

        <Box aria-live="polite">
          {pidiendo && (
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiPim.generating')}</Typography>
          )}
          {errorRed && (
            <Alert severity="error" onClose={() => setErrorRed(null)}>
              {t(errorRed)}
            </Alert>
          )}
          {!pidiendo && motivo && (
            <Alert severity="info">{t(claveDeMotivoPim(motivo) as MessageKey)}</Alert>
          )}
        </Box>

        {/* Lo determinista: lo dice el sistema, no el modelo. */}
        {sistema && sistema.missing_attributes.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
              {t('aiPim.system.missing')} ({sistema.missing_attributes.length})
            </Typography>
            <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
              {sistema.missing_attributes.map((a) => (
                <Chip key={a.id} size="small" label={a.name} />
              ))}
            </Stack>
          </Box>
        )}

        {s && (
          <Stack spacing={1.5}>
            {s.discarded > 0 && (
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {t('aiPim.discardedByRules').replace('{n}', String(s.discarded))}
              </Typography>
            )}

            {s.title && (
              <Comparacion
                clave="title"
                etiqueta={t('aiPim.field.title')}
                actual={current.name}
                sugerida={valorEditado('title', s.title)}
                decision={decisiones.title}
                onEditar={(v) => editar('title', v)}
                onAplicar={() => {
                  onApplyText('name', valorEditado('title', s.title as string))
                  decidir('title', 'applied')
                }}
                onDescartar={() => decidir('title', 'discarded')}
                aplicarLabel={t('aiPim.applyToForm')}
              />
            )}

            {s.normalized_name && (
              <Comparacion
                clave="normalize"
                etiqueta={t('aiPim.field.normalize')}
                ayuda={t('aiPim.field.normalize.help')}
                actual={current.name}
                sugerida={s.normalized_name}
                decision={decisiones.normalize}
                onAplicar={() => {
                  onApplyText('name', s.normalized_name as string)
                  decidir('normalize', 'applied')
                }}
                onDescartar={() => decidir('normalize', 'discarded')}
                aplicarLabel={t('aiPim.applyToForm')}
              />
            )}

            {s.description && (
              <Comparacion
                clave="description"
                etiqueta={t('aiPim.field.description')}
                actual={current.description}
                sugerida={valorEditado('description', s.description)}
                multilinea
                decision={decisiones.description}
                onEditar={(v) => editar('description', v)}
                onAplicar={() => {
                  onApplyText('description', valorEditado('description', s.description as string))
                  decidir('description', 'applied')
                }}
                onDescartar={() => decidir('description', 'discarded')}
                aplicarLabel={t('aiPim.applyToForm')}
              />
            )}

            {(
              [
                ['short_description', s.short_description, 'aiPim.field.short'],
                ['seo_title', s.seo_title, 'aiPim.field.seoTitle'],
                ['seo_description', s.seo_description, 'aiPim.field.seoDescription'],
              ] as const
            ).map(([clave, valor, etiqueta]) =>
              valor ? (
                <Comparacion
                  key={clave}
                  clave={clave}
                  etiqueta={t(etiqueta)}
                  ayuda={t('aiPim.noField')}
                  actual={null}
                  sugerida={valorEditado(clave, valor)}
                  multilinea={clave !== 'seo_title'}
                  decision={decisiones[clave]}
                  onEditar={(v) => editar(clave, v)}
                  onAplicar={() => void copiar(clave, valorEditado(clave, valor))}
                  onDescartar={() => decidir(clave, 'discarded')}
                  aplicarLabel={t('aiPim.copy')}
                />
              ) : null,
            )}

            {s.tags.length > 0 && (
              <Comparacion
                clave="tags"
                etiqueta={t('aiPim.field.tags')}
                ayuda={t('aiPim.noField')}
                actual={null}
                sugerida={valorEditado('tags', s.tags.join(', '))}
                decision={decisiones.tags}
                onEditar={(v) => editar('tags', v)}
                onAplicar={() => void copiar('tags', valorEditado('tags', s.tags.join(', ')))}
                onDescartar={() => decidir('tags', 'discarded')}
                aplicarLabel={t('aiPim.copy')}
              />
            )}

            {s.category && (
              <Comparacion
                clave="category"
                etiqueta={t('aiPim.field.category')}
                ayuda={
                  publication?.publication_id
                    ? `${t('aiPim.savesNow')}${s.category.reason ? ` · ${s.category.reason}` : ''}`
                    : t('aiPim.category.noPublication')
                }
                actual={publication?.category_name ?? null}
                sugerida={s.category.path}
                decision={decisiones.category}
                ocupado={aplicando === 'category'}
                aplicarDeshabilitado={!publication?.publication_id}
                onAplicar={() => void aplicarCategoria((s.category as { id: string }).id)}
                onDescartar={() => decidir('category', 'discarded')}
                aplicarLabel={t('aiPim.applyNow')}
              />
            )}

            {s.attributes.map((a) => {
              const clave = `attr:${a.attribute_id}`
              const crudo =
                a.value.kind === 'text' ? a.value.text : a.value.kind === 'number' ? a.value.number : null
              return (
                <Comparacion
                  key={clave}
                  clave={clave}
                  etiqueta={`${t('aiPim.field.attribute')}: ${a.name}`}
                  ayuda={`${t('aiPim.savesNow')}${a.reason ? ` · ${a.reason}` : ''}`}
                  actual={null}
                  sugerida={crudo !== null ? valorEditado(clave, crudo) : a.display}
                  decision={decisiones[clave]}
                  ocupado={aplicando === clave}
                  onEditar={crudo !== null ? (v) => editar(clave, v) : undefined}
                  onAplicar={() => void aplicarAtributo(a.attribute_id, a.value)}
                  onDescartar={() => decidir(clave, 'discarded')}
                  aplicarLabel={t('aiPim.applyNow')}
                />
              )
            })}
          </Stack>
        )}

        {/* Duplicados: el sistema encuentra candidatos; la IA solo opina de ellos. */}
        {sistema && sistema.duplicate_candidates.length > 0 && (
          <Box component="section" aria-label={t('aiPim.duplicates.title')}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{t('aiPim.duplicates.title')}</Typography>
            <Stack component="ul" spacing={0.5} sx={{ pl: 2, my: 0.5 }}>
              {sistema.duplicate_candidates.map((c) => {
                const ia = s?.duplicates.find((d) => d.product_id === c.product_id)
                return (
                  <Typography component="li" key={c.product_id} sx={{ fontSize: 13 }}>
                    <Box component="span" sx={{ fontWeight: 700 }}>
                      {c.sku}
                    </Box>{' '}
                    · {c.name} · {t('aiPim.duplicates.similarity')} {Math.round(c.score * 100)}%
                    {ia && (
                      <>
                        {' '}
                        <Chip size="small" color="warning" variant="outlined" label={t('aiPim.duplicates.aiLikely')} />
                        {ia.reason && (
                          <Box component="span" sx={{ color: 'var(--muted)' }}>
                            {' '}
                            {ia.reason}
                          </Box>
                        )}
                      </>
                    )}
                  </Typography>
                )
              })}
            </Stack>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiPim.duplicates.help')}</Typography>
          </Box>
        )}

        {resultado?.interactionId && s && <AiFeedbackButtons interactionId={resultado.interactionId} />}
      </CardContent>
    </Card>
  )
}

/** Una fila ACTUAL | SUGERENCIA IA con aplicar / editar / descartar. */
function Comparacion({
  clave,
  etiqueta,
  ayuda,
  actual,
  sugerida,
  multilinea,
  decision,
  ocupado,
  aplicarDeshabilitado,
  onEditar,
  onAplicar,
  onDescartar,
  aplicarLabel,
}: {
  clave: string
  etiqueta: string
  ayuda?: string
  actual: string | null
  sugerida: string
  multilinea?: boolean
  decision?: Decision
  ocupado?: boolean
  aplicarDeshabilitado?: boolean
  onEditar?: (valor: string) => void
  onAplicar: () => void
  onDescartar: () => void
  aplicarLabel: string
}) {
  const { t } = useI18n()
  const idBase = `ai-pim-${clave.replace(/[^a-z0-9_-]/gi, '-')}`

  if (decision === 'discarded') return null

  return (
    <Box
      role="group"
      aria-labelledby={`${idBase}-label`}
      sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 1.5 }}
    >
      <Typography id={`${idBase}-label`} sx={{ fontSize: 13, fontWeight: 800 }}>
        {etiqueta}
      </Typography>
      {ayuda && <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{ayuda}</Typography>}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
            {t('aiPim.current')}
          </Typography>
          <Typography sx={{ fontSize: 13, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
            {actual && actual.trim() ? actual : '—'}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-deep)', textTransform: 'uppercase' }}>
            {t('aiPim.suggestion')}
          </Typography>
          {onEditar && decision !== 'applied' ? (
            <TextField
              value={sugerida}
              onChange={(event) => onEditar(event.target.value)}
              fullWidth
              size="small"
              multiline={multilinea}
              minRows={multilinea ? 3 : undefined}
              inputProps={{ 'aria-label': `${t('aiPim.edit')}: ${etiqueta}` }}
            />
          ) : (
            <Typography sx={{ fontSize: 13, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{sugerida}</Typography>
          )}
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        {decision === 'applied' ? (
          <Typography sx={{ fontSize: 12.5, color: 'var(--accent-deep)', fontWeight: 700 }} role="status">
            {t('aiPim.applied')}
          </Typography>
        ) : (
          <>
            <Button size="small" onClick={onDescartar} disabled={ocupado} sx={{ textTransform: 'none' }}>
              {t('aiPim.discard')}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={onAplicar}
              disabled={ocupado || aplicarDeshabilitado || !sugerida.trim()}
              startIcon={ocupado ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {aplicarLabel}
            </Button>
          </>
        )}
      </Stack>
    </Box>
  )
}
