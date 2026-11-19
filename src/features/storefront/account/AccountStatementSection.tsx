import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import {
  Box,
  Card,
  Chip,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { fetchMyStatement, myStatementKey, type AccountStatement } from '../portal'

/**
 * Estado de cuenta.
 *
 * Responde tres preguntas, en este orden, porque es el orden en que se hacen:
 * **cuánto debo**, **cuánto de eso está vencido** y **cuánto me queda de
 * línea**. Todo lo demás —lo comprado en el año, el detalle documento a
 * documento— va después, porque es contexto y no decisión.
 *
 * Lo vencido se pinta aparte y en rojo aunque ya esté contado dentro de la
 * deuda: mezclarlo en un solo número deja al comprador sin saber si tiene un
 * problema o simplemente una factura en plazo.
 *
 * Una cuenta sin línea de crédito no es una cuenta con línea cero: la primera
 * compra al contado y la segunda tiene el crédito agotado. Por eso `null` se
 * dice con palabras y no con un cero.
 */
export function AccountStatementSection({ storeSlug }: { storeSlug?: string | null }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: myStatementKey(storeSlug),
    queryFn: () => fetchMyStatement(storeSlug),
  })

  if (query.isPending) return <BrandLoader />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const cuentas = query.data ?? []
  if (cuentas.length === 0) {
    return (
      <EmptyState
        title={t('account.statement.empty')}
        description={t('account.statement.emptyBody')}
        icon={<AccountBalanceWalletRoundedIcon fontSize="small" />}
      />
    )
  }

  return (
    <Stack sx={{ gap: 2.5 }}>
      {cuentas.map((cuenta) => (
        <CuentaCard key={cuenta.account_id} cuenta={cuenta} />
      ))}
    </Stack>
  )
}

