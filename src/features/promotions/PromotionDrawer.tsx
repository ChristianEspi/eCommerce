import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { StoreAssetField } from '@/features/admin/settings/StoreAssetField'
import { useAssetUrls } from '@/features/admin/settings/useStoreSettings'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { PromotionsError } from './errors'
import {
  useAddScope,
  useAddTier,
  useRemoveScope,
  useRemoveTier,
  useSavePromotion,
  useScopeNames,
  useScopeTargets,
  useScopeVariants,
  useScopes,
  useTiers,
} from './hooks'
import type { PromotionScopeIds } from './api'
import { PromotionAiAssistant } from './ai/PromotionAiAssistant'
import {
  PROMOTION_KINDS,
  PROMOTION_STATUSES,
  SCOPE_KINDS,
  trimDecimals,
  validatePromotionForm,
  type Promotion,
  type PromotionFormValues,
  type PromotionKind,
  type ScopeKind,
} from './types'

/** Una campaña nueva nace en BORRADOR. Encenderla es una decisión, no el efecto
 *  secundario de crearla — la misma regla que P09 aplicó a los medios de pago. */
const EMPTY: PromotionFormValues = {
  code: '',
  name: '',
  description: '',
  imageUrl: null,
  kind: 'percentage',
  status: 'draft',
  priority: 100,
  stackGroup: '',
  isExclusive: false,
  requiresCoupon: false,
  valuePercent: '',
  valueAmount: '',
  maxDiscountAmount: '',
  buyQuantity: '',
  freeQuantity: '',
  minSubtotal: '',
  minQuantity: '',
  validFrom: '',
  validTo: '',
  usageLimit: '',
  usageLimitPerCustomer: '',
}

/** `2026-08-28T14:30:00Z` → `2026-08-28T14:30`, que es lo que pide un input. */
function toLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function fromPromotion(promotion: Promotion): PromotionFormValues {
  return {
    code: promotion.code,
    name: promotion.name,
    description: promotion.description ?? '',
    imageUrl: promotion.image_url,
    kind: promotion.kind,
    status: promotion.status,
    priority: promotion.priority,
    stackGroup: promotion.stack_group ?? '',
    isExclusive: promotion.is_exclusive,
    requiresCoupon: promotion.requires_coupon,
    valuePercent: promotion.value_percent ? trimDecimals(promotion.value_percent) : '',
    valueAmount: promotion.value_amount ?? '',
    maxDiscountAmount: promotion.max_discount_amount ?? '',
    buyQuantity: promotion.buy_quantity ? trimDecimals(promotion.buy_quantity) : '',
    freeQuantity: promotion.free_quantity ? trimDecimals(promotion.free_quantity) : '',
    minSubtotal: promotion.min_subtotal ?? '',
    minQuantity: promotion.min_quantity ? trimDecimals(promotion.min_quantity) : '',
    validFrom: toLocalInput(promotion.valid_from),
    validTo: toLocalInput(promotion.valid_to),
    usageLimit: promotion.usage_limit === null ? '' : String(promotion.usage_limit),
    usageLimitPerCustomer:
      promotion.usage_limit_per_customer === null
        ? ''
        : String(promotion.usage_limit_per_customer),
  }
}

/**
 * Alta y edición de una campaña, con su alcance y sus escalas.
 *
 * Tres decisiones de esta pantalla:
 *
 *  1. **El formulario cambia con el TIPO.** Un 3x2 no tiene porcentaje y un
 *     porcentaje no tiene «cuántas gratis». Enseñar los ocho campos siempre y
 *     dejar que la base rechace la combinación imposible convierte el CHECK
 *     `promotions_kind_shape` en un error genérico; enseñar solo los del tipo
 *     hace que la forma correcta sea la única que se puede escribir.
 *  2. **El alcance y las escalas se editan con la campaña ya guardada.** Son
 *     filas de otras tablas con FK contra ésta: antes de tener id no hay dónde
 *     colgarlas. La pantalla lo dice en vez de dejar botones que fallarían.
 *  3. **Un error del servidor NO cierra el panel.** Lo que el operador escribió
 *     se queda donde estaba. Es la regla de suite desde P04.
 */
