import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import ConfirmationNumberRoundedIcon from '@mui/icons-material/ConfirmationNumberRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { FIELD_RULES, ruleFor } from '@/shared/lib/fieldRules'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate } from '@/shared/lib/format'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { PromotionsError } from './errors'
import {
  useCoupons,
  useCreateCoupon,
  useDeleteCoupon,
  usePromotions,
  useSetCouponActive,
} from './hooks'
import { normalizeCouponCode } from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * El código del cupón: el de `code` (sin espacios) hasta los 64 caracteres
 * que admite `coupons_code_len`, y en mayúsculas, que es como lo guarda
 * `code_normalized`.
 */
const COUPON_CODE_RULE = ruleFor('code', {
  maxLength: 64,
  uppercase: true,
  sanitize: (value) => (FIELD_RULES.code.sanitize?.(value) ?? value).toUpperCase(),
})

/**
 * Los cupones: el código que el comprador teclea.
 *
 * Dos cosas que esta pantalla enseña y casi ninguna enseña:
 *
 *  1. **Cómo se va a guardar el código.** Debajo del campo se ve la forma
 *     normalizada —mayúsculas, sin guiones ni espacios—, que es la que el
 *     índice único de la base usa. Sin eso, dar de alta «Verano 25» cuando ya
 *     existe «verano-25» falla con un error de clave duplicada que nadie
 *     entiende, porque en la pantalla los dos códigos se ven distintos.
 *  2. **Cuántas veces se usó.** `usage_count` no se puede editar desde aquí —no
 *     hay GRANT que lo permita— y por eso es un dato fiable: lo mueve el
 *     comando que crea el pedido, con la fila bloqueada.
 *
 * Un cupón SIEMPRE cuelga de una campaña: es ella la que trae la vigencia, el
 * alcance, la prioridad y la combinación. Un cupón suelto sería un descuento
 * sin reglas, y por eso el selector de campaña es obligatorio.
 */
