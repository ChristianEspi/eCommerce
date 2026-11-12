import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import {
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate } from '@/shared/lib/format'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { PromotionDrawer } from './PromotionDrawer'
import { PromotionsError } from './errors'
import { useDeletePromotion, usePromotions, useSetPromotionStatus } from './hooks'
import { combinationLabel, promotionSummary, type Promotion } from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Interpolación de parámetros. `t()` devuelve el texto de la clave tal cual —el
 * diccionario es un mapa plano, no una plantilla— así que sustituir es trabajo
 * de quien pinta. Es el mismo patrón que la conciliación de P09, y está aquí y
 * no en `types.ts` a propósito: `promotionSummary` tiene que poder probarse sin
 * un diccionario delante.
 */
function fill(text: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    text,
  )
}

/**
 * Los cinco estados que la pantalla ofrece como pestañas.
 *
 * `live` primero porque es el que responde la pregunta cara —«¿qué estoy
 * descontando ahora mismo?»— y `scheduled` segundo porque es la que evita la
 * sorpresa del lunes. Son estados EFECTIVOS, derivados en la base
 * (`promotion_overview`): la pantalla no los calcula, para que no pueda decir
 * una cosa distinta de la que dice el motor.
 */
const STATUS_TABS = ['live', 'scheduled', 'draft', 'paused', 'expired', 'all'] as const

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  live: 'success',
  scheduled: 'info',
  expired: 'default',
  exhausted: 'warning',
  draft: 'default',
  paused: 'warning',
  archived: 'default',
}

/**
 * Las campañas: qué descuenta cada una, cuándo, con qué prioridad y si combina.
 *
 * Las cuatro columnas del centro son las cuatro preguntas que el encargo pide
 * poder responder de un vistazo (regla 9: «estado, vigencia, alcance,
 * prioridad»), y ninguna es decorativa:
 *
 *   estado efectivo  «¿está descontando AHORA?» — no «¿la encendió alguien?»
 *   vigencia         desde cuándo y hasta cuándo
 *   alcance          sobre cuántas cosas cae, y cuántas están excluidas
 *   prioridad        quién va primero cuando dos se solapan
 *   combinación      exclusiva, de un grupo, o libre
 *
 * Y una más que casi nunca se enseña: **lo que la campaña ya ha costado**
 * (`discount_granted`). Es la cifra que decide si se renueva, y sin ella la
 * única forma de saberlo es exportar los pedidos.
 */
