import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { ApprovalRulesPanel } from './ApprovalRulesPanel'
import { AccountUsersPanel } from './AccountUsersPanel'
import { LocationsPanel } from './LocationsPanel'
import { CustomersError } from './errors'
import { useCustomerOptions, useSaveBusinessAccount } from './hooks'
import {
  accountFormSchema,
  accountToForm,
  toCustomerCode,
  type AccountFormValues,
  type BusinessAccount,
} from './types'
import type { TenantScope } from './api'

/**
 * Alta y edición de una cuenta B2B, por pestañas.
 *
 * General · Usuarios · Sucursales · Aprobaciones. Las tres últimas solo
 * aparecen cuando la cuenta YA existe: sin id no hay a qué colgarlas.
 *
 * El alta pide un CLIENTE de tipo empresa. No es una restricción de pantalla:
 * la base la impone con una FK compuesta contra `customers (id, kind)`, así que
 * una cuenta corporativa sobre una persona física es un estado imposible y no
 * un error que la UI recuerde evitar.
 */
export function BusinessAccountDrawer({
  open,
  account,
  canWrite,
  scope,
  onClose,
  onCreated,
}: {
  open: boolean
  account: BusinessAccount | null
  canWrite: boolean
  scope: TenantScope | null
  onClose: () => void
  /** Alta hecha: el cajón pasa a editar la cuenta (sedes, compradores…). */
  onCreated?: (account: BusinessAccount) => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [tab, setTab] = useState(0)
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  // El elegido se guarda entero: el desplegable tiene que seguir enseñando su
  // nombre aunque la siguiente búsqueda ya no lo traiga.
  const [clienteElegido, setClienteElegido] = useState<PickerOption | null>(null)

  const save = useSaveBusinessAccount()
  const customers = useCustomerOptions({
    term: customerSearch,
    kind: 'company',
    enabled: open && !account,
  })

  const opcionesCliente = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: accountToForm(account),
  })

  useEffect(() => {
    if (!open) return
    reset(accountToForm(account))
    setServerError(null)
    setCustomerId(account?.customer_id ?? '')
    setCustomerSearch('')
    setTab(0)
  }, [open, account, reset])

  const fieldError = (key: keyof AccountFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: AccountFormValues) {
    if (!scope) return
    if (!account && !customerId) {
      setServerError('customers.error.customerRequired')
      return
    }
    setServerError(null)
    try {
      const saved = await save.mutateAsync({
        id: account?.id ?? null,
        scope,
        customerId: account?.customer_id ?? customerId,
        values,
      })
      notify(t('customers.toast.saved'))
      if (account) onClose()
      else onCreated?.(saved)
    } catch (error) {
      setServerError(error instanceof CustomersError ? error.key : 'customers.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={account ? account.name : t('customers.accounts.new')}
      subtitle={account ? account.code : t('customers.accounts.newHint')}
      onClose={onClose}
      busy={isSubmitting}
      width={680}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {account ? t('common.close') : t('common.cancel')}
          </Button>
          {tab === 0 && (
            <Button
              type="submit"
              form="business-account-form"
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
        {account && (
          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            variant="fullWidth"
            aria-label={t('customers.accounts.tabs')}
            sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
          >
            <Tab label={t('catalog.tab.general')} />
            <Tab label={t('customers.tab.users')} />
            <Tab label={t('customers.tab.locations')} />
            <Tab label={t('customers.tab.approvals')} />
          </Tabs>
        )}

        {tab === 0 && (
          <Box component="form" id="business-account-form" onSubmit={handleSubmit(submit)} noValidate>
            <Stack spacing={2.5}>
              {serverError && <Alert severity="error">{t(serverError)}</Alert>}

              {/* Un solo control donde antes había dos: se escribía en el
                  buscador y se elegía en un desplegable de al lado, que es
                  pedir dos gestos para una sola decisión. */}
              {!account && (
                <EntityPicker
                  label={t('customers.field.customer')}
                  placeholder={t('customers.accounts.findCustomer')}
                  term={customerSearch}
                  onTermChange={setCustomerSearch}
                  options={opcionesCliente}
                  loading={customers.isFetching}
                  value={clienteElegido}
                  disabled={!canWrite}
                  helperText={t('customers.field.customerHint')}
                  onPick={(option) => {
                    setClienteElegido(option)
                    setCustomerId(option.id)
                    // La cuenta hereda nombre y código del cliente: se rellenan
                    // al elegir para no teclear dos veces lo mismo.
                    setValue('name', option.primary)
                    setValue('code', toCustomerCode(option.secondary ?? ''))
                  }}
                />
              )}

              <TextField
                label={t('customers.field.name')}
                fullWidth
                disabled={!canWrite}
                error={Boolean(errors.name)}
                helperText={fieldError('name')}
                {...register('name')}
              />

              <TextField
                label={t('customers.field.code')}
                fullWidth
                disabled={!canWrite || Boolean(account)}
                error={Boolean(errors.code)}
                helperText={fieldError('code') ?? t('customers.field.codeHint')}
                inputProps={{ spellCheck: false }}
                {...register('code')}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={watch('requires_approval')}
                    disabled={!canWrite}
                    onChange={(_, checked) => {
                      setValue('requires_approval', checked)
                      if (!checked) setValue('approval_threshold', '')
                    }}
                  />
                }
                label={t('customers.field.requiresApproval')}
              />

              <TextField
                label={t('customers.field.approvalThreshold')}
                fullWidth
                disabled={!canWrite || !watch('requires_approval')}
                error={Boolean(errors.approval_threshold)}
                helperText={fieldError('approval_threshold') ?? t('customers.field.thresholdHint')}
                inputProps={{ inputMode: 'decimal' }}
                {...register('approval_threshold')}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={watch('purchase_order_required')}
                    disabled={!canWrite}
                    onChange={(_, checked) => setValue('purchase_order_required', checked)}
                  />
                }
                label={t('customers.field.purchaseOrder')}
              />

              {/* La línea y el plazo van juntos: sin línea la cuenta compra al
                  contado y el plazo no significa nada (lo valida el esquema). */}
              <Stack spacing={1.5}>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{t('customers.credit.title')}</Typography>
                  <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('customers.credit.help')}</Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label={t('customers.field.creditLimit')}
                    fullWidth
                    disabled={!canWrite}
                    error={Boolean(errors.credit_limit)}
                    helperText={fieldError('credit_limit') ?? t('customers.field.creditLimitHint')}
                    inputProps={{ inputMode: 'decimal' }}
                    {...register('credit_limit', {
                      onChange: (event: { target: { value: string } }) => {
                        if (event.target.value.trim() === '') setValue('payment_terms_days', '')
                      },
                    })}
                  />
                  <TextField
                    label={t('customers.field.paymentTerms')}
                    fullWidth
                    disabled={!canWrite || watch('credit_limit').trim() === ''}
                    error={Boolean(errors.payment_terms_days)}
                    helperText={fieldError('payment_terms_days') ?? t('customers.field.paymentTermsHint')}
                    inputProps={{ inputMode: 'numeric' }}
                    {...register('payment_terms_days')}
                  />
                </Stack>
              </Stack>

              <TextField
                label={t('customers.field.notes')}
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
            </Stack>
          </Box>
        )}

        {tab === 1 && account && scope && (
          <AccountUsersPanel account={account} scope={scope} canWrite={canWrite} />
        )}

        {tab === 2 && account && scope && (
          <LocationsPanel account={account} scope={scope} canWrite={canWrite} />
        )}

        {tab === 3 && account && scope && (
          <ApprovalRulesPanel account={account} scope={scope} canWrite={canWrite} />
        )}
      </Stack>
    </FormDrawer>
  )
}
