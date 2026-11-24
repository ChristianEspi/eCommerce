import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
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
  TextField,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useAiFeature } from '@/features/ai/hooks'
import type { AiErrorKind } from '@/features/ai/result'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { aEntradaDeAtributo, claveDeMotivoPim, pedirSugerenciasDeFicha, type SugerenciasPim } from './api/copy'
import {
  FICHAS_LOTE_MAX,
  fetchCatalogCleanupRows,
  fetchProductsWithoutDescription,
  updateProductDescription,
  type ProductoSinFicha,
} from './api/products'
import { saveProductAttribute } from './pim/api'
import { CATALOG_KEY } from './useProducts'

/** Propuestas en paralelo: dos, para no saturar el proveedor ni la cuota por minuto. */
const PARALELO = 2

type Estado = 'pending' | 'working' | 'ready' | 'empty' | 'applied' | 'error'

interface Fila {
  readonly producto: ProductoSinFicha
  estado: Estado
  sugerencia: SugerenciasPim | null
  motivo: AiErrorKind | null
  descripcion: string
  aplicarDescripcion: boolean
  aplicarAtributos: boolean
}

type Fase = 'pick' | 'working' | 'review' | 'applying' | 'done'

/**
 * Qué se completa: la DESCRIPCIÓN (con los atributos vacíos de paso) o solo los
 * ATRIBUTOS de los productos que no tienen ninguno (etiquetado: principio
 * activo, concentración, forma… los que la sociedad haya definido).
 */
type Modo = 'descripcion' | 'atributos'

async function productosSinAtributos(storeId: string): Promise<{ rows: ProductoSinFicha[]; total: number }> {
  const filas = (await fetchCatalogCleanupRows(storeId)).filter((f) => !f.has_attributes)
  return {
    rows: filas.slice(0, FICHAS_LOTE_MAX).map((f) => ({ id: f.product_id, sku: f.sku ?? '', name: f.name, brand_name: f.brand_name })),
    total: filas.length,
  }
}

/**
 * «Completar fichas con IA» (2026-11-22): el asistente de ficha de siempre,
 * aplicado a muchos productos de una vez.
 *
 * Mismos candados que en la ficha, porque ES la misma llamada (`catalog-copy`
 * en modo `assist`): sin cifras inventadas, sin precio ni stock, sin
 * afirmaciones clínicas, atributos solo de la lista cerrada y solo los vacíos.
 *
 * Tres pasos que no se saltan:
 *  1. **Elegir**: los productos sin descripción y cuántas consultas cuesta (una
 *     por producto, con el saldo a la vista).
 *  2. **Proponer**: de dos en dos, con barra y botón de parar. Si se acaba la
 *     cuota, se para solo.
 *  3. **Revisar y aplicar**: cada descripción se lee y se puede editar o quitar
 *     ANTES de guardar. Guardar solo toca la descripción (y los atributos
 *     vacíos que se acepten): nunca nombre, precio ni stock.
 */
