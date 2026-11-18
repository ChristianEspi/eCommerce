import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
  Divider,
  MenuItem,
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
import {
  useApprovalRules,
  useCheckApproval,
  useDeleteApprovalRule,
  useSaveApprovalRule,
} from './hooks'
import {
  BUSINESS_ROLES,
  approvalRuleFormSchema,
  type ApprovalDecision,
  type ApprovalRule,
  type ApprovalRuleFormValues,
  type BusinessAccount,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

const EMPTY: ApprovalRuleFormValues = {
  name: '',
  min_amount: '',
  approver_role: 'approver',
  is_active: true,
}

const REASON_LABEL: Record<string, MessageKey> = {
  user_limit: 'customers.approval.reason.userLimit',
  rule: 'customers.approval.reason.rule',
  account_threshold: 'customers.approval.reason.threshold',
}

/**
 * Reglas de autorización por monto — el FUNDAMENTO, no el flujo.
 *
 * Una fila dice «a partir de este importe tiene que aprobarlo alguien con este
 * rol». Gana la de mayor umbral alcanzado, igual que una escala de precio: de
 * 0, 500 y 5000, un pedido de 800 cae en la de 500. Dos reglas con el mismo
 * umbral las rechaza la base, porque el ganador dependería del orden de las
 * filas.
 *
 * **El comprobador llama a la MISMA función que va a decidir de verdad**
 * (`purchase_approval`). Es la decisión del simulador de precios de P04 y por
 * la misma razón: una segunda evaluación en el navegador diría una cosa y el
 * servidor otra, y esto se abre precisamente cuando alguien duda.
 */
export function ApprovalRulesPanel({
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
  const rules = useApprovalRules(account.id)
  const save = useSaveApprovalRule()
  const remove = useDeleteApprovalRule()
  const check = useCheckApproval()

  const [editing, setEditing] = useState<ApprovalRule | null>(null)
  const [values, setValues] = useState<ApprovalRuleFormValues>(EMPTY)
  const [error, setError] = useState<MessageKey | null>(null)
  const [amount, setAmount] = useState('')
  const [decision, setDecision] = useState<ApprovalDecision | null>(null)

  function set<K extends keyof ApprovalRuleFormValues>(key: K, value: ApprovalRuleFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function cancel() {
    setEditing(null)
    setValues(EMPTY)
    setError(null)
  }

  async function submit() {
    const parsed = approvalRuleFormSchema.safeParse(values)
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

  async function simulate() {
    setDecision(null)
    try {
      setDecision(await check.mutateAsync({ accountId: account.id, amount: amount || '0' }))
    } catch (caught) {
      setError(caught instanceof CustomersError ? caught.key : 'customers.error.generic')
    }
  }

  const rows = rules.data ?? []

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(rows)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.approvals.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Field
              size="small"
              fullWidth
              rule="text"
              maxLength={120}
              label={t('customers.field.ruleName')}
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
            />
            <Field
              size="small"
              fullWidth
              rule="money"
              help={t('help.customers.ruleMinAmount')}
              label={t('customers.field.minAmount')}
              value={values.min_amount}
              onChange={(event) => set('min_amount', event.target.value)}
            />
            <SelectField
              size="small"
              fullWidth
              label={t('customers.field.approverRole')}
              value={values.approver_role}
              onChange={(event) =>
                set('approver_role', event.target.value as ApprovalRuleFormValues['approver_role'])
              }
            >
              {BUSINESS_ROLES.filter((role) => role !== 'viewer').map((role) => (
                <MenuItem key={role} value={role}>
                  {t(`customers.role.${role}`)}
                </MenuItem>
              ))}
            </SelectField>
            <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
              {editing ? t('common.save') : t('common.add')}
            </Button>
            {editing && <Button onClick={cancel}>{t('common.cancel')}</Button>}
          </Stack>
        </Stack>
      )}

      {!rules.isPending && rows.length === 0 && (
        <EmptyState
          title={t('customers.approvals.empty')}
          description={t('customers.approvals.emptyBody')}
        />
      )}

      {rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('customers.field.ruleName')}</TableCell>
              <TableCell align="right">{t('customers.field.minAmount')}</TableCell>
              <TableCell>{t('customers.field.approverRole')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((rule) => (
              <TableRow key={rule.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>{rule.name}</TableCell>
                <TableCell align="right" className="tnum">
                  {rule.min_amount}
                </TableCell>
                <TableCell>
                  <StatusChip label={t(`customers.role.${rule.approver_role}`)} />
                </TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'edit',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${rule.name}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => {
                          setEditing(rule)
                          setValues({
                            name: rule.name,
                            min_amount: rule.min_amount,
                            approver_role: rule.approver_role,
                            is_active: rule.is_active,
                          })
                          setError(null)
                        },
                      },
                      {
                        id: 'delete',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('common.delete')}: ${rule.name}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => {
                          void remove.mutateAsync(rule.id).then(() => notify(t('customers.toast.deleted')))
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

      <Divider />

      <Stack spacing={1.5}>
        <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
          {t('customers.approval.simulator')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
          {t('customers.approval.simulatorHelp')}
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Field
            size="small"
            rule="money"
            help={t('help.customers.simulateAmount')}
            label={t('customers.field.amount')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Button onClick={() => void simulate()} disabled={check.isPending}>
            {t('customers.approval.check')}
          </Button>
        </Stack>

        {decision && (
          <Alert severity={decision.required ? 'warning' : 'success'}>
            <Stack spacing={0.5}>
              <span>
                {decision.required
                  ? t('customers.approval.required')
                  : t('customers.approval.notRequired')}
              </span>
              {decision.reason && (
                <Typography sx={{ fontSize: 13 }}>
                  {t(REASON_LABEL[decision.reason] ?? 'customers.approval.reason.rule')}
                  {decision.rule_name ? ` — ${decision.rule_name}` : ''}
                </Typography>
              )}
              {decision.approver_role && (
                <Typography sx={{ fontSize: 13 }}>
                  {t('customers.field.approverRole')}: {t(`customers.role.${decision.approver_role}`)}
                </Typography>
              )}
            </Stack>
          </Alert>
        )}
      </Stack>
    </Stack>
  )
}
