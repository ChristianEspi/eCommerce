import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import LoginRoundedIcon from '@mui/icons-material/LoginRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FilterBar } from '@/shared/ui/FilterBar'
import { PageHeader } from '@/shared/ui/PageHeader'
import { RowActions, type RowAction } from '@/shared/ui/RowActions'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StoreAdminError } from './errors'
import { useCompanyStores, useSetStoreStatus } from './hooks'
import { StoreFormDrawer } from './StoreFormDrawer'
import type { ManagedStore, StoreStatus } from './types'

const STATUS_LABEL: Record<StoreStatus, MessageKey> = {
  draft: 'storesAdmin.status.draft',
  active: 'storesAdmin.status.active',
  suspended: 'storesAdmin.status.suspended',
}
const STATUS_TONE: Record<StoreStatus, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  active: 'success',
  suspended: 'warning',
}

/**
 * Tiendas de la sociedad activa (Stores + Product Master, fase 02).
 *
 * ## Qué se puede hacer aquí
 *
 * Ver todas las tiendas de la sociedad, crear otra, editar nombre, dirección,
 * moneda y dominio, activarla o suspenderla, y **cambiar a ella** con el mismo
 * selector que la cabecera (la preferencia queda guardada por sociedad).
 *
 * ## Qué no
 *
 * No hay borrar: una tienda con pedidos, cobros y movimientos de inventario se
 * suspende. Y la pantalla entera exige `store.manage`; el servidor lo vuelve a
 * exigir en cada comando, así que ocultar botones aquí es cortesía, no el candado.
 */
export function StoresPage() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { status: tenantStatus, tenant, activeCompanyId, activeStore, can, setActiveStore } = useTenant()
  const { has } = useCapabilities()
  const canManage = can('store.manage')

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ManagedStore | null>(null)
  const [creating, setCreating] = useState(false)
  const [toSuspend, setToSuspend] = useState<ManagedStore | null>(null)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const stores = useCompanyStores(canManage ? activeCompanyId : null)
  const setStatus = useSetStoreStatus()

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = stores.data ?? []
    if (!term) return all
    return all.filter((row) => [row.name, row.slug, row.domain ?? '', row.currency].join(' ').toLowerCase().includes(term))
  }, [stores.data, search])

  const companyLabel = t('storesAdmin.account').replace('{account}', tenant?.name ?? '')

  const header = (
    <PageHeader
      icon={<StorefrontRoundedIcon />}
      title={t('storesAdmin.title')}
      subtitle={tenant ? companyLabel : t('storesAdmin.subtitle')}
      actions={
        canManage ? (
          <Button
            variant="contained"
            disabled={!activeCompanyId}
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
          >
            {t('storesAdmin.new')}
          </Button>
        ) : undefined
      }
    />
  )

  if (tenantStatus === 'loading') {
    return (
      <>
        {header}
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!canManage) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            title={t('storesAdmin.forbidden')}
            description={t('storesAdmin.forbiddenBody')}
            icon={<LockRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  async function changeStatus(store: ManagedStore, status: StoreStatus) {
    setServerError(null)
    try {
      await setStatus.mutateAsync({ storeId: store.id, status })
      notify(t(status === 'active' ? 'storesAdmin.toast.activated' : 'storesAdmin.toast.suspended'), 'success')
    } catch (error) {
      setServerError(error instanceof StoreAdminError ? error.key : 'storesAdmin.error.generic')
    }
  }

  function actions(row: ManagedStore): RowAction[] {
    const isActive = activeStore?.id === row.id
    return [
      {
        id: 'use',
        icon: <LoginRoundedIcon fontSize="small" />,
        label: isActive ? `${t('storesAdmin.inUse')}: ${row.name}` : `${t('storesAdmin.action.use')}: ${row.name}`,
        tone: 'accent',
        disabled: isActive,
        onClick: () => {
          setActiveStore(row.id)
          notify(t('storesAdmin.toast.switched').replace('{store}', row.name), 'success')
        },
      },
      {
        id: 'edit',
        icon: <EditRoundedIcon fontSize="small" />,
        label: `${t('storesAdmin.action.edit')}: ${row.name}`,
        tone: 'neutral',
        onClick: () => {
          setCreating(false)
          setEditing(row)
        },
      },
      row.status === 'active'
        ? {
            id: 'suspend',
            icon: <BlockRoundedIcon fontSize="small" />,
            label: `${t('storesAdmin.action.suspend')}: ${row.name}`,
            tone: 'danger',
            disabled: setStatus.isPending,
            onClick: () => setToSuspend(row),
          }
        : {
            id: 'activate',
            icon: <CheckCircleRoundedIcon fontSize="small" />,
            label: `${t('storesAdmin.action.activate')}: ${row.name}`,
            tone: 'accent',
            disabled: setStatus.isPending,
            onClick: () => void changeStatus(row, 'active'),
          },
    ]
  }

  const isEmpty = !stores.isPending && !stores.isError && visible.length === 0

  return (
    <>
      {header}

      <Stack spacing={2}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('storesAdmin.help')}</Typography>
        {serverError && (
          <Alert severity="error" onClose={() => setServerError(null)}>
            {t(serverError)}
          </Alert>
        )}

        <FilterBar>
          <Box sx={{ minWidth: { xs: '100%', sm: 300 } }}>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={t('storesAdmin.search')}
              ariaLabel={t('storesAdmin.search')}
            />
          </Box>
        </FilterBar>

        <Card>
          {stores.isPending && <TableSkeleton columns={5} />}
          {stores.isError && <ErrorState error={stores.error} onRetry={() => void stores.refetch()} />}
          {isEmpty && (
            <EmptyState
              title={search ? t('storesAdmin.noResults') : t('storesAdmin.empty')}
              description={search ? undefined : t('storesAdmin.emptyBody')}
              icon={<StorefrontRoundedIcon fontSize="small" />}
            />
          )}

          {!stores.isPending && !stores.isError && visible.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('storesAdmin.title')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('storesAdmin.field.name')}</TableCell>
                    <TableCell>{t('storesAdmin.field.domain')}</TableCell>
                    <TableCell>{t('storesAdmin.field.currency')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.id} hover selected={activeStore?.id === row.id}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 700 }}>{row.name}</Typography>
                        <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>/s/{row.slug}</Typography>
                      </TableCell>
                      <TableCell>{row.domain ?? '—'}</TableCell>
                      <TableCell>{row.currency}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                          <StatusChip tone={STATUS_TONE[row.status]} label={t(STATUS_LABEL[row.status])} />
                          {activeStore?.id === row.id && <StatusChip tone="info" label={t('storesAdmin.inUse')} />}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <RowActions actions={actions(row)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Card>
      </Stack>

      <StoreFormDrawer
        open={creating || editing !== null}
        store={editing}
        companyLabel={companyLabel}
        domainEnabled={has('content.white_label')}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />

      <Dialog open={toSuspend !== null} onClose={() => setToSuspend(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('storesAdmin.confirmSuspend.title').replace('{store}', toSuspend?.name ?? '')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('storesAdmin.confirmSuspend.body')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToSuspend(null)} disabled={setStatus.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={setStatus.isPending}
            onClick={() => {
              const target = toSuspend
              setToSuspend(null)
              if (target) void changeStatus(target, 'suspended')
            }}
          >
            {t('storesAdmin.action.suspend')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
