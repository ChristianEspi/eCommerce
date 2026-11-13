import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded'
import {
  Alert,
  Button,
  Card,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { ConfirmDeleteDialog } from '@/shared/ui/ConfirmDeleteDialog'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { PROVIDERS_WITH_KEYS } from './api'
import { PaymentsError } from './errors'
import {
  useDeletePaymentMethod,
  usePaymentMethods,
  usePaymentProviders,
  useSavePaymentMethod,
} from './hooks'
import {
  PAYMENT_METHOD_KINDS,
  type PaymentMethod,
  type PaymentMethodFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

const EMPTY: PaymentMethodFormValues = {
  code: '',
  displayName: '',
  kind: 'card',
  providerCode: '',
  captureMode: 'automatic',
  isActive: false,
  position: 100,
  instructions: '',
  publicKey: '',
  secretKey: '',
  clearSecret: false,
}

function toForm(method: PaymentMethod): PaymentMethodFormValues {
  return {
    id: method.id,
    code: method.code,
    displayName: method.display_name,
    kind: method.kind,
    providerCode: method.provider_code ?? '',
    captureMode: method.capture_mode,
    isActive: method.is_active,
    position: method.position,
    instructions: method.instructions ?? '',
    publicKey: method.checkout_public_key ?? '',
    // La secreta NUNCA se rellena: no se lee de la base. Vacía = no se toca.
    secretKey: '',
    clearSecret: false,
  }
}

/** `test` o `live` según el prefijo de una llave de Culqi (pk_/sk_). */
function entornoDe(llave: string | null | undefined): 'test' | 'live' | null {
  const m = /^(?:pk|sk)_(test|live)_/.exec((llave ?? '').trim())
  return m ? (m[1] as 'test' | 'live') : null
}

/**
 * Los medios de pago del tenant: qué puede elegir el comprador.
 *
 * Es la ÚNICA tabla del dominio de pagos que se escribe desde aquí, y no es
 * casualidad: es configuración, no dinero. Los cobros, las devoluciones y la
 * conciliación se leen y se mueven con comandos.
 *
 * Dos cosas que la pantalla hace cumplir porque la base también las exige, y
 * que conviene ver antes de guardar y no en el error:
 *
 *  · **Sin pasarela, la captura es manual.** Una transferencia la confirma una
 *    persona cuando ve el dinero. El selector se bloquea solo.
 *  · **Un medio nace apagado.** Publicar un medio de pago es una decisión, no
 *    el efecto secundario de crearlo.
 *
 * ## Las llaves de la pasarela (Culqi), y dónde vive cada una
 *
 * Con una pasarela que cobra en la cuenta DEL COMERCIO (Culqi), el medio pide
 * sus llaves aquí, en el mismo cajón donde se elige la pasarela:
 *
 *  · la **pública** (`pk_…`) se guarda con el medio: la usa la vitrina.
 *  · la **secreta** (`sk_…`) se escribe UNA vez y va a Vault por
 *    `payment_method_set_secret`. Esta pantalla nunca la lee: solo sabe si
 *    existe y su pista (`sk_live_…a1b2`) para reconocerla.
 *
 * El campo de la secreta empieza vacío siempre; vacío al guardar = no se toca.
 */
export function MethodsSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore, can } = useTenant()
  const canWrite = can('tenant.manage')

  const [drawer, setDrawer] = useState<{ open: boolean; method: PaymentMethod | null }>({
    open: false,
    method: null,
  })
  const [values, setValues] = useState<PaymentMethodFormValues>(EMPTY)

  const methods = usePaymentMethods(activeStore?.id ?? null)
  const providers = usePaymentProviders()
  const save = useSavePaymentMethod(
    tenant && activeCompanyId && activeStore
      ? {
          organizationId: tenant.organization_id,
          companyId: activeCompanyId,
          storeId: activeStore.id,
        }
      : null,
  )
  const remove = useDeletePaymentMethod()

  // Borrar un medio de pago pide confirmación: antes se borraba al primer clic,
  // y el botón estaba pegado al de editar.
  const [deleting, setDeleting] = useState<PaymentMethod | null>(null)

  useEffect(() => {
    if (!drawer.open) return
    setValues(drawer.method ? toForm(drawer.method) : EMPTY)
  }, [drawer])

  const offline = values.providerCode === ''
  const conLlaves = PROVIDERS_WITH_KEYS.has(values.providerCode)
  // Solo cuenta la secreta guardada si sigue siendo de la MISMA pasarela: al
  // cambiar de pasarela la base la borra.
  const secretaGuardada =
    Boolean(drawer.method?.has_secret) &&
    drawer.method?.provider_code === values.providerCode &&
    !values.clearSecret
  const entornoPublica = entornoDe(values.publicKey)
  const entornoSecreta =
    entornoDe(values.secretKey) ?? (secretaGuardada ? entornoDe(drawer.method?.secret_hint) : null)
  const entorno = entornoPublica ?? entornoSecreta
  const mezcla = entornoPublica !== null && entornoSecreta !== null && entornoPublica !== entornoSecreta
  const list = methods.data ?? []
  const isEmpty = !methods.isPending && !methods.isError && list.length === 0

  function report(error: unknown) {
    const key: MessageKey =
      error instanceof PaymentsError ? error.key : 'payments.error.generic'
    notify(t(key), 'error')
  }

  async function submit() {
    try {
      await save.mutateAsync(values)
      notify(t('payments.methods.saved'), 'success')
      setDrawer({ open: false, method: null })
    } catch (error) {
      report(error)
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('payments.methods.help')}</Typography>

      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="contained"
          disabled={!canWrite || !activeStore}
          onClick={() => setDrawer({ open: true, method: null })}
        >
          {t('payments.methods.new')}
        </Button>
      </Stack>

      <Card>
        {methods.isPending && <TableSkeleton columns={5} />}
        {methods.isError && (
          <ErrorState error={methods.error} onRetry={() => void methods.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={t('payments.methods.empty')}
            description={t('payments.methods.emptyBody')}
            icon={<CreditCardRoundedIcon fontSize="small" />}
          />
        )}
        {!methods.isPending && !methods.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('payments.field.code')}</TableCell>
                <TableCell>{t('payments.field.methodName')}</TableCell>
                <TableCell>{t('payments.field.provider')}</TableCell>
                <TableCell>{t('payments.field.captureMode')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((method) => (
                <TableRow key={method.id} hover>
                  <TableCell>{method.code}</TableCell>
                  <TableCell>{method.display_name}</TableCell>
                  <TableCell>
                    {method.provider_code ?? (
                      <StatusChip label={t('payments.method.offline')} />
                    )}
                  </TableCell>
                  <TableCell>{t(`payments.capture.${method.capture_mode}` as MessageKey)}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={method.is_active ? 'success' : 'default'}
                      label={t(method.is_active ? 'payments.state.active' : 'payments.state.inactive')}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          // Con el nombre: cinco «Editar» iguales no se distinguen
                          // con lector de pantalla.
                          label: `${t('common.edit')}: ${method.display_name}`,
                          tone: 'neutral',
                          disabled: !canWrite,
                          onClick: () => setDrawer({ open: true, method }),
                        },
                        {
                          id: '1',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: `${t('common.delete')}: ${method.display_name}`,
                          tone: 'danger',
                          disabled: !canWrite,
                          onClick: () => setDeleting(method),
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
      </Card>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={t('payments.methods.deleteTitle')}
        entityName={deleting?.display_name ?? ''}
        usage={[]}
        isLoadingUsage={false}
        // Lo recomendable es ocultarlo: deja de ofrecerse y no se pierde nada.
        safeActionLabel={deleting?.is_active ? t('payments.methods.hideInstead') : undefined}
        safeActionHint={deleting?.is_active ? t('payments.methods.hideHint') : undefined}
        onSafeAction={async () => {
          if (!deleting) return
          try {
            await save.mutateAsync({ ...toForm(deleting), isActive: false })
            notify(t('payments.methods.saved'), 'success')
            setDeleting(null)
          } catch (error) {
            report(error)
          }
        }}
        onDelete={async () => {
          if (!deleting) return
          try {
            await remove.mutateAsync(deleting.id)
            notify(t('payments.methods.deleted'), 'success')
            setDeleting(null)
          } catch (error) {
            report(error)
          }
        }}
        onClose={() => setDeleting(null)}
        isBusy={remove.isPending || save.isPending}
      />

      <FormDrawer
        open={drawer.open}
        title={drawer.method ? t('payments.methods.edit') : t('payments.methods.new')}
        subtitle={activeStore?.name}
        busy={save.isPending}
        onClose={() => setDrawer({ open: false, method: null })}
        actions={
          <>
            <Button onClick={() => setDrawer({ open: false, method: null })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={save.isPending || (conLlaves && mezcla)}
              onClick={() => void submit()}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <TextField
            label={t('payments.field.code')}
            value={values.code}
            disabled={Boolean(values.id)}
            onChange={(event) => setValues((v) => ({ ...v, code: event.target.value }))}
            helperText={t('payments.field.codeHelp')}
          />
          <TextField
            label={t('payments.field.methodName')}
            value={values.displayName}
            onChange={(event) => setValues((v) => ({ ...v, displayName: event.target.value }))}
          />
          <SelectField
            label={t('payments.field.kind')}
            value={values.kind}
            onChange={(event) =>
              setValues((v) => ({ ...v, kind: event.target.value as typeof v.kind }))
            }
          >
            {PAYMENT_METHOD_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {t(`payments.kind.${kind}` as MessageKey)}
              </MenuItem>
            ))}
          </SelectField>
          <SelectField
            label={t('payments.field.provider')}
            value={values.providerCode}
            onChange={(event) => setValues((v) => ({ ...v, providerCode: event.target.value }))}
            helperText={t('payments.field.providerHelp')}
          >
            <MenuItem value="">{t('payments.method.offline')}</MenuItem>
            {(providers.data ?? []).map((provider) => (
              <MenuItem key={provider.code} value={provider.code}>
                {provider.name}
              </MenuItem>
            ))}
          </SelectField>
          <SelectField
            label={t('payments.field.captureMode')}
            value={offline ? 'manual' : values.captureMode}
            disabled={offline}
            onChange={(event) =>
              setValues((v) => ({
                ...v,
                captureMode: event.target.value as typeof v.captureMode,
              }))
            }
          >
            <MenuItem value="automatic">{t('payments.capture.automatic')}</MenuItem>
            <MenuItem value="manual">{t('payments.capture.manual')}</MenuItem>
          </SelectField>
          {offline && <Alert severity="info">{t('payments.field.offlineHelp')}</Alert>}
          {conLlaves && (
            <Stack
              spacing={1.5}
              component="section"
              aria-label={t('payments.culqi.title')}
              sx={{ p: 2, border: '1px solid var(--border)', borderRadius: 2 }}
            >
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontWeight: 800 }}>{t('payments.culqi.title')}</Typography>
                <StatusChip
                  tone={entorno === 'live' ? 'success' : entorno === 'test' ? 'warning' : 'default'}
                  label={t(`payments.culqi.env.${entorno ?? 'none'}` as MessageKey)}
                />
              </Stack>
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                {t('payments.culqi.help')}
              </Typography>
              <TextField
                label={t('payments.culqi.publicKey')}
                value={values.publicKey}
                onChange={(event) => setValues((v) => ({ ...v, publicKey: event.target.value }))}
                helperText={t('payments.culqi.publicKeyHelp')}
                autoComplete="off"
                inputProps={{ spellCheck: false }}
              />
              {secretaGuardada ? (
                <Alert severity="success">
                  {t('payments.culqi.secretSaved').replace('{hint}', drawer.method?.secret_hint ?? '')}
                </Alert>
              ) : (
                values.secretKey.trim() === '' && (
                  <Alert severity="warning">{t('payments.culqi.secretMissing')}</Alert>
                )
              )}
              <TextField
                label={t('payments.culqi.secretKey')}
                type="password"
                value={values.secretKey}
                disabled={values.clearSecret}
                onChange={(event) => setValues((v) => ({ ...v, secretKey: event.target.value }))}
                helperText={
                  secretaGuardada ? t('payments.culqi.secretReplace') : t('payments.culqi.secretKeyHelp')
                }
                // `new-password`: que el navegador no ofrezca autocompletar una
                // contraseña guardada en el campo de una llave de cobro.
                autoComplete="new-password"
                inputProps={{ spellCheck: false }}
              />
              {Boolean(drawer.method?.has_secret) && drawer.method?.provider_code === values.providerCode && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={values.clearSecret}
                      onChange={(event) =>
                        setValues((v) => ({ ...v, clearSecret: event.target.checked, secretKey: '' }))
                      }
                    />
                  }
                  label={t('payments.culqi.clearSecret')}
                />
              )}
              {mezcla && <Alert severity="error">{t('payments.culqi.mismatch')}</Alert>}
            </Stack>
          )}
          <TextField
            label={t('payments.field.instructions')}
            value={values.instructions}
            multiline
            minRows={2}
            onChange={(event) => setValues((v) => ({ ...v, instructions: event.target.value }))}
            helperText={t('payments.field.instructionsHelp')}
          />
          <TextField
            label={t('payments.field.position')}
            type="number"
            value={values.position}
            onChange={(event) =>
              setValues((v) => ({ ...v, position: Number(event.target.value) || 0 }))
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={values.isActive}
                onChange={(event) => setValues((v) => ({ ...v, isActive: event.target.checked }))}
              />
            }
            label={t('payments.field.active')}
          />
        </Stack>
      </FormDrawer>
    </Stack>
  )
}
