import AltRouteRoundedIcon from '@mui/icons-material/AltRouteRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
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
import { ChannelDrawer } from './ChannelDrawer'
import { ChannelError } from './errors'
import {
  useChannelCatalogSummary,
  useChannels,
  useSetChannelActive,
  useSetDefaultChannel,
} from './hooks'
import { defaultBlocker, type Channel } from './types'

const BLOCKER_KEY: Record<'already' | 'inactive' | 'closed', MessageKey> = {
  already: 'channels.blocker.already',
  inactive: 'channels.blocker.inactive',
  closed: 'channels.blocker.closed',
}

/**
 * Canales de venta de la tienda activa (cierre · item 7).
 *
 * ## Un canal no es una tienda
 *
 * Decide por donde se vende el catalogo unico y si hace falta sesion. Por eso
 * la lista enseña, junto a cada canal, CUANTO catalogo tiene declarado: «todo
 * el catalogo» cuando no hay filas en `product_channels`, que es exactamente la
 * regla con la que `create_order` acepta o rechaza un producto.
 *
 * ## El canal por defecto se protege, y se dice por que
 *
 * Es la puerta de la tienda publica. Desactivarlo o cerrarlo la dejaria sin
 * vender, asi que sus acciones peligrosas salen apagadas CON el motivo en la
 * etiqueta, y el cambio de defecto pasa por `channel_set_default`, que lo hace
 * en una sola transaccion. La base aplica las mismas reglas: si esta pantalla
 * se quedara atras, el servidor responde con su codigo y aqui se traduce.
 */