export function CouponsSection() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId, can } = useTenant()
  const canManage = can('store.manage')

  const [term, setTerm] = useState('')
  const [creating, setCreating] = useState(false)
  const [promotionId, setPromotionId] = useState('')
  const [code, setCode] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [usageLimit, setUsageLimit] = useState('')
  const [perCustomer, setPerCustomer] = useState('')
  const [notes, setNotes] = useState('')

  const coupons = useCoupons(activeStore?.id ?? null, term)
  // Solo las campañas que EXIGEN cupón: colgar un código de una campaña
  // automática sería un descuento que se aplica por dos vías a la vez.
  const promotions = usePromotions({ storeId: activeStore?.id ?? null, status: 'all', term: '' })
  const couponable = (promotions.data ?? []).filter((promotion) => promotion.requires_coupon)

  const scope = useMemo(
    () =>
      tenant && activeCompanyId && activeStore
        ? {
            organizationId: tenant.organization_id,
            companyId: activeCompanyId,
            storeId: activeStore.id,
          }
        : null,
    [tenant, activeCompanyId, activeStore],
  )

  const create = useCreateCoupon(scope)
  const setActive = useSetCouponActive()
  const remove = useDeleteCoupon()

  const list = coupons.data ?? []
  const isEmpty = !coupons.isPending && !coupons.isError && list.length === 0
  const normalized = normalizeCouponCode(code)
  const duplicate = list.some((coupon) => coupon.code_normalized === normalized)

  const promotionName = (id: string) =>
    (promotions.data ?? []).find((promotion) => promotion.id === id)?.name ?? '—'

  async function submit() {
    try {
      await create.mutateAsync({
        promotionId,
        code,
        validFrom,
        validTo,
        usageLimit,
        usageLimitPerCustomer: perCustomer,
        notes,
      })
      notify(t('promotions.coupons.created'), 'success')
      setCode('')
      setNotes('')
      setCreating(false)
    } catch (error) {
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!canManage) {
    return (
      <UnauthorizedState
        title={t('promotions.forbidden.title')}
        description={t('promotions.forbidden.body')}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('promotions.coupons.help')}</Typography>

      <FilterBar
        actions={
          <Button
            variant="contained"
            onClick={() => setCreating(true)}
            disabled={couponable.length === 0}
          >
            {t('promotions.coupons.new')}
          </Button>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('promotions.coupons.search')}
          />
        </Box>
      </FilterBar>

      {couponable.length === 0 && !promotions.isPending && (
        <Alert severity="info">{t('promotions.coupons.needCampaign')}</Alert>
      )}

      <Card>
        {coupons.isPending && <TableSkeleton columns={6} />}
        {coupons.isError && (
          <ErrorState error={coupons.error} onRetry={() => void coupons.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={t('promotions.coupons.empty')}
            description={t('promotions.coupons.emptyBody')}
            icon={<ConfirmationNumberRoundedIcon fontSize="small" />}
          />
        )}
        {!coupons.isPending && !coupons.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('promotions.field.code')}</TableCell>
                <TableCell>{t('promotions.field.campaign')}</TableCell>
                <TableCell>{t('promotions.field.period')}</TableCell>
                <TableCell align="right">{t('promotions.field.uses')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((coupon) => (
                <TableRow key={coupon.id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      {coupon.code_normalized}
                    </Typography>
                    {coupon.code !== coupon.code_normalized && (
                      <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>
                        {t('promotions.coupons.typedAs')} {coupon.code}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{promotionName(coupon.promotion_id)}</TableCell>
                  <TableCell>
                    {coupon.valid_from ? formatDate(coupon.valid_from, locale) : '—'}
                    {coupon.valid_to ? ` → ${formatDate(coupon.valid_to, locale)}` : ''}
                  </TableCell>
                  <TableCell align="right">
                    {coupon.usage_count}
                    {coupon.usage_limit !== null && ` / ${coupon.usage_limit}`}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      tone={coupon.is_active ? 'success' : 'default'}
                      label={t(
                        coupon.is_active ? 'promotions.coupons.active' : 'promotions.coupons.off',
                      )}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Switch
                      size="small"
                      checked={coupon.is_active}
                      onChange={(event) =>
                        void setActive.mutateAsync({
                          id: coupon.id,
                          isActive: event.target.checked,
                        })
                      }
                      inputProps={{ 'aria-label': t('promotions.coupons.toggle') }}
                    />
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => void remove.mutateAsync(coupon.id)}
                    >
                      {t('promotions.action.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {/* El paginador solo aparece cuando hay algo que paginar: un
            "0-0 de 0" bajo un estado vacio es ruido que contradice al
            propio estado vacio. */}
        {pager.total > 0 && (
          <TablePager
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
          />
        )}
      </Card>

      <FormDrawer
        open={creating}
        title={t('promotions.coupons.new')}
        onClose={() => setCreating(false)}
        busy={create.isPending}
        actions={
          <>
            <Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={() => void submit()}
              disabled={create.isPending || promotionId === '' || normalized.length < 3}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2.5}>
          <SelectField
            label={t('promotions.field.campaign')}
            value={promotionId}
            onChange={(event) => setPromotionId(event.target.value)}
            helperText={t('promotions.hint.campaign')}
            size="small"
            fullWidth
          >
            {couponable.map((promotion) => (
              <MenuItem key={promotion.id} value={promotion.id}>
                {promotion.name}
              </MenuItem>
            ))}
          </SelectField>

          <Field
            label={t('promotions.field.code')}
            rule={COUPON_CODE_RULE}
            help={t('help.promotions.couponCode')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={duplicate}
            helperText={
              duplicate
                ? t('promotions.coupons.duplicate')
                : normalized === ''
                  ? t('promotions.hint.couponCode')
                  : `${t('promotions.coupons.willSaveAs')} ${normalized}`
            }
            size="small"
            fullWidth
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Field
              type="datetime-local"
              label={t('promotions.field.validFrom')}
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              fullWidth
            />
            <Field
              type="datetime-local"
              label={t('promotions.field.validTo')}
              value={validTo}
              onChange={(event) => setValidTo(event.target.value)}
              helperText={t('promotions.hint.couponPeriod')}
              InputLabelProps={{ shrink: true }}
              size="small"
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Field
              label={t('promotions.field.usageLimit')}
              rule="integer"
              help={t('help.promotions.couponUsageLimit')}
              value={usageLimit}
              onChange={(event) => setUsageLimit(event.target.value)}
              size="small"
              fullWidth
            />
            <Field
              label={t('promotions.field.usageLimitPerCustomer')}
              rule="integer"
              help={t('help.promotions.couponUsageLimitPerCustomer')}
              value={perCustomer}
              onChange={(event) => setPerCustomer(event.target.value)}
              size="small"
              fullWidth
            />
          </Stack>

          <Field
            label={t('promotions.field.notes')}
            rule="longText"
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            size="small"
            fullWidth
          />
        </Stack>
      </FormDrawer>
    </Stack>
  )
}
