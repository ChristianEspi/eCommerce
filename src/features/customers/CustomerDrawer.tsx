import { useCopilotEntity } from '@/features/ai/copilot/copilot-context'
import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useAiFeature } from '@/features/ai/hooks'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { useSegments } from '@/features/pricing/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import { DocumentField } from '@/shared/ui/DocumentField'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import { AddressesPanel } from './AddressesPanel'
import { CustomerAiPanel } from './ai/CustomerAiPanel'
import { ContactsPanel } from './ContactsPanel'
import { ExternalIdsPanel } from './ExternalIdsPanel'
import { CustomersError } from './errors'
import { useAccountForCustomer, useCustomerOrders, useSaveCustomer } from './hooks'
import {
  CUSTOMER_KINDS,
  customerFormSchemaFor,
  defaultDocType,
  customerToForm,
  toCustomerCode,
  type Customer,
  type CustomerFormValues,
} from './types'
import type { TenantScope } from './api'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Ficha de cliente, por pestañas.
 *
 * General · Contactos · Direcciones · Identificadores · Pedidos. Cada pestaña
 * escribe en una tabla distinta y se guarda por separado: juntarlas obligaría a
 * inventar una transacción en el cliente, que es la misma decisión que tomaron
 * el cajón de producto del PIM y el de lista de precio.
 *
 * Las pestañas de detalle solo aparecen cuando el cliente YA existe: sin id no
 * hay a qué colgarlas, y una pestaña que solo dice «guarda primero» sobra.
 *
 * La cuenta B2B **no** se edita aquí. Se enseña si la hay —para que la ficha no
 * mienta por omisión— y se administra en su propia pestaña de la pantalla, que
 * es la que está gateada por el módulo contratado.
 */