export function ChannelsPage() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeStore, activeCompanyId, status: tenantStatus, can } = useTenant()
  const canWrite = can('store.manage')
  const storeId = activeStore?.id ?? null

  const [search, setSearch] = useState('')
  const [editando, setEditando] = useState<Channel | null>(null)
  const [creando, setCreando] = useState(false)
  const [candidato, setCandidato] = useState<Channel | null>(null)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const query = useChannels(storeId)
  const summary = useChannelCatalogSummary(storeId)
  const setActive = useSetChannelActive()
  const setDefault = useSetDefaultChannel()

  const conteos = useMemo(() => {
    const map = new Map<string, number>()
    for (const fila of summary.data ?? []) map.set(fila.channel_id, fila.product_count)
    return map
  }, [summary.data])

  const canales = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    // UN buscador para todo: codigo, nombre y el tipo tal como se lee en
    // pantalla. Nada de paneles de filtros por campo.
    return all.filter((row) =>
      [row.code, row.name, row.kind, t(`channels.kind.${row.kind}` as MessageKey)]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [query.data, search, t])

  const isEmpty = !query.isPending && !query.isError && canales.length === 0

  const scope =
    tenant && activeCompanyId && activeStore
      ? { organizationId: tenant.organization_id, companyId: activeCompanyId, storeId: activeStore.id }
      : null

  function traducir(error: unknown): MessageKey {
    return error instanceof ChannelError ? error.key : 'channels.error.generic'
  }

  async function alternarActivo(channel: Channel) {
    setServerError(null)
    try {
      await setActive.mutateAsync({ id: channel.id, active: !channel.is_active })
      notify(
        t(channel.is_active ? 'channels.toast.deactivated' : 'channels.toast.activated'),
        'success',
      )
    } catch (error) {
      setServerError(traducir(error))
    }
  }

  async function confirmarDefecto() {
    if (!candidato) return
    setServerError(null)
    try {
      const { changed } = await setDefault.mutateAsync(candidato.id)
      notify(t(changed ? 'channels.toast.default' : 'channels.toast.unchanged'), 'success')
    } catch (error) {
      setServerError(traducir(error))
    } finally {
      setCandidato(null)
    }
  }

  const cabecera = (
    <PageHeader
      icon={<AltRouteRoundedIcon />}
      title={t('channels.title')}
      subtitle={activeStore?.name ?? t('channels.subtitle')}
      actions={
        <Button
          variant="contained"
          disabled={!canWrite || !scope}
          onClick={() => {
            setEditando(null)
            setCreando(true)
          }}
        >
          {t('channels.new')}
        </Button>
      }
    />
  )
  if (tenantStatus === 'loading') {
    return (
      <>
        {cabecera}
        <Card>
          <TableSkeleton columns={6} />
        </Card>
      </>
    )
  }

  if (!scope) {
    return (
      <>
        {cabecera}
        <Card>
          <EmptyState
            title={t('admin.store.none')}
            description={t('admin.store.noneBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  function acciones(row: Channel): RowAction[] {
    const bloqueo = defaultBlocker(row)
    return [
      {
        id: 'edit',
        icon: <EditRoundedIcon fontSize="small" />,
        label: `${t('channels.action.edit')}: ${row.name}`,
        tone: 'neutral',
        onClick: () => {
          setCreando(false)
          setEditando(row)
        },
      },
      {
        id: 'default',
        icon: <StarRoundedIcon fontSize="small" />,
        // Apagado con el MOTIVO en la etiqueta: un boton gris sin explicacion
        // se lee como un fallo, no como una regla.
        label: bloqueo
          ? `${t(BLOCKER_KEY[bloqueo])}: ${row.name}`
          : `${t('channels.action.makeDefault')}: ${row.name}`,
        tone: 'accent',
        disabled: !canWrite || bloqueo !== null || setDefault.isPending,
        onClick: () => setCandidato(row),
      },
      row.is_active
        ? {
            id: 'deactivate',
            icon: <BlockRoundedIcon fontSize="small" />,
            label: row.is_default
              ? `${t('channels.blocker.deactivateDefault')}: ${row.name}`
              : `${t('channels.action.deactivate')}: ${row.name}`,
            tone: 'danger',
            disabled: !canWrite || row.is_default || setActive.isPending,
            onClick: () => void alternarActivo(row),
          }
        : {
            id: 'activate',
            icon: <CheckCircleRoundedIcon fontSize="small" />,
            label: `${t('channels.action.activate')}: ${row.name}`,
            tone: 'accent',
            disabled: !canWrite || setActive.isPending,
            onClick: () => void alternarActivo(row),
          },
    ]
  }

  function catalogo(row: Channel): string {
    const n = conteos.get(row.id)
    if (n === undefined) return summary.isPending ? '…' : '—'
    if (n === 0) return t('channels.catalog.all')
    if (n === 1) return t('channels.catalog.one')
    return t('channels.catalog.count').replace('{n}', String(n))
  }

  return (
    <>
      {cabecera}

      <Stack spacing={2}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('channels.help')}</Typography>
        {!canWrite && <Alert severity="info">{t('channels.readOnly')}</Alert>}
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
              placeholder={t('channels.search')}
              ariaLabel={t('channels.search')}
            />
          </Box>
        </FilterBar>

        <Card>
          {query.isPending && <TableSkeleton columns={6} />}
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          {isEmpty && (
            <EmptyState
              title={search ? t('channels.noResults') : t('channels.empty')}
              description={search ? undefined : t('channels.emptyBody')}
              icon={<AltRouteRoundedIcon fontSize="small" />}
            />
          )}

          {!query.isPending && !query.isError && canales.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('channels.field.code')}</TableCell>
                    <TableCell>{t('channels.field.name')}</TableCell>
                    <TableCell>{t('channels.field.kind')}</TableCell>
                    <TableCell>{t('channels.field.access')}</TableCell>
                    <TableCell>{t('channels.field.catalog')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {canales.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{row.code}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{t(`channels.kind.${row.kind}` as MessageKey)}</TableCell>
                      <TableCell>
                        <StatusChip
                          tone={row.requires_auth ? 'warning' : 'info'}
                          label={
                            row.requires_auth ? t('channels.access.session') : t('channels.access.public')
                          }
                        />
                      </TableCell>
                      <TableCell>{catalogo(row)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                          {row.is_default && <StatusChip tone="success" label={t('channels.default')} />}
                          <StatusChip
                            tone={row.is_active ? 'success' : 'default'}
                            label={row.is_active ? t('common.active') : t('common.inactive')}
                          />
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <RowActions actions={acciones(row)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Card>
      </Stack>

      <ChannelDrawer
        open={creando || editando !== null}
        channel={editando}
        scope={scope}
        canWrite={canWrite}
        onClose={() => {
          setCreando(false)
          setEditando(null)
        }}
      />

      <Dialog open={candidato !== null} onClose={() => setCandidato(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('channels.confirm.title').replace('{name}', candidato?.name ?? '')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{t('channels.confirm.body')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCandidato(null)} disabled={setDefault.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => void confirmarDefecto()}
            disabled={setDefault.isPending}
          >
            {t('channels.confirm.action')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}