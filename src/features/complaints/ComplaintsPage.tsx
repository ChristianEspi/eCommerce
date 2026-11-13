import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { downloadWorkbook } from '@/shared/lib/excel'
import { complaintsBook } from './exportExcel'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { businessDaysSince, useComplaints, useRespondComplaint, type Complaint } from './api'

type Filtro = 'open' | 'answered' | 'all'
const TABS: ReadonlyArray<{ value: Filtro; label: MessageKey }> = [
  { value: 'open', label: 'complaints.tab.open' },
  { value: 'answered', label: 'complaints.tab.answered' },
  { value: 'all', label: 'complaints.tab.all' },
]
const PLAZO_DIAS = 15

/**
 * Libro de Reclamaciones · la bandeja del comercio (2026-10-02).
 *
 * Un buscador, pestañas de estado y exportar (regla de listados de la suite).
 * Cada hoja se abre en un diálogo con todo lo que escribió el consumidor y,
 * para quien tiene `orders.write`, la respuesta. El plazo legal (15 días
 * hábiles) se cuenta y se avisa: es lo que el comercio no puede dejar pasar.
 */
export function ComplaintsPage() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore, status: tenantStatus, can } = useTenant()
  const storeId = activeStore?.id ?? null
  const lista = useComplaints(activeCompanyId, storeId)
  const responder = useRespondComplaint(activeCompanyId, storeId)
  const puedeResponder = can('orders.write')

  const [filtro, setFiltro] = useState<Filtro>('open')
  const [term, setTerm] = useState('')
  const [abierta, setAbierta] = useState<Complaint | null>(null)
  const [respuesta, setRespuesta] = useState('')

  const filas = useMemo(() => {
    const q = term.trim().toLowerCase()
    return (lista.data ?? []).filter((c) => {
      if (filtro === 'open' && c.status === 'answered') return false
      if (filtro === 'answered' && c.status !== 'answered') return false
      if (!q) return true
      return [c.code, c.consumer_name, c.consumer_email, c.doc_number, c.item_description]
        .some((v) => v.toLowerCase().includes(q))
    })
  }, [lista.data, filtro, term])

  const header = (
    <PageHeader
      icon={<MenuBookRoundedIcon />}
      title={t('complaints.title')}
      subtitle={activeStore?.name ?? t('complaints.subtitle')}
      actions={
        <Button
          variant="outlined"
          disabled={filas.length === 0}
          onClick={() =>
            void downloadWorkbook(
              complaintsBook(filas, t, `libro-reclamaciones-${activeStore?.slug ?? 'tienda'}`),
              t,
            ).catch(() => notify(t('excel.error.download'), 'error'))
          }
        >
          {t('common.export')}
        </Button>
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
  if (!tenant || !activeCompanyId || !storeId) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title={t('admin.store.none')} description={t('admin.store.noneBody')} icon={<StorefrontRoundedIcon fontSize="small" />} />
        </Card>
      </>
    )
  }

  const estado = (c: Complaint) => {
    if (c.status === 'answered') return <Chip size="small" color="success" label={t('complaints.status.answered')} />
    const dias = businessDaysSince(c.created_at)
    const vencido = dias > PLAZO_DIAS
    return (
      <Chip
        size="small"
        color={vencido ? 'error' : dias >= PLAZO_DIAS - 3 ? 'warning' : 'default'}
        label={`${t(c.status === 'in_progress' ? 'complaints.status.inProgress' : 'complaints.status.received')} · ${t(
          'complaints.days',
        ).replace('{n}', String(dias))}`}
      />
    )
  }

  async function marcar(status: 'in_progress' | 'answered') {
    if (!abierta) return
    try {
      await responder.mutateAsync({ id: abierta.id, status, response: status === 'answered' ? respuesta : undefined })
      notify(t(status === 'answered' ? 'complaints.answeredToast' : 'complaints.inProgressToast'))
      setAbierta(null)
    } catch (error) {
      const codigo = (error as Error).message
      notify(t(codigo === 'RESPUESTA_REQUERIDA' ? 'complaints.error.response' : 'complaints.error.generic'), 'error')
    }
  }

  return (
    <>
      {header}
      <Stack spacing={2}>
        <Tabs
          value={filtro}
          onChange={(_, next: Filtro) => setFiltro(next)}
          centered
          aria-label={t('common.status')}
          sx={{ borderBottom: '1px solid var(--border)', '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 44 } }}
        >
          {TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={t(tab.label)} />
          ))}
        </Tabs>
        <SearchField value={term} onChange={setTerm} placeholder={t('complaints.search')} />
        <Card>
          {lista.isPending ? (
            <TableSkeleton columns={5} />
          ) : lista.isError ? (
            <ErrorState error={lista.error} onRetry={() => void lista.refetch()} />
          ) : filas.length === 0 ? (
            <EmptyState title={t('complaints.empty')} description={t('complaints.emptyBody')} icon={<MenuBookRoundedIcon fontSize="small" />} />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('complaints.col.code')}</TableCell>
                  <TableCell>{t('complaints.col.date')}</TableCell>
                  <TableCell>{t('complaints.col.kind')}</TableCell>
                  <TableCell>{t('complaints.col.consumer')}</TableCell>
                  <TableCell>{t('complaints.col.status')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filas.map((c) => (
                  <TableRow
                    key={c.id}
                    hover
                    tabIndex={0}
                    onClick={() => {
                      setAbierta(c)
                      setRespuesta(c.response ?? '')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setAbierta(c)
                        setRespuesta(c.response ?? '')
                      }
                    }}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ fontWeight: 700 }} className="tnum">{c.code}</TableCell>
                    <TableCell>{formatDate(c.created_at, locale)}</TableCell>
                    <TableCell>{t(c.kind === 'queja' ? 'store.complaints.kind.queja' : 'store.complaints.kind.reclamo')}</TableCell>
                    <TableCell>{c.consumer_name}</TableCell>
                    <TableCell>{estado(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </Stack>

      <Dialog open={abierta !== null} onClose={() => setAbierta(null)} fullWidth maxWidth="md">
        {abierta ? (
          <>
            <DialogTitle>
              {abierta.code} · {t(abierta.kind === 'queja' ? 'store.complaints.kind.queja' : 'store.complaints.kind.reclamo')}
            </DialogTitle>
            <DialogContent dividers>
              <Stack sx={{ gap: 2 }}>
                <Campo etiqueta={t('complaints.col.date')} valor={formatDateTime(abierta.created_at, locale)} />
                <Campo etiqueta={t('store.complaints.consumer')} valor={`${abierta.consumer_name} · ${abierta.doc_type.toUpperCase()} ${abierta.doc_number}`} />
                <Campo etiqueta={t('store.complaints.field.email')} valor={abierta.consumer_email} />
                {abierta.consumer_phone ? <Campo etiqueta={t('store.complaints.field.phone')} valor={abierta.consumer_phone} /> : null}
                {abierta.consumer_address ? <Campo etiqueta={t('store.complaints.field.address')} valor={abierta.consumer_address} /> : null}
                {abierta.is_minor && abierta.guardian_name ? <Campo etiqueta={t('store.complaints.field.guardian')} valor={abierta.guardian_name} /> : null}
                <Campo
                  etiqueta={t('store.complaints.item')}
                  valor={[abierta.item_description, abierta.amount !== null ? `S/ ${abierta.amount.toFixed(2)}` : null, abierta.order_reference]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <Campo etiqueta={t('store.complaints.field.detail')} valor={abierta.detail} />
                <Campo etiqueta={t('store.complaints.field.request')} valor={abierta.request} />
                {abierta.status === 'answered' ? (
                  <Alert severity="success">
                    <Typography sx={{ fontWeight: 700 }}>
                      {t('complaints.answeredOn').replace('{date}', formatDateTime(abierta.responded_at ?? abierta.created_at, locale))}
                    </Typography>
                    <Typography sx={{ whiteSpace: 'pre-line' }}>{abierta.response}</Typography>
                  </Alert>
                ) : puedeResponder ? (
                  <TextField
                    label={t('complaints.response')}
                    multiline
                    minRows={4}
                    value={respuesta}
                    onChange={(e) => setRespuesta(e.target.value)}
                    helperText={t('complaints.responseHelp')}
                  />
                ) : (
                  <Alert severity="info">{t('complaints.readOnly')}</Alert>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAbierta(null)}>{t('common.close')}</Button>
              {abierta.status === 'received' && puedeResponder ? (
                <Button onClick={() => void marcar('in_progress')} disabled={responder.isPending}>
                  {t('complaints.markInProgress')}
                </Button>
              ) : null}
              {abierta.status !== 'answered' && puedeResponder ? (
                <Button variant="contained" onClick={() => void marcar('answered')} disabled={responder.isPending || respuesta.trim().length < 10}>
                  {t('complaints.answer')}
                </Button>
              ) : null}
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </>
  )
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {etiqueta}
      </Typography>
      <Typography sx={{ whiteSpace: 'pre-line' }}>{valor}</Typography>
    </Box>
  )
}
