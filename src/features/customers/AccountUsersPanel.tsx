import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import type { TenantScope } from './api'
import { CustomersError } from './errors'
import { useAccountUsers, useDeleteAccountUser, useLocations, useSaveAccountUser } from './hooks'
import {
  BUSINESS_ROLES,
  MEMBER_STATUSES,
  accountUserFormSchema,
  type AccountUserFormValues,
  type BusinessAccount,
  type BusinessAccountUser,
} from './types'

const EMPTY: AccountUserFormValues = {
  user_id: '',
  email: '',
  role: 'buyer',
  spending_limit: '',
  status: 'invited',
  default_location_id: '',
}

/**
 * Quién, de esta empresa, entra al portal.
 *
 * Esta tabla ES el vínculo del que habla la regla 8 de la fase: el acceso a una
 * cuenta se decide aquí, en el servidor, y nunca por un identificador que
 * mande el navegador. La función que el portal usa para leer su contexto
 * (`my_business_accounts`) no acepta ningún argumento justamente por eso.
 *
 * El rol se elige de cuatro fijos y el LÍMITE es lo configurable. Un rol cuyos
 * permisos fueran datos permitiría marcar «puede aprobar» sobre un comprador, y
 * eso destruye la separación de funciones para la que existen las reglas de
 * aprobación.
 */
export function AccountUsersPanel({
  account,
  scope,
  canWrite,
}: {
  account: BusinessAccount
  scope: TenantScope
  canWrite: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const users = useAccountUsers(account.id)
  const locations = useLocations(account.id)
  const save = useSaveAccountUser()
  const remove = useDeleteAccountUser()

  const [editing, setEditing] = useState<BusinessAccountUser | null>(null)
  const [values, setValues] = useState<AccountUserFormValues>(EMPTY)
  const [error, setError] = useState<MessageKey | null>(null)

  function set<K extends keyof AccountUserFormValues>(key: K, value: AccountUserFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function cancel() {
    setEditing(null)
    setValues(EMPTY)
    setError(null)
  }

  async function submit() {
    const parsed = accountUserFormSchema.safeParse(values)
    if (!parsed.success) {
      setError((parsed.error.issues[0]?.message as MessageKey) ?? 'customers.error.invalid')
      return
    }
    setError(null)
    try {
      await save.mutateAsync({
        id: editing?.id ?? null,
        scope,
        accountId: account.id,
        values: parsed.data,
      })
      notify(t('customers.toast.saved'))
      cancel()
    } catch (caught) {
      setError(caught instanceof CustomersError ? caught.key : 'customers.error.generic')
    }
  }

  const rows = users.data ?? []

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(rows)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.users.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label={t('customers.field.email')}
              value={values.email}
              onChange={(event) => set('email', event.target.value)}
            />
            {/* Aquí había un campo que pedía pegar «el identificador que emite
                el hub». El hub no está conectado y ese identificador no se
                enseña en ninguna pantalla: no había de dónde sacarlo, así que
                esta pantalla se abría y no se podía usar. El vínculo lo resuelve
                el servidor a partir del correo, que es lo que el texto de arriba
                ya prometía. */}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              select
              size="small"
              fullWidth
              label={t('customers.field.role')}
              value={values.role}
              onChange={(event) => set('role', event.target.value as AccountUserFormValues['role'])}
            >
              {BUSINESS_ROLES.map((role) => (
                <MenuItem key={role} value={role}>
                  {t(`customers.role.${role}`)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              fullWidth
              label={t('customers.field.spendingLimit')}
              value={values.spending_limit}
              onChange={(event) => set('spending_limit', event.target.value)}
              helperText={t('customers.field.spendingLimitHint')}
              inputProps={{ inputMode: 'decimal' }}
            />

            <TextField
              select
              size="small"
              fullWidth
              label={t('common.status')}
              value={values.status}
              onChange={(event) => set('status', event.target.value as AccountUserFormValues['status'])}
            >
              {MEMBER_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {t(`customers.status.${status}`)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              select
              size="small"
              fullWidth
              label={t('customers.field.defaultLocation')}
              value={values.default_location_id}
              onChange={(event) => set('default_location_id', event.target.value)}
            >
              <MenuItem value="">{t('customers.field.noLocation')}</MenuItem>
              {(locations.data ?? []).map((location) => (
                <MenuItem key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
              {editing ? t('common.save') : t('common.add')}
            </Button>
            {editing && <Button onClick={cancel}>{t('common.cancel')}</Button>}
          </Stack>
        </Stack>
      )}

      {!users.isPending && rows.length === 0 && <EmptyState title={t('customers.users.empty')} />}

      {rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('customers.field.email')}</TableCell>
              <TableCell>{t('customers.field.role')}</TableCell>
              <TableCell align="right">{t('customers.field.spendingLimit')}</TableCell>
              <TableCell>{t('common.status')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <StatusChip label={t(`customers.role.${user.role}`)} />
                </TableCell>
                <TableCell align="right" className="tnum">
                  {user.spending_limit ?? t('customers.field.noLimit')}
                </TableCell>
                <TableCell>
                  <StatusChip
                    tone={user.status === 'active' ? 'success' : 'default'}
                    label={t(`customers.status.${user.status}`)}
                  />
                </TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'edit',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${user.email}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => {
                          setEditing(user)
                          setValues({
                            user_id: user.user_id,
                            email: user.email,
                            role: user.role,
                            spending_limit: user.spending_limit ?? '',
                            status: user.status,
                            default_location_id: user.default_location_id ?? '',
                          })
                          setError(null)
                        },
                      },
                      {
                        id: 'delete',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('common.delete')}: ${user.email}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => {
                          void remove.mutateAsync(user.id).then(() => notify(t('customers.toast.deleted')))
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
