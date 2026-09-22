import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import DoDisturbAltRoundedIcon from '@mui/icons-material/DoDisturbAltRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import LoginRoundedIcon from '@mui/icons-material/LoginRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FilterBar } from '@/shared/ui/FilterBar'
import { RowActions, type RowAction } from '@/shared/ui/RowActions'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { VisitDrawer } from './VisitDrawer'
import { VisitAiDrawer } from './ai/VisitAiDrawer'
import { SalesError } from './errors'
import { useCheckInVisit, useCloseVisit, useVisits } from './hooks'
import { canComplete, type Visit, type VisitOutcome } from './types'

/**
 * Visitas: la agenda y el hecho, que no son lo mismo.
 *
 * ## `planned_at` no se machaca con la entrada
 *
 * Registrar la llegada guarda `checked_in_at` y deja intacta la hora prevista.
 * Pisar una con otra borraría la única prueba de que la visita no se hizo
 * cuando tocaba, que es justo lo que se le pregunta a una fuerza de campo.
 *
 * ## «Visitado» exige haber entrado
 *
 * `sales_visits_completed_needs_checkin` obliga a que una visita cerrada como
 * `completed` tenga entrada registrada. El botón se apaga por la misma razón por
 * la que existe el CHECK: sin marca de entrada, «visitado» es una afirmación que
 * nada respalda — y en una fuerza de campo eso se paga en comisiones.
 */