function CuentaCard({ cuenta }: { cuenta: AccountStatement }) {
  const { t, locale } = useI18n()
  const moneda = cuenta.currency ?? 'PEN'
  const deuda = Number(cuenta.balance_due)
  const vencido = Number(cuenta.overdue_amount)
  const limite = cuenta.credit_limit === null ? null : Number(cuenta.credit_limit)
  const disponible = cuenta.credit_available === null ? null : Number(cuenta.credit_available)
  const usado = limite && limite > 0 ? Math.min((deuda / limite) * 100, 100) : 0
  const pendientes = cuenta.pending_payments ?? []
  const porConfirmar = Number(cuenta.pending_payments_total ?? 0)

  return (
    <Card
      sx={{
        p: { xs: 2, md: 2.5 },
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      <Stack sx={{ gap: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 800 }}>
            {cuenta.account_name}
          </Typography>
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {cuenta.payment_terms_days > 0
              ? t('account.statement.terms').replace('{n}', String(cuenta.payment_terms_days))
              : t('account.statement.cash')}
          </Typography>
        </Stack>

        {/* Las tres cifras que se vienen a ver. La deuda manda en cuerpo. */}
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
          <Cifra
            etiqueta={t('account.statement.balance')}
            valor={formatMoney(deuda, moneda, locale)}
            grande
          />
          <Cifra
            etiqueta={t('account.statement.overdue')}
            valor={formatMoney(vencido, moneda, locale)}
            alerta={vencido > 0}
          />
          <Cifra
            etiqueta={t('account.statement.available')}
            valor={
              disponible === null
                ? t('account.statement.noCredit')
                : formatMoney(disponible, moneda, locale)
            }
          />
        </Stack>

        {limite !== null && limite > 0 && (
          <Box>
            <LinearProgress
              variant="determinate"
              value={usado}
              aria-label={t('account.statement.creditUse')}
              sx={{
                height: 8,
                borderRadius: 999,
                bgcolor: 'var(--neutral-soft)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 999,
                  bgcolor: usado > 85 ? 'var(--red)' : 'var(--accent)',
                },
              }}
            />
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.75 }}>
              {t('account.statement.creditUsed')
                .replace('{used}', formatMoney(deuda, moneda, locale))
                .replace('{limit}', formatMoney(limite, moneda, locale))}
            </Typography>
          </Box>
        )}

        <Stack direction="row" sx={{ gap: 3, flexWrap: 'wrap' }}>
          <Menor
            etiqueta={t('account.statement.purchased12m')}
            valor={formatMoney(Number(cuenta.purchased_12m), moneda, locale)}
          />
          <Menor
            etiqueta={t('account.statement.paid12m')}
            valor={formatMoney(Number(cuenta.paid_12m), moneda, locale)}
          />
          {porConfirmar > 0 && (
            <Menor
              etiqueta={t('account.statement.pending')}
              valor={formatMoney(porConfirmar, moneda, locale)}
            />
          )}
        </Stack>

        {cuenta.documents.length === 0 ? (
          <Typography sx={{ fontSize: TS.body, color: 'var(--accent-deep)', fontWeight: 700 }}>
            {t('account.statement.noDebt')}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('account.orders.number')}</TableCell>
                  <TableCell>{t('account.orders.date')}</TableCell>
                  <TableCell>{t('account.statement.dueAt')}</TableCell>
                  <TableCell align="right">{t('account.orders.total')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cuenta.documents.map((doc) => (
                  <TableRow key={doc.order_id} hover>
                    <TableCell sx={{ fontWeight: 800 }}>{doc.order_number}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatDate(new Date(doc.placed_at), locale)}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                        {doc.due_at ? formatDate(new Date(doc.due_at), locale) : '—'}
                        {doc.days_overdue > 0 && (
                          <Chip
                            size="small"
                            label={t('account.statement.daysOverdue').replace(
                              '{n}',
                              String(doc.days_overdue),
                            )}
                            sx={{ bgcolor: 'var(--red-soft)', color: 'var(--red)', fontWeight: 800 }}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right" className="tnum" sx={{ fontWeight: 800 }}>
                      {formatMoney(Number(doc.total), doc.currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Pagado pero sin confirmar: va aparte para que nadie lo lea como deuda. */}
        {pendientes.length > 0 && (
          <Box
            component="section"
            aria-labelledby={`pendientes-${cuenta.account_id}`}
            sx={{
              borderTop: '1px solid var(--sf-line)',
              pt: 2,
            }}
          >
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              <Typography
                id={`pendientes-${cuenta.account_id}`}
                component="h3"
                sx={{ fontSize: 15, fontWeight: 800 }}
              >
                {t('account.statement.pending')}
              </Typography>
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {t('account.statement.pendingCount')
                  .replace('{n}', String(pendientes.length))
                  .replace('{amount}', formatMoney(porConfirmar, moneda, locale))}
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', mt: 0.5, mb: 1.5 }}>
              {t('account.statement.pendingHelp')}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('account.orders.number')}</TableCell>
                    <TableCell>{t('account.orders.date')}</TableCell>
                    <TableCell>{t('account.statement.method')}</TableCell>
                    <TableCell align="right">{t('account.orders.total')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pendientes.map((pago) => (
                    <TableRow key={pago.order_id} hover>
                      <TableCell sx={{ fontWeight: 800 }}>{pago.order_number}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDate(new Date(pago.placed_at), locale)}
                      </TableCell>
                      <TableCell>{pago.method ?? '—'}</TableCell>
                      <TableCell align="right" className="tnum" sx={{ fontWeight: 800 }}>
                        {formatMoney(Number(pago.total), pago.currency, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}
      </Stack>
    </Card>
  )
}

function Cifra({
  etiqueta,
  valor,
  grande = false,
  alerta = false,
}: {
  etiqueta: string
  valor: string
  grande?: boolean
  alerta?: boolean
}) {
  return (
    <Stack sx={{ gap: 0.25, minWidth: 150 }}>
      <Typography
        sx={{
          fontSize: TS.label,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        }}
      >
        {etiqueta}
      </Typography>
      <Typography
        className="tnum"
        sx={{
          fontSize: grande ? 28 : 20,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: alerta ? 'var(--red)' : 'var(--text)',
        }}
      >
        {valor}
      </Typography>
    </Stack>
  )
}

function Menor({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
      {etiqueta}: <strong style={{ color: 'var(--text)' }}>{valor}</strong>
    </Typography>
  )
}
