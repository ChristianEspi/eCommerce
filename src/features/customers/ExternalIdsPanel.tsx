import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import type { TenantScope } from './api'
import { CustomersError } from './errors'
import { useDeleteExternalId, useExternalIds, useSaveExternalId } from './hooks'
import { externalIdFormSchema, type CustomerExternalId, type ExternalIdFormValues } from './types'

const EMPTY: ExternalIdFormValues = { system_code: '', external_id: '', notes: '' }

/**
 * Cómo se llama este cliente en los sistemas de al lado.
 *
 * Es un ATRIBUTO, nunca una clave: el código del ERP no es único entre
 * sistemas, cambia cuando el cliente migra de versión y no existe para el que
 * se dio de alta ayer en la tienda. La ficha se identifica por su uuid; esto es
 * lo que permite conciliar sin atar el modelo a ningún proveedor.
 *
 * El cambio lo reserva la base a `owner`/`admin`: cambiar el código con el que
 * este cliente existe en el ERP redirige documentos a otra ficha.
 */
export function ExternalIdsPanel({
  customerId,
  scope,
  canWrite,
}: {
  customerId: string
  scope: TenantScope
  canWrite: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const externalIds = useExternalIds(customerId)
  const save = useSaveExternalId()
  const remove = useDeleteExternalId()

  const [editing, setEditing] = useState<CustomerExternalId | null>(null)
  const [values, setValues] = useState<ExternalIdFormValues>(EMPTY)
  const [error, setError] = useState<MessageKey | null>(null)

  function set<K extends keyof ExternalIdFormValues>(key: K, value: ExternalIdFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function cancel() {
    setEditing(null)
    setValues(EMPTY)
    setError(null)
  }

  async function submit() {
    const parsed = externalIdFormSchema.safeParse(values)
    if (!parsed.success) {
      setError((parsed.error.issues[0]?.message as MessageKey) ?? 'customers.error.invalid')
      return
    }
    setError(null)
    try {
      await save.mutateAsync({ id: editing?.id ?? null, scope, customerId, values: parsed.data })
      notify(t('customers.toast.saved'))
      cancel()
    } catch (caught) {
      setError(caught instanceof CustomersError ? caught.key : 'customers.error.generic')
    }
  }

  const rows = externalIds.data ?? []

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(rows)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.externalIds.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Field
              size="small"
              fullWidth
              rule="lowerCode"
              maxLength={41}
              help={t('help.customers.systemCode')}
              label={t('customers.field.systemCode')}
              value={values.system_code}
              onChange={(event) => set('system_code', event.target.value)}
              helperText={t('customers.field.systemCodeHint')}
              inputProps={{ spellCheck: false }}
            />
            <Field
              size="small"
              fullWidth
              rule="text"
              maxLength={120}
              help={t('help.customers.externalId')}
              label={t('customers.field.externalId')}
              value={values.external_id}
              onChange={(event) => set('external_id', event.target.value)}
              inputProps={{ spellCheck: false }}
            />
            <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
              {editing ? t('common.save') : t('common.add')}
            </Button>
            {editing && <Button onClick={cancel}>{t('common.cancel')}</Button>}
          </Stack>
        </Stack>
      )}

      {!externalIds.isPending && rows.length === 0 && (
        <EmptyState title={t('customers.externalIds.empty')} />
      )}

      {rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('customers.field.systemCode')}</TableCell>
              <TableCell>{t('customers.field.externalId')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>{row.system_code}</TableCell>
                <TableCell>{row.external_id}</TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'edit',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${row.system_code}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => {
                          setEditing(row)
                          setValues({
                            system_code: row.system_code,
                            external_id: row.external_id,
                            notes: row.notes ?? '',
                          })
                          setError(null)
                        },
                      },
                      {
                        id: 'delete',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('common.delete')}: ${row.system_code}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => {
                          void remove.mutateAsync(row.id).then(() => notify(t('customers.toast.deleted')))
                        },
                      },
                    ]}
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
    </Stack>
  )
}
