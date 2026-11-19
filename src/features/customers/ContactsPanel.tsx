import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
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
import { Field } from '@/shared/ui/Field'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import type { TenantScope } from './api'
import { CustomersError } from './errors'
import { useContacts, useDeleteContact, useSaveContact } from './hooks'
import { contactFormSchema, type ContactFormValues, type CustomerContact } from './types'

const EMPTY: ContactFormValues = {
  name: '',
  email: '',
  phone: '',
  role_title: '',
  is_primary: false,
  is_active: true,
}

/**
 * Personas del cliente.
 *
 * Un contacto NO es un usuario: no tiene sesión, no compra y no aparece en
 * ninguna cuenta B2B. Es un nombre y una forma de localizarlo — y por eso el
 * formulario exige correo o teléfono: un contacto al que no se puede contactar
 * es una fila que alguien tendrá que interpretar dentro de un año.
 */
export function ContactsPanel({
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
  const contacts = useContacts(customerId)
  const save = useSaveContact()
  const remove = useDeleteContact()

  const [editing, setEditing] = useState<CustomerContact | null>(null)
  const [values, setValues] = useState<ContactFormValues>(EMPTY)
  const [error, setError] = useState<MessageKey | null>(null)

  function set<K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function startEdit(contact: CustomerContact) {
    setEditing(contact)
    setValues({
      name: contact.name,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      role_title: contact.role_title ?? '',
      is_primary: contact.is_primary,
      is_active: contact.is_active,
    })
    setError(null)
  }

  function cancel() {
    setEditing(null)
    setValues(EMPTY)
    setError(null)
  }

  async function submit() {
    const parsed = contactFormSchema.safeParse(values)
    if (!parsed.success) {
      setError((parsed.error.issues[0]?.message as MessageKey) ?? 'customers.error.invalid')
      return
    }
    setError(null)
    try {
      await save.mutateAsync({
        id: editing?.id ?? null,
        scope,
        customerId,
        values: parsed.data,
      })
      notify(t('customers.toast.saved'))
      cancel()
    } catch (caught) {
      setError(caught instanceof CustomersError ? caught.key : 'customers.error.generic')
    }
  }

  const rows = contacts.data ?? []

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(rows)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.contacts.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Field
              size="small"
              fullWidth
              rule="personName"
              label={t('customers.field.name')}
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
            />
            <Field
              size="small"
              fullWidth
              type="email"
              rule="email"
              maxLength={160}
              label={t('customers.field.email')}
              value={values.email}
              onChange={(event) => set('email', event.target.value)}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Field
              size="small"
              fullWidth
              rule="phone"
              label={t('customers.field.phone')}
              value={values.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
            <Field
              size="small"
              fullWidth
              rule="text"
              maxLength={80}
              label={t('customers.field.roleTitle')}
              value={values.role_title}
              onChange={(event) => set('role_title', event.target.value)}
            />
          </Stack>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={values.is_primary}
                  onChange={(_, checked) => set('is_primary', checked)}
                />
              }
              label={t('customers.field.primary')}
            />
            <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
              {editing ? t('common.save') : t('common.add')}
            </Button>
            {editing && <Button onClick={cancel}>{t('common.cancel')}</Button>}
          </Stack>
        </Stack>
      )}

      {!contacts.isPending && rows.length === 0 && (
        <EmptyState title={t('customers.contacts.empty')} />
      )}

      {rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('customers.field.name')}</TableCell>
              <TableCell>{t('customers.field.email')}</TableCell>
              <TableCell>{t('customers.field.phone')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((contact) => (
              <TableRow key={contact.id} hover>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <span>{contact.name}</span>
                    {contact.is_primary && (
                      <StatusChip tone="success" label={t('customers.field.primary')} />
                    )}
                  </Stack>
                  {contact.role_title && (
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {contact.role_title}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{contact.email ?? '—'}</TableCell>
                <TableCell>{contact.phone ?? '—'}</TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'edit',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${contact.name}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => startEdit(contact),
                      },
                      {
                        id: 'delete',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('common.delete')}: ${contact.name}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => {
                          void remove
                            .mutateAsync(contact.id)
                            .then(() => notify(t('customers.toast.deleted')))
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