export function BulkCopyAction({
  companyId,
  storeId,
  scope,
}: {
  companyId: string
  storeId: string
  scope: { organizationId: string; companyId: string; storeId: string }
}) {
  const { t } = useI18n()
  const { availability, entitlement } = useAiFeature('catalog.copy')
  const [open, setOpen] = useState(false)

  if (availability === 'forbidden' || availability === 'loading') return null

  return (
    <>
      <Button variant="outlined" startIcon={<AutoAwesomeRoundedIcon />} onClick={() => setOpen(true)}>
        {t('bulkCopy.action')}
      </Button>
      {open && (
        <BulkCopyDialog
          companyId={companyId}
          storeId={storeId}
          scope={scope}
          disponible={availability === 'available'}
          restantes={entitlement?.remaining ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function BulkCopyDialog({
  companyId,
  storeId,
  scope,
  disponible,
  restantes,
  onClose,
}: {
  companyId: string
  storeId: string
  scope: { organizationId: string; companyId: string; storeId: string }
  disponible: boolean
  restantes: number | null
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [fase, setFase] = useState<Fase>('pick')
  const [filas, setFilas] = useState<Fila[]>([])
  const [aviso, setAviso] = useState<MessageKey | null>(null)
  const [modo, setModo] = useState<Modo>('descripcion')
  const parar = useRef(false)

  const sinFicha = useQuery({
    queryKey: [...CATALOG_KEY, 'sin-ficha', modo, companyId, storeId],
    queryFn: () => (modo === 'atributos' ? productosSinAtributos(storeId) : fetchProductsWithoutDescription({ companyId, storeId })),
  })

  const candidatos = sinFicha.data?.rows ?? []
  const tope = restantes === null ? candidatos.length : Math.min(candidatos.length, restantes)
  const lote = candidatos.slice(0, tope)

  const actualizar = (id: string, patch: Partial<Fila>) =>
    setFilas((actual) => actual.map((f) => (f.producto.id === id ? { ...f, ...patch } : f)))

  async function proponer() {
    const iniciales: Fila[] = lote.map((producto) => ({
      producto,
      estado: 'pending',
      sugerencia: null,
      motivo: null,
      descripcion: '',
      aplicarDescripcion: false,
      aplicarAtributos: false,
    }))
    setFilas(iniciales)
    setAviso(null)
    parar.current = false
    setFase('working')

    const cola = [...lote]
    async function trabajador() {
      while (cola.length > 0 && !parar.current) {
        const producto = cola.shift()!
        actualizar(producto.id, { estado: 'working' })
        try {
          const r = await pedirSugerenciasDeFicha({ productId: producto.id, storeId, tasks: modo === 'atributos' ? ['attributes'] : ['description', 'attributes'], locale })
          const descripcion = modo === 'atributos' ? '' : (r.suggestions?.description ?? '')
          const atributos = r.suggestions?.attributes.length ?? 0
          if (r.motivo === 'sin_cuota') {
            parar.current = true
            setAviso('bulkCopy.quotaStopped')
          }
          actualizar(producto.id, {
            estado: descripcion || atributos > 0 ? 'ready' : 'empty',
            // En modo atributos la descripción ni se muestra: no se va a guardar.
            sugerencia: modo === 'atributos' && r.suggestions ? { ...r.suggestions, description: null } : r.suggestions,
            motivo: r.motivo,
            descripcion,
            aplicarDescripcion: descripcion.length > 0,
            aplicarAtributos: atributos > 0,
          })
        } catch {
          actualizar(producto.id, { estado: 'error' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALELO, cola.length) }, trabajador))
    setFase('review')
  }

  const aAplicar = filas.filter(
    (f) => f.estado === 'ready' && ((f.aplicarDescripcion && f.descripcion.trim()) || f.aplicarAtributos),
  )

  async function aplicar() {
    setFase('applying')
    for (const fila of aAplicar) {
      try {
        if (fila.aplicarDescripcion && fila.descripcion.trim()) {
          await updateProductDescription(fila.producto.id, fila.descripcion.trim())
        }
        if (fila.aplicarAtributos) {
          for (const a of fila.sugerencia?.attributes ?? []) {
            await saveProductAttribute({ productId: fila.producto.id, attributeId: a.attribute_id, scope, value: aEntradaDeAtributo(a.value) })
          }
        }
        actualizar(fila.producto.id, { estado: 'applied' })
      } catch {
        actualizar(fila.producto.id, { estado: 'error' })
      }
    }
    await queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    setFase('done')
  }

  const hechas = filas.filter((f) => f.estado !== 'pending' && f.estado !== 'working').length
  const aplicadas = filas.filter((f) => f.estado === 'applied').length
  const conError = filas.filter((f) => f.estado === 'error').length
  const ocupado = fase === 'working' || fase === 'applying'

  return (
    <Dialog open onClose={ocupado ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="bulk-copy-title">
      <DialogTitle id="bulk-copy-title">{t('bulkCopy.title')}</DialogTitle>
      <DialogContent dividers>
        {fase === 'pick' && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} role="group" aria-label={t('bulkCopy.mode')}>
              {(['descripcion', 'atributos'] as const).map((m) => (
                <Chip
                  key={m}
                  label={t(m === 'descripcion' ? 'bulkCopy.mode.description' : 'bulkCopy.mode.attributes')}
                  color={m === modo ? 'primary' : 'default'}
                  variant={m === modo ? 'filled' : 'outlined'}
                  onClick={() => setModo(m)}
                  aria-pressed={m === modo}
                />
              ))}
            </Stack>
            <Typography>{t(modo === 'atributos' ? 'bulkCopy.introAttributes' : 'bulkCopy.intro')}</Typography>
            {sinFicha.isPending ? (
              <LinearProgress aria-label={t('common.loading')} />
            ) : sinFicha.isError ? (
              <Alert severity="error">{t('catalog.error.generic')}</Alert>
            ) : candidatos.length === 0 ? (
              <Alert severity="success">{t(modo === 'atributos' ? 'bulkCopy.noneAttributes' : 'bulkCopy.none')}</Alert>
            ) : (
              <>
                <Typography sx={{ fontWeight: 700 }}>
                  {t(modo === 'atributos' ? 'bulkCopy.foundAttributes' : 'bulkCopy.found').replace('{count}', String(sinFicha.data?.total ?? candidatos.length))}
                </Typography>
                <Typography sx={{ color: 'var(--muted)' }}>
                  {(restantes === null ? t('bulkCopy.cost') : t('bulkCopy.costWithBalance'))
                    .replace('{count}', String(lote.length))
                    .replace('{remaining}', String(restantes ?? 0))}
                </Typography>
                {!disponible && <Alert severity="warning">{t('bulkCopy.unavailable')}</Alert>}
                <Alert severity="info">{t('bulkCopy.rules')}</Alert>
              </>
            )}
          </Stack>
        )}

        {fase === 'working' && (
          <Stack spacing={1.5}>
            <Typography>
              {t('bulkCopy.progress').replace('{done}', String(hechas)).replace('{total}', String(filas.length))}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={filas.length > 0 ? (hechas / filas.length) * 100 : 0}
              aria-label={t('bulkCopy.progressLabel')}
            />
          </Stack>
        )}

        {(fase === 'review' || fase === 'applying' || fase === 'done') && (
          <Stack spacing={2}>
            {aviso && <Alert severity="warning">{t(aviso)}</Alert>}
            {fase === 'done' && (
              <Alert severity={conError > 0 ? 'warning' : 'success'}>
                {t('bulkCopy.done').replace('{applied}', String(aplicadas)).replace('{failed}', String(conError))}
              </Alert>
            )}
            {filas.map((fila) => (
              <FilaRevision
                key={fila.producto.id}
                fila={fila}
                bloqueada={fase !== 'review'}
                onChange={(patch) => actualizar(fila.producto.id, patch)}
              />
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {fase === 'working' ? (
          <Button onClick={() => (parar.current = true)}>{t('bulkCopy.stop')}</Button>
        ) : (
          <Button onClick={onClose} disabled={fase === 'applying'}>
            {fase === 'done' ? t('common.close') : t('common.cancel')}
          </Button>
        )}
        {fase === 'pick' && (
          <Button variant="contained" disabled={!disponible || lote.length === 0} onClick={() => void proponer()}>
            {t('bulkCopy.start').replace('{count}', String(lote.length))}
          </Button>
        )}
        {(fase === 'review' || fase === 'applying') && (
          <Button variant="contained" disabled={aAplicar.length === 0 || fase === 'applying'} onClick={() => void aplicar()}>
            {fase === 'applying' ? t('bulkCopy.applying') : t('bulkCopy.apply').replace('{count}', String(aAplicar.length))}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

function FilaRevision({
  fila,
  bloqueada,
  onChange,
}: {
  fila: Fila
  bloqueada: boolean
  onChange: (patch: Partial<Fila>) => void
}) {
  const { t } = useI18n()
  const atributos = fila.sugerencia?.attributes ?? []
  const etiqueta = `${fila.producto.name} · ${fila.producto.sku}`

  return (
    <Box
      data-bulk-copy-row={fila.producto.sku}
      sx={{ border: '1px solid var(--border)', borderRadius: 0.67, p: 1.5 }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{fila.producto.name}</Typography>
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          {fila.producto.sku}
          {fila.estado === 'applied' && ` · ${t('bulkCopy.status.applied')}`}
        </Typography>
      </Stack>

      {fila.estado === 'ready' || fila.estado === 'applied' ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {fila.sugerencia?.description && (
            <>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={fila.aplicarDescripcion}
                    disabled={bloqueada}
                    onChange={(e) => onChange({ aplicarDescripcion: e.target.checked })}
                    slotProps={{ input: { 'aria-label': `${t('bulkCopy.applyDescription')} · ${etiqueta}` } }}
                  />
                }
                label={t('bulkCopy.applyDescription')}
              />
              <TextField
                multiline
                minRows={2}
                maxRows={8}
                size="small"
                value={fila.descripcion}
                disabled={bloqueada || !fila.aplicarDescripcion}
                onChange={(e) => onChange({ descripcion: e.target.value.slice(0, 8000) })}
                slotProps={{ htmlInput: { 'aria-label': `${t('bulkCopy.description')} · ${etiqueta}`, maxLength: 8000 } }}
              />
            </>
          )}
          {atributos.length > 0 && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={fila.aplicarAtributos}
                  disabled={bloqueada}
                  onChange={(e) => onChange({ aplicarAtributos: e.target.checked })}
                  slotProps={{ input: { 'aria-label': `${t('bulkCopy.applyAttributes')} · ${etiqueta}` } }}
                />
              }
              label={`${t('bulkCopy.applyAttributes')}: ${atributos.map((a) => `${a.name} ${a.display}`).join(' · ')}`}
            />
          )}
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ color: 'var(--muted)', mt: 0.5 }}>
          {fila.estado === 'error'
            ? t('bulkCopy.status.error')
            : fila.estado === 'pending' || fila.estado === 'working'
              ? t('bulkCopy.status.skipped')
              : fila.motivo
                ? t(claveDeMotivoPim(fila.motivo) as MessageKey)
                : t('bulkCopy.status.empty')}
        </Typography>
      )}
    </Box>
  )
}