export function PromotionDrawer({
  open,
  promotion,
  scope,
  currency,
  onClose,
  onPause,
  onArchive,
  onDelete,
}: {
  open: boolean
  promotion: Promotion | null
  scope: PromotionScopeIds | null
  currency: string
  onClose: () => void
  onPause: (promotion: Promotion) => void
  onArchive: (promotion: Promotion) => void
  onDelete: (promotion: Promotion) => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [values, setValues] = useState<PromotionFormValues>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // La vista previa de la foto: el bucket es privado, asi que la ruta guardada
  // no se puede pintar tal cual — hay que firmarla.
  const imageUrls = useAssetUrls([values.imageUrl])

  const save = useSavePromotion(scope)
  const scopes = useScopes(promotion?.id ?? null)
  const tiers = useTiers(promotion?.id ?? null)
  const addScope = useAddScope(scope)
  const removeScope = useRemoveScope()
  const addTier = useAddTier(scope)
  const removeTier = useRemoveTier()

  const [scopeKind, setScopeKind] = useState<ScopeKind>('all')
  const [scopeTarget, setScopeTarget] = useState('')
  const [scopeVariant, setScopeVariant] = useState('')
  /** Lo escrito en el buscador y lo elegido: el uuid viaja en `scopeTarget`. */
  const [targetTerm, setTargetTerm] = useState('')
  const [targetPicked, setTargetPicked] = useState<PickerOption | null>(null)
  const targetDebounced = useDebouncedValue(targetTerm, 300)
  /**
   * Con algo ya elegido y el texto igual a su nombre no hay nada que buscar: la
   * consulta devolvería justo lo que ya está elegido. Apagarla ahorra una ida y
   * vuelta por cada elección y, sobre todo, evita que la lista se repinte
   * debajo del dedo justo después de elegir.
   */
  const yaElegido = targetPicked !== null && targetPicked.primary === targetDebounced
  const targets = useScopeTargets(
    scope?.storeId ?? null,
    scopeKind,
    targetDebounced,
    !yaElegido,
  )
  const targetOptions: PickerOption[] = (targets.data ?? []).map((fila) => ({
    id: fila.id,
    primary: fila.name,
    secondary: fila.code,
  }))
  const variantes = useScopeVariants(scopeKind === 'variant' ? (scopeTarget || null) : null)

  /**
   * ¿Hay algo que añadir? «Todo el carrito» no necesita destino; el resto sí, y
   * una variante necesita además cuál.
   */
  const alcanceListo =
    scopeKind === 'all' ||
    (scopeTarget !== '' && (scopeKind !== 'variant' || scopeVariant !== ''))

  const nombres = useScopeNames(scopes.data ?? [])
  /** El nombre de lo que apunta un alcance; vacío mientras no se sepa. */
  const nombreDe = (fila: {
    product_id: string | null
    variant_id: string | null
    category_id: string | null
    brand_id: string | null
  }) => {
    const id = fila.variant_id ?? fila.product_id ?? fila.category_id ?? fila.brand_id
    return id ? (nombres.data?.[id] ?? '') : ''
  }
  const [scopeQuantity, setScopeQuantity] = useState('')
  const [scopeExclusion, setScopeExclusion] = useState(false)
  const [scopeDescendants, setScopeDescendants] = useState(false)
  const [tierQuantity, setTierQuantity] = useState('')
  const [tierPercent, setTierPercent] = useState('')

  useEffect(() => {
    if (!open) return
    setValues(promotion ? fromPromotion(promotion) : { ...EMPTY, validFrom: toLocalInput(new Date().toISOString()) })
    setErrors({})
  }, [open, promotion])

  function set<K extends keyof PromotionFormValues>(key: K, value: PromotionFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }))
  }

  function fieldError(field: string): string | undefined {
    const key = errors[field]
    return key ? t(key as MessageKey) : undefined
  }

  async function submit() {
    const found = validatePromotionForm(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    try {
      await save.mutateAsync({
        id: promotion?.id ?? null,
        values,
        previa: promotion ? { image_url: promotion.image_url ?? null } : null,
      })
      /**
       * Lo elegido en el alcance y no añadido se guarda TAMBIÉN.
       *
       * Son dos botones y el de abajo es el que parece «el de guardar»: quien
       * elegía un producto y pulsaba «Guardar» veía «Campaña guardada» —cierto—
       * y perdía la elección sin que nadie se lo dijera. Al reabrir el panel no
       * había alcance, y la conclusión razonable era que no se había guardado
       * nada. Guardar significa guardar lo que hay en la pantalla.
       */
      if (promotion && scopeKind !== 'all' && scopeTarget !== '' && alcanceListo) {
        await submitScope()
      }
      notify(t('promotions.campaigns.saved'), 'success')
      if (!promotion) onClose()
    } catch (error) {
      // El panel se queda abierto a propósito: lo que se escribió no se pierde.
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
    }
  }

  async function submitScope() {
    if (!promotion) return
    try {
      await addScope.mutateAsync({
        promotionId: promotion.id,
        promotionKind: promotion.kind,
        scopeKind,
        productId: scopeKind === 'product' || scopeKind === 'variant' ? scopeTarget : null,
        variantId: scopeKind === 'variant' ? scopeVariant : null,
        categoryId: scopeKind === 'category' ? scopeTarget : null,
        brandId: scopeKind === 'brand' ? scopeTarget : null,
        requiredQuantity: promotion.kind === 'bundle' ? scopeQuantity : null,
        isExclusion: scopeExclusion,
        includeDescendants: scopeDescendants,
      })
      setScopeTarget('')
      setScopeVariant('')
      setScopeQuantity('')
      setScopeDescendants(false)
      setTargetPicked(null)
      setTargetTerm('')
      notify(t('promotions.scope.added'), 'success')
    } catch (error) {
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
    }
  }

  async function submitTier() {
    if (!promotion) return
    try {
      await addTier.mutateAsync({
        promotionId: promotion.id,
        minQuantity: tierQuantity,
        discountPercent: tierPercent === '' ? null : tierPercent,
        discountAmount: null,
      })
      setTierQuantity('')
      setTierPercent('')
      notify(t('promotions.tier.added'), 'success')
    } catch (error) {
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={promotion ? promotion.name : t('promotions.campaigns.new')}
      subtitle={promotion?.code}
      width={640}
      busy={save.isPending}
      onClose={onClose}
      actions={
        <>
          {promotion && (
            <>
              <Button color="inherit" onClick={() => onDelete(promotion)}>
                {t('promotions.action.delete')}
              </Button>
              <Button color="inherit" onClick={() => onArchive(promotion)}>
                {t('promotions.action.archive')}
              </Button>
              <Button onClick={() => onPause(promotion)}>
                {promotion.status === 'active'
                  ? t('promotions.action.pause')
                  : t('promotions.action.activate')}
              </Button>
            </>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5}>
        <TextField
          label={t('promotions.field.code')}
          value={values.code}
          onChange={(event) => set('code', event.target.value)}
          error={Boolean(errors.code)}
          helperText={fieldError('code') ?? t('promotions.hint.code')}
          disabled={promotion !== null}
          size="small"
          fullWidth
        />
        <TextField
          label={t('promotions.field.name')}
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
          error={Boolean(errors.name)}
          helperText={fieldError('name')}
          size="small"
          fullWidth
        />
        {/* La foto de la campaña.
            Desde que la portada lee las promociones vigentes sola, la imagen
            tiene que viajar con la campaña: se crea la oferta, se le pone su
            foto y aparece. Antes había que escribir además un bloque de
            contenido con la imagen, y acordarse de borrarlo al caducar. */}
        <StoreAssetField
          kind="content"
          ratio="16 / 9"
          label={t('promotions.field.image')}
          help={t('promotions.field.imageHelp')}
          value={values.imageUrl}
          previewUrl={values.imageUrl ? (imageUrls[values.imageUrl] ?? null) : null}
          disabled={save.isPending}
          organizationId={scope?.organizationId ?? ''}
          storeId={scope?.storeId ?? ''}
          onChange={(next: string | null) => set('imageUrl', next)}
        />

        <TextField
          label={t('promotions.field.description')}
          value={values.description}
          onChange={(event) => set('description', event.target.value)}
          multiline
          minRows={2}
          size="small"
          fullWidth
        />

        {/* Fase 09: redactar con IA sobre la promoción GUARDADA (las reglas
            salen de la base). Aplicar escribe en el formulario; se guarda con
            «Guardar». Sin promoción guardada no hay reglas que citar. */}
        {promotion && (
          <PromotionAiAssistant
            key={promotion.id}
            promotionId={promotion.id}
            current={{ name: values.name, description: values.description }}
            onApply={(field, value) => set(field, value)}
          />
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label={t('promotions.field.kind')}
            value={values.kind}
            onChange={(event) => set('kind', event.target.value as PromotionKind)}
            disabled={promotion !== null}
            helperText={promotion ? t('promotions.hint.kindLocked') : undefined}
            size="small"
            fullWidth
          >
            {PROMOTION_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {t(`promotions.kind.${kind}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('common.status')}
            value={values.status}
            onChange={(event) => set('status', event.target.value as PromotionFormValues['status'])}
            size="small"
            fullWidth
          >
            {PROMOTION_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {t(`promotions.status.${status}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {/* Los campos del descuento dependen del TIPO. Ver la decisión 1. */}
        {(values.kind === 'percentage' || values.kind === 'bundle') && (
          <TextField
            label={t('promotions.field.percent')}
            value={values.valuePercent}
            onChange={(event) => set('valuePercent', event.target.value)}
            error={Boolean(errors.valuePercent)}
            helperText={fieldError('valuePercent')}
            size="small"
            fullWidth
          />
        )}
        {(values.kind === 'fixed_amount' || values.kind === 'bundle') && (
          <TextField
            label={`${t('promotions.field.amount')} (${currency})`}
            value={values.valueAmount}
            onChange={(event) => set('valueAmount', event.target.value)}
            error={Boolean(errors.valueAmount)}
            helperText={fieldError('valueAmount')}
            size="small"
            fullWidth
          />
        )}
        {values.kind === 'x_for_y' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('promotions.field.buyQuantity')}
              value={values.buyQuantity}
              onChange={(event) => set('buyQuantity', event.target.value)}
              error={Boolean(errors.buyQuantity)}
              helperText={fieldError('buyQuantity')}
              size="small"
              fullWidth
            />
            <TextField
              label={t('promotions.field.freeQuantity')}
              value={values.freeQuantity}
              onChange={(event) => set('freeQuantity', event.target.value)}
              error={Boolean(errors.freeQuantity)}
              helperText={fieldError('freeQuantity') ?? t('promotions.hint.freeQuantity')}
              size="small"
              fullWidth
            />
          </Stack>
        )}
        {values.kind === 'volume_tier' && (
          <Alert severity="info">{t('promotions.hint.volume')}</Alert>
        )}

        {(values.kind === 'percentage' || values.kind === 'volume_tier') && (
          <TextField
            label={`${t('promotions.field.cap')} (${currency})`}
            value={values.maxDiscountAmount}
            onChange={(event) => set('maxDiscountAmount', event.target.value)}
            error={Boolean(errors.maxDiscountAmount)}
            helperText={fieldError('maxDiscountAmount') ?? t('promotions.hint.cap')}
            size="small"
            fullWidth
          />
        )}

        <Divider textAlign="left">
          <Typography variant="overline">{t('promotions.section.conditions')}</Typography>
        </Divider>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label={`${t('promotions.field.minSubtotal')} (${currency})`}
            value={values.minSubtotal}
            onChange={(event) => set('minSubtotal', event.target.value)}
            error={Boolean(errors.minSubtotal)}
            helperText={fieldError('minSubtotal') ?? t('promotions.hint.minSubtotal')}
            size="small"
            fullWidth
          />
          <TextField
            label={t('promotions.field.minQuantity')}
            value={values.minQuantity}
            onChange={(event) => set('minQuantity', event.target.value)}
            error={Boolean(errors.minQuantity)}
            helperText={fieldError('minQuantity')}
            size="small"
            fullWidth
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            type="datetime-local"
            label={t('promotions.field.validFrom')}
            value={values.validFrom}
            onChange={(event) => set('validFrom', event.target.value)}
            error={Boolean(errors.validFrom)}
            helperText={fieldError('validFrom')}
            InputLabelProps={{ shrink: true }}
            size="small"
            fullWidth
          />
          <TextField
            type="datetime-local"
            label={t('promotions.field.validTo')}
            value={values.validTo}
            onChange={(event) => set('validTo', event.target.value)}
            error={Boolean(errors.validTo)}
            helperText={fieldError('validTo') ?? t('promotions.hint.validTo')}
            InputLabelProps={{ shrink: true }}
            size="small"
            fullWidth
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label={t('promotions.field.usageLimit')}
            value={values.usageLimit}
            onChange={(event) => set('usageLimit', event.target.value)}
            error={Boolean(errors.usageLimit)}
            helperText={fieldError('usageLimit') ?? t('promotions.hint.usageLimit')}
            size="small"
            fullWidth
          />
          <TextField
            label={t('promotions.field.usageLimitPerCustomer')}
            value={values.usageLimitPerCustomer}
            onChange={(event) => set('usageLimitPerCustomer', event.target.value)}
            error={Boolean(errors.usageLimitPerCustomer)}
            helperText={
              fieldError('usageLimitPerCustomer') ?? t('promotions.hint.usageLimitPerCustomer')
            }
            size="small"
            fullWidth
          />
        </Stack>

        <Divider textAlign="left">
          <Typography variant="overline">{t('promotions.section.combination')}</Typography>
        </Divider>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label={t('promotions.field.priority')}
            type="number"
            value={values.priority}
            onChange={(event) => set('priority', Number(event.target.value))}
            error={Boolean(errors.priority)}
            helperText={fieldError('priority') ?? t('promotions.hint.priority')}
            size="small"
            fullWidth
          />
          <TextField
            label={t('promotions.field.stackGroup')}
            value={values.stackGroup}
            onChange={(event) => set('stackGroup', event.target.value)}
            error={Boolean(errors.stackGroup)}
            helperText={fieldError('stackGroup') ?? t('promotions.hint.stackGroup')}
            disabled={values.isExclusive}
            size="small"
            fullWidth
          />
        </Stack>

        <FormControlLabel
          control={
            <Switch
              checked={values.isExclusive}
              onChange={(event) => set('isExclusive', event.target.checked)}
            />
          }
          label={t('promotions.field.exclusive')}
        />
        <Typography sx={{ color: 'var(--muted)', fontSize: 12, mt: -1.5 }}>
          {t('promotions.hint.exclusive')}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={values.requiresCoupon}
              onChange={(event) => set('requiresCoupon', event.target.checked)}
            />
          }
          label={t('promotions.field.requiresCoupon')}
        />
        <Typography sx={{ color: 'var(--muted)', fontSize: 12, mt: -1.5 }}>
          {t('promotions.hint.requiresCoupon')}
        </Typography>

        <Divider textAlign="left">
          <Typography variant="overline">{t('promotions.section.scope')}</Typography>
        </Divider>

        {!promotion && <Alert severity="info">{t('promotions.scope.saveFirst')}</Alert>}

        {promotion && (
          <Stack spacing={1.5}>
            <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
              {t('promotions.scope.help')}
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(scopes.data ?? []).map((row) => (
                <Chip
                  key={row.id}
                  size="small"
                  color={row.is_exclusion ? 'error' : 'default'}
                  // El tipo Y a qué apunta. «Producto» a secas no distingue dos
                  // alcances de producto, ni deja reconocer el recién añadido.
                  label={`${row.is_exclusion ? '− ' : ''}${t(
                    `promotions.scope.${row.scope_kind}` as MessageKey,
                  )}${nombreDe(row) ? `: ${nombreDe(row)}` : ''}${
                    row.required_quantity ? ` ×${trimDecimals(row.required_quantity)}` : ''
                  }`}
                  // Mientras se borra, la pastilla se apaga: sin esto se queda
                  // igual hasta que vuelve la relectura y parece que el clic no
                  // hizo nada, así que se pulsa otra vez.
                  disabled={removeScope.isPending}
                  onDelete={() => void removeScope.mutateAsync(row.id)}
                />
              ))}
              {(scopes.data ?? []).length === 0 && (
                <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                  {t('promotions.scope.none')}
                </Typography>
              )}
            </Stack>

            {/* Los campos en REJILLA que se parte sola, no en una fila.
                En una fila cabían dos controles; con «Variante» son tres más los
                interruptores, y todo se estrujaba hasta que el buscador de
                producto se quedaba en «Bu…» y el de variante en «Esc…». Un
                campo que no se puede leer no se puede rellenar.
                Cada uno pide 220 px y, cuando no caben, bajan de línea. */}
            <Box
              sx={{
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                alignItems: 'start',
              }}
            >
              <TextField
                select
                size="small"
                label={t('promotions.field.scope')}
                value={scopeKind}
                onChange={(event) => {
                  // Un producto elegido no vale como categoría: al cambiar de
                  // tipo, lo elegido deja de tener sentido y se suelta.
                  setScopeKind(event.target.value as ScopeKind)
                  setScopeTarget('')
                  setScopeVariant('')
                  setTargetPicked(null)
                  setTargetTerm('')
                }}
              >
                {SCOPE_KINDS.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {t(`promotions.scope.${kind}` as MessageKey)}
                  </MenuItem>
                ))}
              </TextField>
              {/* Se ELIGE, no se teclea.
                  La tabla guarda uuids —`product_id`, `category_id`,
                  `brand_id`— y aquí había un campo de texto libre llamado
                  «Identificador». Quien escribía el SKU, que es el
                  identificador que la gente conoce, recibía «No pudimos
                  completar la operación»: Postgres rechazaba `QS-000004` como
                  uuid antes de mirar nada más. Un campo que solo acepta un
                  valor que no está a la vista en ninguna pantalla no se puede
                  rellenar bien. */}
              {scopeKind !== 'all' && (
                <Box sx={{ minWidth: 0 }}>
                  <EntityPicker
                    label={t('promotions.field.target')}
                    placeholder={t('promotions.hint.target')}
                    term={targetTerm}
                    onTermChange={setTargetTerm}
                    options={targetOptions}
                    value={targetPicked}
                    onPick={(option) => {
                      setTargetPicked(option)
                      setScopeTarget(option.id)
                      // El campo pasa a decir lo ELEGIDO y no lo tecleado. Sin
                      // esto seguía mostrando «Pañales» —el término de búsqueda—
                      // y no había forma de saber si la elección había prendido:
                      // parecía que tardaba, y se volvía a abrir el desplegable.
                      setTargetTerm(option.primary)
                      // Al cambiar de producto, la variante elegida ya no es suya.
                      setScopeVariant('')
                    }}
                    onClear={() => {
                      setTargetPicked(null)
                      setScopeTarget('')
                      setScopeVariant('')
                    }}
                    loading={targets.isFetching}
                    minChars={2}
                  />
                </Box>
              )}
              {scopeKind === 'variant' && (
                <TextField
                  select
                  size="small"
                  label={t('promotions.field.variant')}
                  value={scopeVariant}
                  onChange={(event) => setScopeVariant(event.target.value)}
                  disabled={scopeTarget === ''}
                  helperText={scopeTarget === '' ? t('promotions.hint.variantFirst') : undefined}
                >
                  {(variantes.data ?? []).map((variante) => (
                    <MenuItem key={variante.id} value={variante.id}>
                      {variante.name}
                      {variante.code ? ` · ${variante.code}` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {promotion.kind === 'bundle' && (
                <TextField
                  size="small"
                  label={t('promotions.field.requiredQuantity')}
                  value={scopeQuantity}
                  onChange={(event) => setScopeQuantity(event.target.value)}
                />
              )}
            </Box>

            {/* Interruptores y acción en su propia fila: son decisiones sobre lo
                de arriba, no un campo más, y metidos en la rejilla robaban el
                ancho justo al buscador. */}
            <Stack
              direction="row"
              sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
            >
              {/* Solo en un alcance de CATEGORÍA: en los demás la casilla no
                  significa nada y la base la rechaza. Apagada por defecto —una
                  campaña no se amplía sola a lo que alguien cuelgue mañana—. */}
              {scopeKind === 'category' && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={scopeDescendants}
                      onChange={(event) => setScopeDescendants(event.target.checked)}
                    />
                  }
                  label={t('promotions.field.includeDescendants')}
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={scopeExclusion}
                    onChange={(event) => setScopeExclusion(event.target.checked)}
                    disabled={promotion.kind === 'bundle'}
                  />
                }
                label={t('promotions.field.exclusion')}
              />
              <Box sx={{ flex: 1 }} />
              {/* Botón de verdad y no un enlace: es la acción que de hecho
                  añade el alcance, y compitiendo con el «Guardar» del pie —que
                  guarda la campaña y NO el alcance— pasaba por decoración.
                  Apagado mientras falte lo que hace falta: pulsarlo con el
                  buscador vacío añadía la elección anterior, que ya no estaba a
                  la vista. */}
              <Button
                variant="contained"
                size="small"
                disabled={!alcanceListo || addScope.isPending}
                onClick={() => void submitScope()}
              >
                {t('promotions.scope.add')}
              </Button>
            </Stack>
          </Stack>
        )}

        {promotion?.kind === 'volume_tier' && (
          <>
            <Divider textAlign="left">
              <Typography variant="overline">{t('promotions.section.tiers')}</Typography>
            </Divider>
            <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
              {t('promotions.tier.help')}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(tiers.data ?? []).map((tier) => (
                <Chip
                  key={tier.id}
                  size="small"
                  label={`≥ ${trimDecimals(tier.min_quantity)} → ${
                    tier.discount_percent
                      ? `${trimDecimals(tier.discount_percent)} %`
                      : `${tier.discount_amount} ${currency}`
                  }`}
                  onDelete={() => void removeTier.mutateAsync(tier.id)}
                  deleteIcon={<DeleteRoundedIcon />}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label={t('promotions.field.minQuantity')}
                value={tierQuantity}
                onChange={(event) => setTierQuantity(event.target.value)}
              />
              <TextField
                size="small"
                label={t('promotions.field.percent')}
                value={tierPercent}
                onChange={(event) => setTierPercent(event.target.value)}
              />
              <IconButton onClick={() => void submitTier()} aria-label={t('promotions.tier.add')}>
                <span aria-hidden>＋</span>
              </IconButton>
            </Stack>
          </>
        )}
      </Stack>
    </FormDrawer>
  )
}