export function VisitsSection() {
  const { t } = useI18n()
  const { tenant, activeCompanyId, can } = useTenant()
  // La visita SÍ es operación de campo: el preventista registra la suya. El
  // alcance —qué clientes— no lo pone este permiso, lo pone la RLS contra
  // `sales_rep_customers`.
  const canWrite = can('sales.operate')

  const [search, setSearch] = useState('')
  const [soloAbiertas, setSoloAbiertas] = useState(true)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  // Asistente de visita (fase 06): solo para los roles de la funcionalidad
  // `sales`; qué visitas y qué datos ve, lo decide la base.
  const [asistente, setAsistente] = useState<Visit | null>(null)
  const { availability: aiSales } = useAiFeature('sales')
  const showAi = aiSales !== 'forbidden' && aiSales !== 'loading'

  const query = useVisits()
  const checkIn = useCheckInVisit()
  const close = useCloseVisit()

  const visitas = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (query.data ?? []).filter((visit) => {
      if (soloAbiertas && visit.outcome !== 'planned') return false
      if (!term) return true
      return (
        (visit.customer_name ?? '').toLowerCase().includes(term) ||
        (visit.rep_name ?? '').toLowerCase().includes(term)
      )
    })
  }, [query.data, search, soloAbiertas])

  const isEmpty = !query.isPending && !query.isError && visitas.length === 0
  const pager = usePagedRows(visitas)

  const scope =
    tenant && activeCompanyId
      ? { organizationId: tenant.organization_id, companyId: activeCompanyId }
      : null

  function tono(outcome: VisitOutcome) {
    if (outcome === 'completed') return 'success' as const
    if (outcome === 'closed' || outcome === 'no_order') return 'warning' as const
    if (outcome === 'rescheduled') return 'info' as const
    return 'default' as const
  }

  async function registrarEntrada(id: string) {
    setError(null)
    try {
      await checkIn.mutateAsync(id)
    } catch (err) {
      setError(err instanceof SalesError ? err.key : 'sales.error.generic')
    }
  }

  // Las tres acciones de la fila se arman aquí y no en el JSX porque no todas
  // aplican a la vez: registrar entrada solo antes de haberla registrado, y
  // «cerrado» solo mientras la visita siga planificada.
  function acciones(visit: Visit): RowAction[] {
    const lista: RowAction[] = []
    if (showAi) {
      lista.push({
        id: 'ai-assistant',
        icon: <AutoAwesomeRoundedIcon fontSize="small" />,
        label: `${t('aiSales.open')}: ${visit.customer_name ?? ''}`,
        tone: 'accent',
        onClick: () => setAsistente(visit),
      })
    }
    if (visit.outcome === 'planned' && visit.checked_in_at === null) {
      lista.push({
        id: 'check-in',
        icon: <LoginRoundedIcon fontSize="small" />,
        label: `${t('sales.visits.checkIn')}: ${visit.customer_name ?? ''}`,
        tone: 'neutral',
        disabled: !canWrite || checkIn.isPending,
        onClick: () => void registrarEntrada(visit.id),
      })
    }
    // Sin entrada registrada no se puede dar por visitada: el CHECK de la base
    // lo rechazaría, y con razón.
    lista.push({
      id: 'complete',
      icon: <CheckCircleRoundedIcon fontSize="small" />,
      label: `${t('sales.visits.complete')}: ${visit.customer_name ?? ''}`,
      tone: 'accent',
      disabled: !canWrite || !canComplete(visit) || close.isPending,
      onClick: () => void cerrar(visit.id, 'completed'),
    })
    if (visit.outcome === 'planned') {
      lista.push({
        id: 'closed',
        icon: <DoDisturbAltRoundedIcon fontSize="small" />,
        label: `${t('sales.visits.markClosed')}: ${visit.customer_name ?? ''}`,
        tone: 'neutral',
        disabled: !canWrite || close.isPending,
        onClick: () => void cerrar(visit.id, 'closed'),
      })
    }
    return lista
  }

  async function cerrar(id: string, outcome: VisitOutcome) {
    setError(null)
    try {
      await close.mutateAsync({ id, outcome })
    } catch (err) {
      setError(err instanceof SalesError ? err.key : 'sales.error.generic')
    }
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('sales.visits.help')}</Typography>

      {error && <Alert severity="error">{t(error)}</Alert>}

      <FilterBar
        actions={
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setSoloAbiertas((previo) => !previo)}>
              {soloAbiertas ? t('sales.visits.showAll') : t('sales.visits.onlyOpen')}
            </Button>
            <Button variant="contained" disabled={!canWrite || !scope} onClick={() => setCreando(true)}>
              {t('sales.visits.new')}
            </Button>
          </Stack>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 300 } }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('sales.visits.search')}
            ariaLabel={t('sales.visits.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={5} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('sales.noResults') : t('sales.visits.empty')}
            description={search ? undefined : t('sales.visits.emptyBody')}
            icon={<EventAvailableRoundedIcon fontSize="small" />}
          />
        )}

        {!query.isPending && !query.isError && visitas.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('sales.field.plannedAt')}</TableCell>
                <TableCell>{t('sales.field.customerName')}</TableCell>
                <TableCell>{t('sales.field.rep')}</TableCell>
                <TableCell>{t('sales.field.checkedIn')}</TableCell>
                <TableCell>{t('sales.field.outcome')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((visit: Visit) => (
                <TableRow key={visit.id} hover>
                  {/* La AGENDA y el HECHO en dos columnas distintas: una visita
                      que llegó dos horas tarde tiene que poder verse. */}
                  <TableCell>{visit.planned_at?.slice(0, 16).replace('T', ' ') ?? '—'}</TableCell>
                  <TableCell>{visit.customer_name ?? '—'}</TableCell>
                  <TableCell>{visit.rep_name ?? '—'}</TableCell>
                  <TableCell>
                    {visit.checked_in_at?.slice(0, 16).replace('T', ' ') ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      tone={tono(visit.outcome)}
                      label={t(`sales.outcome.${visit.outcome}` as MessageKey)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions actions={acciones(visit)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {pager.total > 0 && (
          <TablePager
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
          />
        )}
      </Card>

      <VisitAiDrawer
        key={asistente?.id ?? 'none'}
        open={asistente !== null}
        visitId={asistente?.id ?? null}
        customerName={asistente?.customer_name ?? null}
        onClose={() => setAsistente(null)}
      />

      <VisitDrawer
        open={creando}
        scope={scope}
        canWrite={canWrite}
        onClose={() => setCreando(false)}
      />
    </Stack>
  )
}