export function CustomerDrawer({
  open,
  customer,
  canWrite,
  scope,
  onClose,
  onCreated,
}: {
  open: boolean
  customer: Customer | null
  canWrite: boolean
  scope: TenantScope | null
  onClose: () => void
  /** Alta hecha: el cajón pasa a editar la ficha (contactos, direcciones…). */
  onCreated?: (customerId: string) => void
}) {
  const { t, locale } = useI18n()
  // El Copilot sabe qué cliente está abierto (tipo + id; la RLS decide).
  useCopilotEntity('customer', open ? customer?.id : null)
  const { notify } = useFeedback()
  const { has } = useCapabilities()
  const [tab, setTab] = useState(0)
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [codeEdited, setCodeEdited] = useState(false)

  const segments = useSegments()
  const save = useSaveCustomer()
  const account = useAccountForCustomer(customer?.id ?? null, has('customers.b2b'))
  const orders = useCustomerOrders(customer?.id ?? null, tab === 4)
  // Resumen IA (fase 06): la pestaña solo existe para los roles de la
  // funcionalidad `customers`; la cartera y el crédito los filtra la base.
  const { availability: aiAvailability } = useAiFeature('customers')
  const showAi = aiAvailability !== 'forbidden' && aiAvailability !== 'loading'

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchemaFor(customer)),
    defaultValues: customerToForm(customer),
  })
  // Persona y empresa no piden lo mismo: cambian etiquetas y la razón social.
  const isPerson = watch('kind') === 'person'

  useEffect(() => {
    if (!open) return
    reset(customerToForm(customer))
    setCodeEdited(Boolean(customer))
    setServerError(null)
    setTab(0)
  }, [open, customer, reset])

  const fieldError = (key: keyof CustomerFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: CustomerFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      const savedId = await save.mutateAsync({ id: customer?.id ?? null, scope, values })
      notify(t('customers.toast.saved'))
      if (customer) onClose()
      else onCreated?.(savedId)
    } catch (error) {
      setServerError(error instanceof CustomersError ? error.key : 'customers.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={customer ? customer.name : t('customers.new')}
      subtitle={customer ? customer.code : t('customers.newHint')}
      onClose={onClose}
      busy={isSubmitting}
      width={680}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {customer ? t('common.close') : t('common.cancel')}
          </Button>
          {tab === 0 && (
            <Button
              type="submit"
              form="customer-form"
              variant="contained"
              disabled={isSubmitting || !canWrite}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <Stack spacing={2}>
        {customer && (
          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            variant="scrollable"
            allowScrollButtonsMobile
            aria-label={t('customers.tabs')}
            sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
          >
            <Tab label={t('catalog.tab.general')} />
            <Tab label={t('customers.tab.contacts')} />
            <Tab label={t('customers.tab.addresses')} />
            <Tab label={t('customers.tab.externalIds')} />
            <Tab label={t('customers.tab.orders')} />
            {showAi && <Tab label={t('aiCustomers.tab')} />}
          </Tabs>
        )}

        {tab === 0 && (
          <Box component="form" id="customer-form" onSubmit={handleSubmit(submit)} noValidate>
            <Stack spacing={2.5}>
              {serverError && <Alert severity="error">{t(serverError)}</Alert>}

              <SelectField
                label={t('customers.field.kind')}
                fullWidth
                disabled={!canWrite || Boolean(customer)}
                value={watch('kind')}
                onChange={(event) => {
                  const next = event.target.value as CustomerFormValues['kind']
                  setValue('kind', next)
                  // Una persona no tiene razón social: si se escribió como
                  // empresa y luego se cambió, no se guarda a escondidas.
                  if (next === 'person') setValue('legal_name', '')
                  // Sin número escrito, el tipo propuesto sigue al tipo de cliente.
                  if (!watch('tax_id')) setValue('tax_id_type', defaultDocType(next))
                }}
                helperText={t('customers.field.kindHint')}
              >
                {CUSTOMER_KINDS.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {t(`customers.kind.${kind}`)}
                  </MenuItem>
                ))}
              </SelectField>

              <Field
                label={t(isPerson ? 'customers.field.personName' : 'customers.field.name')}
                rule={isPerson ? 'personName' : 'text'}
                maxLength={200}
                fullWidth
                autoFocus
                disabled={!canWrite}
                error={Boolean(errors.name)}
                helperText={fieldError('name')}
                {...register('name', {
                  onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    if (!codeEdited) setValue('code', toCustomerCode(event.target.value))
                  },
                })}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Field
                  label={t('customers.field.code')}
                  rule="code"
                  maxLength={41}
                  help={t('help.customers.code')}
                  fullWidth
                  disabled={!canWrite}
                  error={Boolean(errors.code)}
                  helperText={fieldError('code') ?? t('customers.field.codeHint')}
                  inputProps={{ spellCheck: false }}
                  {...register('code', { onChange: () => setCodeEdited(true) })}
                />
              </Stack>

              {/* Tipo + número: el número sigue al tipo (RUC 11 dígitos, DNI 8…). */}
              <DocumentField
                docType={watch('tax_id_type')}
                onDocTypeChange={(type) =>
                  setValue('tax_id_type', type, { shouldValidate: Boolean(watch('tax_id')) })
                }
                disabled={!canWrite}
                typeError={fieldError('tax_id_type')}
                numberProps={{
                  label: t(isPerson ? 'customers.field.personDoc' : 'customers.field.taxId'),
                  error: Boolean(errors.tax_id),
                  helperText: fieldError('tax_id'),
                  ...register('tax_id'),
                }}
              />

              {/* La razón social es de empresa. En una persona el nombre ya es
                  el legal: pedirla duplica el dato y confunde. */}
              {!isPerson && (
                <Field
                  label={t('customers.field.legalName')}
                  rule="text"
                  maxLength={200}
                  fullWidth
                  disabled={!canWrite}
                  error={Boolean(errors.legal_name)}
                  helperText={fieldError('legal_name') ?? t('customers.field.legalNameHint')}
                  {...register('legal_name')}
                />
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Field
                  label={t('customers.field.email')}
                  type="email"
                  rule="email"
                  maxLength={160}
                  fullWidth
                  disabled={!canWrite}
                  error={Boolean(errors.email)}
                  helperText={fieldError('email')}
                  {...register('email')}
                />
                <Field
                  label={t('customers.field.phone')}
                  rule="phone"
                  fullWidth
                  disabled={!canWrite}
                  error={Boolean(errors.phone)}
                  helperText={fieldError('phone')}
                  {...register('phone')}
                />
              </Stack>

              <SelectField
                label={t('customers.field.segment')}
                fullWidth
                disabled={!canWrite}
                value={watch('segment_id')}
                onChange={(event) => setValue('segment_id', event.target.value)}
                helperText={t('customers.field.segmentHint')}
              >
                <MenuItem value="">{t('customers.field.noSegment')}</MenuItem>
                {(segments.data ?? []).map((segment) => (
                  <MenuItem key={segment.id} value={segment.id}>
                    {segment.name}
                  </MenuItem>
                ))}
              </SelectField>

              <Field
                label={t('customers.field.notes')}
                rule="longText"
                fullWidth
                multiline
                minRows={2}
                disabled={!canWrite}
                error={Boolean(errors.notes)}
                helperText={fieldError('notes')}
                {...register('notes')}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={watch('is_active')}
                    disabled={!canWrite}
                    onChange={(_, checked) => setValue('is_active', checked)}
                  />
                }
                label={t('customers.field.active')}
              />

              {customer && account.data && (
                <Alert severity="info" icon={false}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <StatusChip tone="success" label={t('customers.account.linked')} />
                    <Typography sx={{ fontSize: 13 }}>
                      {account.data.name} · {account.data.code}
                    </Typography>
                  </Stack>
                </Alert>
              )}
            </Stack>
          </Box>
        )}

        {tab === 1 && customer && scope && (
          <ContactsPanel customerId={customer.id} scope={scope} canWrite={canWrite} />
        )}

        {tab === 2 && customer && scope && (
          <AddressesPanel customerId={customer.id} scope={scope} canWrite={canWrite} />
        )}

        {tab === 3 && customer && scope && (
          <ExternalIdsPanel customerId={customer.id} scope={scope} canWrite={canWrite} />
        )}

        {tab === 5 && customer && showAi && <CustomerAiPanel customerId={customer.id} />}

        {tab === 4 && customer && (
          <Stack spacing={2}>
            {/* La heurística se declara en la pantalla, no solo en el SQL: quien
                mira esta tabla tiene que saber que el enlace es el correo y no
                una identidad, porque de eso depende cómo la interprete. */}
            <Typography sx={{ color: 'var(--muted)' }}>{t('customers.orders.help')}</Typography>
            {!orders.isPending && (orders.data ?? []).length === 0 && (
              <EmptyState title={t('customers.orders.empty')} />
            )}
            {(orders.data ?? []).length > 0 && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('customers.orders.number')}</TableCell>
                    <TableCell>{t('common.date')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('common.total')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(orders.data ?? []).map((order) => (
                    <TableRow key={order.order_id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{order.order_number}</TableCell>
                      <TableCell>{new Date(order.placed_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <StatusChip label={t(`orders.status.${order.status}`)} />
                      </TableCell>
                      <TableCell align="right" className="tnum">
                        {formatMoney(Number(order.grand_total), order.currency, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>
        )}
      </Stack>
    </FormDrawer>
  )
}