export function CampaignsSection() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId, can } = useTenant()
  const canManage = can('store.manage')

  const [status, setStatus] = useState<string>('live')
  const [term, setTerm] = useState('')
  const [editing, setEditing] = useState<Promotion | null>(null)
  const [creating, setCreating] = useState(false)

  const promotions = usePromotions({ storeId: activeStore?.id ?? null, status, term })
  const setStatusMutation = useSetPromotionStatus()
  const remove = useDeletePromotion()

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

  const list = promotions.data ?? []

  /**
   * La campaña recién creada, esperando a aparecer en la lista para abrirla
   * en edición. Nace en borrador y la lista abre en «Vigentes»: sin cambiar a
   * «Todas» desaparecía al guardarla.
   */
  const [recienCreada, setRecienCreada] = useState<string | null>(null)
  useEffect(() => {
    if (!recienCreada) return
    const encontrada = promotions.data?.find((promotion) => promotion.id === recienCreada)
    if (!encontrada) return
    setEditing(encontrada)
    setCreating(false)
    setRecienCreada(null)
  }, [recienCreada, promotions.data])
  const isEmpty = !promotions.isPending && !promotions.isError && list.length === 0

  async function run(action: () => Promise<unknown>, okKey: MessageKey) {
    try {
      await action()
      notify(t(okKey), 'success')
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
      <Typography sx={{ color: 'var(--muted)' }}>{t('promotions.campaigns.help')}</Typography>

      <FilterBar
        actions={
          <Button variant="contained" onClick={() => setCreating(true)}>
            {t('promotions.campaigns.new')}
          </Button>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('promotions.campaigns.search')}
          />
        </Box>
        <SelectField
          size="small"
          label={t('common.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 200 }}
          SelectProps={{ native: true }}
        >
          {STATUS_TABS.map((value) => (
            <option key={value} value={value}>
              {t(`promotions.status.${value}` as MessageKey)}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      <Card>
        {promotions.isPending && <TableSkeleton columns={7} />}
        {promotions.isError && (
          <ErrorState error={promotions.error} onRetry={() => void promotions.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={t('promotions.campaigns.empty')}
            description={t('promotions.campaigns.emptyBody')}
            icon={<LocalOfferRoundedIcon fontSize="small" />}
            action={
              <Button variant="contained" onClick={() => setCreating(true)}>
                {t('promotions.campaigns.new')}
              </Button>
            }
          />
        )}
        {!promotions.isPending && !promotions.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('promotions.field.name')}</TableCell>
                <TableCell>{t('promotions.field.discount')}</TableCell>
                <TableCell>{t('promotions.field.period')}</TableCell>
                <TableCell align="right">{t('promotions.field.scope')}</TableCell>
                <TableCell align="right">{t('promotions.field.priority')}</TableCell>
                <TableCell>{t('promotions.field.combination')}</TableCell>
                <TableCell align="right">{t('promotions.field.granted')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((promotion) => {
                const summary = promotionSummary(promotion)
                return (
                  <TableRow
                    key={promotion.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setEditing(promotion)}
                  >
                    <TableCell>
                      <Typography sx={{ fontWeight: 700 }}>{promotion.name}</Typography>
                      <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>
                        {promotion.code}
                        {promotion.requires_coupon && ` · ${t('promotions.field.needsCoupon')}`}
                      </Typography>
                    </TableCell>
                    <TableCell>{fill(t(summary.key as MessageKey), summary.params)}</TableCell>
                    <TableCell>
                      {formatDate(promotion.valid_from, locale)}
                      {promotion.valid_to
                        ? ` → ${formatDate(promotion.valid_to, locale)}`
                        : ` → ${t('promotions.field.noEnd')}`}
                    </TableCell>
                    <TableCell align="right">
                      {promotion.scope_count}
                      {promotion.exclusion_count > 0 && (
                        <Chip
                          size="small"
                          sx={{ ml: 1 }}
                          label={`−${promotion.exclusion_count}`}
                          aria-label={t('promotions.field.exclusions')}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">{promotion.priority}</TableCell>
                    <TableCell>{t(combinationLabel(promotion) as MessageKey)}</TableCell>
                    <TableCell align="right">
                      {promotion.discount_granted} {activeStore?.currency}
                    </TableCell>
                    <TableCell>
                      {/* «Descontando» sin alcance era mentira: el motor no la
                          aplica a ninguna línea. Se dice lo que de verdad pasa. */}
                      {promotion.effective_status === 'live' && promotion.scope_count === 0 ? (
                        <StatusChip tone="warning" label={t('promotions.status.noScope')} />
                      ) : (
                        <StatusChip
                          tone={STATUS_COLOR[promotion.effective_status] ?? 'default'}
                          label={t(
                            `promotions.status.${promotion.effective_status}` as MessageKey,
                          )}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
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

      <PromotionDrawer
        open={creating || editing !== null}
        promotion={editing}
        scope={scope}
        currency={activeStore?.currency ?? ''}
        onClose={() => {
          setCreating(false)
          setEditing(null)
          setRecienCreada(null)
        }}
        onCreated={(id) => {
          setTerm('')
          setStatus('all')
          setRecienCreada(id)
        }}
        onPause={(promotion) =>
          void run(
            () =>
              setStatusMutation.mutateAsync({
                id: promotion.id,
                status: promotion.status === 'active' ? 'paused' : 'active',
              }),
            'promotions.campaigns.statusChanged',
          )
        }
        onArchive={(promotion) =>
          void run(
            () => setStatusMutation.mutateAsync({ id: promotion.id, status: 'archived' }),
            'promotions.campaigns.archived',
          )
        }
        onDelete={(promotion) =>
          void run(async () => {
            await remove.mutateAsync(promotion.id)
            setEditing(null)
          }, 'promotions.campaigns.deleted')
        }
      />
    </Stack>
  )
}
