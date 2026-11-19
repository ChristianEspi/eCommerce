import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
/**
 * Configuración de impuestos del tenant.
 *
 * Antes el IVA era `store_settings.tax_rate default 0.1800` —el IGV peruano—
 * y cambiarlo exigía SQL. Aquí se administra por categorías: un tenant boliviano
 * pone IVA 13 %, y quien venda alimentos puede tener una categoría exenta al 0 %
 * conviviendo con la general en el mismo catálogo.
 *
 * Cambiar una tasa NO la sobrescribe: `set_tax_rate` cierra la vigente y abre la
 * nueva, así que el histórico queda intacto y un pedido antiguo se puede
 * recalcular con la tasa que tenía ese día.
 */
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { Field } from '@/shared/ui/Field'
import {
  rateToPercent,
  useCreateTaxCategory,
  useTaxCategories,
  useUpdateTaxRate,
  type TaxCategory,
} from './taxes'

interface Props {
  organizationId: string | null
  companyId: string | null
  canManage: boolean
}

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/

/** Porcentaje válido: 0 a 100, hasta dos decimales. */
function parsePercent(raw: string): number | null {
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Number(value.toFixed(2))
}

export function TaxesSection({ organizationId, companyId, canManage }: Props) {
  const { t } = useI18n()
  const categories = useTaxCategories(canManage)
  const createCategory = useCreateTaxCategory(organizationId, companyId)
  const updateRate = useUpdateTaxRate()

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null)

  const [form, setForm] = useState({ name: '', code: '', rate: '', isDefault: false })

  const rows = categories.data ?? []
  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(rows)

  if (categories.isLoading) return <LoadingState />
  if (categories.isError) return <ErrorState description={t('taxes.loadError')} />


  function draftFor(row: TaxCategory): string {
    const draft = drafts[row.id]
    if (draft !== undefined) return draft
    const percent = rateToPercent(row.rate)
    return percent === null ? '' : String(percent)
  }

  const dirty = rows.filter((row) => {
    const draft = draftFor(row)
    const current = rateToPercent(row.rate)
    return draft !== (current === null ? '' : String(current))
  })

  async function saveRates() {
    setFeedback(null)
    try {
      for (const row of dirty) {
        const percent = parsePercent(draftFor(row))
        if (percent === null) {
          setFeedback('error')
          return
        }
        await updateRate.mutateAsync({ categoryId: row.id, ratePercent: percent })
      }
      setDrafts({})
      setFeedback('saved')
    } catch {
      setFeedback('error')
    }
  }

  async function submitNew() {
    const percent = parsePercent(form.rate)
    if (!form.name.trim() || !CODE_RE.test(form.code) || percent === null) {
      setFeedback('error')
      return
    }
    try {
      await createCategory.mutateAsync({
        name: form.name.trim(),
        code: form.code,
        isDefault: form.isDefault,
        ratePercent: percent,
      })
      setDialogOpen(false)
      setForm({ name: '', code: '', rate: '', isDefault: false })
      setFeedback('saved')
    } catch {
      setFeedback('error')
    }
  }

  const busy = createCategory.isPending || updateRate.isPending

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography sx={{ fontWeight: 700 }}>{t('taxes.title')}</Typography>
        <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('taxes.help')}</Typography>
      </Box>

      {feedback === 'saved' && <Alert severity="success">{t('taxes.saved')}</Alert>}
      {feedback === 'error' && <Alert severity="error">{t('taxes.error')}</Alert>}

      {rows.length === 0 ? (
        <EmptyState title={t('taxes.empty')} description={t('taxes.emptyHelp')} />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('taxes.name')}</TableCell>
              <TableCell>{t('taxes.code')}</TableCell>
              <TableCell align="right">{t('taxes.rate')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <span>{row.name}</span>
                    {row.is_default && <StatusChip label={t('taxes.default')} />}
                  </Stack>
                </TableCell>
                <TableCell sx={{ color: 'var(--muted)' }}>{row.code}</TableCell>
                <TableCell align="right">
                  <Field
                    size="small"
                    rule="percent"
                    value={draftFor(row)}
                    disabled={!canManage || busy}
                    inputProps={{
                      inputMode: 'decimal',
                      'aria-label': `${t('taxes.rate')} ${row.name}`,
                      style: { textAlign: 'right' },
                    }}
                    sx={{ maxWidth: 120 }}
                    onChange={(event) =>
                      setDrafts((prev) => ({ ...prev, [row.id]: event.target.value }))
                    }
                  />
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

      <Stack direction="row" spacing={1.5}>
        <Button variant="outlined" disabled={!canManage || busy} onClick={() => setDialogOpen(true)}>
          {t('taxes.new')}
        </Button>
        <Button
          variant="contained"
          disabled={!canManage || busy || dirty.length === 0}
          onClick={saveRates}
        >
          {t('taxes.save')}
        </Button>
      </Stack>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('taxes.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Field
              rule="text"
              maxLength={120}
              label={t('taxes.name')}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <Field
              rule="lowerCode"
              maxLength={41}
              help={t('help.admin.taxes.code')}
              label={t('taxes.code')}
              value={form.code}
              helperText={t('taxes.codeHelp')}
              inputProps={{ maxLength: 41, spellCheck: false }}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, code: event.target.value.toLowerCase() }))
              }
            />
            <Field
              rule="percent"
              help={t('help.admin.taxes.rate')}
              label={t('taxes.rate')}
              value={form.rate}
              inputProps={{ inputMode: 'decimal' }}
              onChange={(event) => setForm((prev) => ({ ...prev, rate: event.target.value }))}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.isDefault}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isDefault: event.target.checked }))
                  }
                />
              }
              label={t('taxes.makeDefault')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('taxes.cancel')}</Button>
          <Button variant="contained" disabled={busy} onClick={submitNew}>
            {t('taxes.create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
