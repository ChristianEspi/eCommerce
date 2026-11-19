import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { matchesRule } from '@/shared/lib/fieldRules'
import { useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { DetailHeading } from '@/shared/ui/DetailBlocks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { PromotionsError } from './errors'
import {
  useAdjustGiftCard,
  useCancelGiftCard,
  useGiftCardMovements,
  useGiftCards,
  useIssueGiftCard,
} from './hooks'
import { formatGiftCardCode, type GiftCard } from './types'
import type { IssuedGiftCard } from './api'
import { SelectField } from '@/shared/ui/SelectField'

const STATUS_TABS = ['active', 'depleted', 'expired', 'cancelled', 'all'] as const

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success',
  depleted: 'default',
  expired: 'warning',
  cancelled: 'error',
}

/**
 * Tarjetas regalo: saldo emitido, saldo vivo y quién lo movió.
 *
 * **No son un descuento.** Son un medio de pago con saldo, así que no aparecen
 * en ninguna campaña, no bajan el subtotal y no tocan el impuesto de ningún
 * pedido: lo único que hacen es reducir cuánto se le pide a la pasarela. Están
 * en esta pantalla porque el operador que monta campañas es el mismo que emite
 * tarjetas, no porque compartan motor.
 *
 * Dos decisiones que se ven en cuanto se usa:
 *
 *  1. **El código se enseña UNA vez**, en el aviso posterior a emitir, y no se
 *     guarda en ningún estado que sobreviva a cerrar el diálogo. Después ya no
 *     existe forma de leerlo: la columna no tiene GRANT de lectura para nadie.
 *     Lo que queda son los cuatro últimos, para reconocerla.
 *  2. **El saldo no se edita: se mueve.** No hay campo de saldo. Hay «ajustar»
 *     —con motivo obligatorio— y «anular», y las dos escriben un asiento en el
 *     libro mayor. Un saldo editable sería un movimiento de dinero sin rastro.
 */
export function GiftCardsSection() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, can } = useTenant()
  const canManage = can('store.manage')

  const [status, setStatus] = useState<string>('active')
  const [term, setTerm] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [amount, setAmount] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [email, setEmail] = useState('')
  // Opcional, pero si se escribe tiene que ser un correo: es a quien se entrega.
  const emailInvalid = email.trim() !== '' && !matchesRule('email', email)
  const [notes, setNotes] = useState('')
  const [issued, setIssued] = useState<IssuedGiftCard | null>(null)
  const [selected, setSelected] = useState<GiftCard | null>(null)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [reason, setReason] = useState('')

  const cards = useGiftCards(activeStore?.id ?? null, status, term)
  const movements = useGiftCardMovements(selected?.id ?? null)
  const issue = useIssueGiftCard()
  const adjust = useAdjustGiftCard()
  const cancel = useCancelGiftCard()

  const list = cards.data ?? []
  const isEmpty = !cards.isPending && !cards.isError && list.length === 0

  async function run(action: () => Promise<unknown>, okKey: MessageKey) {
    try {
      await action()
      notify(t(okKey), 'success')
    } catch (error) {
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
    }
  }

  async function submitIssue() {
    if (!activeStore) return
    try {
      const result = await issue.mutateAsync({
        storeId: activeStore.id,
        amount: amount.trim(),
        expiresAt,
        email,
        notes,
      })
      setIssued(result)
      setIssuing(false)
      setAmount('')
      setEmail('')
      setNotes('')
    } catch (error) {
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!canManage) {
    return (
      <UnauthorizedState
        title={t('promotions.forbidden.title')}
        description={t('promotions.forbidden.body')}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('promotions.giftCards.help')}</Typography>

      <FilterBar
        actions={
          <Button variant="contained" onClick={() => setIssuing(true)}>
            {t('promotions.giftCards.issue')}
          </Button>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('promotions.giftCards.search')}
          />
        </Box>
        <SelectField
          size="small"
          label={t('common.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 180 }}
          SelectProps={{ native: true }}
        >
          {STATUS_TABS.map((value) => (
            <option key={value} value={value}>
              {t(`promotions.giftStatus.${value}` as MessageKey)}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      {issued && (
        <Alert severity="success" onClose={() => setIssued(null)}>
          <Typography sx={{ fontWeight: 700 }}>{t('promotions.giftCards.issuedOnce')}</Typography>
          <Typography sx={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 1 }}>
            {formatGiftCardCode(issued.code)}
          </Typography>
          <Typography sx={{ fontSize: 13 }}>
            {issued.balance} {issued.currency}
          </Typography>
        </Alert>
      )}

      <Card>
        {cards.isPending && <TableSkeleton columns={6} />}
        {cards.isError && <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={t('promotions.giftCards.empty')}
            description={t('promotions.giftCards.emptyBody')}
            icon={<CardGiftcardRoundedIcon fontSize="small" />}
            action={
              <Button variant="contained" onClick={() => setIssuing(true)}>
                {t('promotions.giftCards.issue')}
              </Button>
            }
          />
        )}
        {!cards.isPending && !cards.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('promotions.field.card')}</TableCell>
                <TableCell>{t('promotions.field.issuedTo')}</TableCell>
                <TableCell align="right">{t('promotions.field.issued')}</TableCell>
                <TableCell align="right">{t('promotions.field.balance')}</TableCell>
                <TableCell>{t('promotions.field.expires')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((card) => (
                <TableRow
                  key={card.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelected(card)
                    setAdjustAmount('')
                    setReason('')
                  }}
                >
                  <TableCell sx={{ fontFamily: 'monospace' }}>••••{card.code_last4}</TableCell>
                  <TableCell>{card.issued_to_email ?? '—'}</TableCell>
                  <TableCell align="right">
                    {card.initial_amount} {card.currency}
                  </TableCell>
                  <TableCell align="right">
                    {card.balance} {card.currency}
                  </TableCell>
                  <TableCell>{formatDate(card.expires_at, locale)}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={STATUS_COLOR[card.effective_status] ?? 'default'}
                      label={t(`promotions.giftStatus.${card.effective_status}` as MessageKey)}
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

      {/* --- Emitir ------------------------------------------------------- */}
      <FormDrawer
        open={issuing}
        title={t('promotions.giftCards.issue')}
        onClose={() => setIssuing(false)}
        busy={issue.isPending}
        actions={
          <>
            <Button onClick={() => setIssuing(false)}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={() => void submitIssue()}
              disabled={issue.isPending || amount.trim() === '' || emailInvalid}
            >
              {t('promotions.giftCards.issue')}
            </Button>
          </>
        }
      >
        <Stack spacing={2.5}>
          <Alert severity="info">{t('promotions.giftCards.issueHint')}</Alert>
          <Field
            label={`${t('promotions.field.amount')} (${activeStore?.currency ?? ''})`}
            rule="money"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            size="small"
            fullWidth
          />
          <Field
            type="datetime-local"
            label={t('promotions.field.expires')}
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            helperText={t('promotions.hint.expiry')}
            InputLabelProps={{ shrink: true }}
            size="small"
            fullWidth
          />
          <Field
            label={t('promotions.field.issuedTo')}
            rule="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={emailInvalid}
            helperText={emailInvalid ? t('field.error.email') : t('promotions.hint.issuedTo')}
            size="small"
            fullWidth
          />
          <Field
            label={t('promotions.field.notes')}
            rule="longText"
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            size="small"
            fullWidth
          />
        </Stack>
      </FormDrawer>

      {/* --- Detalle y libro mayor ---------------------------------------- */}
      <FormDrawer
        open={selected !== null}
        title={selected ? `••••${selected.code_last4}` : ''}
        subtitle={selected?.issued_to_email ?? undefined}
        width={600}
        onClose={() => setSelected(null)}
        actions={<Button onClick={() => setSelected(null)}>{t('common.close')}</Button>}
      >
        {selected && (
          <Stack spacing={3}>
            <Stack spacing={0.5}>
              <DetailHeading>{t('promotions.field.balance')}</DetailHeading>
              <Typography sx={{ fontSize: 24, fontWeight: 800 }}>
                {selected.balance} {selected.currency}
              </Typography>
              <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                {t('promotions.field.issued')}: {selected.initial_amount} ·{' '}
                {t('promotions.field.expires')}: {formatDate(selected.expires_at, locale)}
              </Typography>
            </Stack>

            <Stack spacing={1.5}>
              <DetailHeading>{t('promotions.giftCards.move')}</DetailHeading>
              <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                {t('promotions.giftCards.moveHint')}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Field
                  size="small"
                  label={t('promotions.field.amount')}
                  rule="signedMoney"
                  help={t('help.promotions.giftCardAdjust')}
                  value={adjustAmount}
                  onChange={(event) => setAdjustAmount(event.target.value)}
                  sx={{ minWidth: 140 }}
                />
                <Field
                  size="small"
                  label={t('promotions.field.reason')}
                  rule="text"
                  help={t('help.promotions.giftCardReason')}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  fullWidth
                />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button
                  onClick={() =>
                    void run(
                      () =>
                        adjust.mutateAsync({
                          giftCardId: selected.id,
                          amount: adjustAmount,
                          reason,
                        }),
                      'promotions.giftCards.adjusted',
                    )
                  }
                  disabled={adjustAmount.trim() === '' || reason.trim().length < 3}
                >
                  {t('promotions.giftCards.adjust')}
                </Button>
                <Button
                  color="error"
                  onClick={() =>
                    void run(
                      () => cancel.mutateAsync({ giftCardId: selected.id, reason }),
                      'promotions.giftCards.cancelled',
                    )
                  }
                  disabled={reason.trim().length < 3 || selected.status === 'cancelled'}
                >
                  {t('promotions.giftCards.cancel')}
                </Button>
              </Stack>
            </Stack>

            <Stack spacing={1}>
              <DetailHeading>{t('promotions.giftCards.ledger')}</DetailHeading>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.date')}</TableCell>
                    <TableCell>{t('promotions.field.movement')}</TableCell>
                    <TableCell align="right">{t('promotions.field.amount')}</TableCell>
                    <TableCell align="right">{t('promotions.field.balance')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(movements.data ?? []).map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell>{formatDateTime(movement.createdAt, locale)}</TableCell>
                      <TableCell>
                        {t(`promotions.movement.${movement.kind}` as MessageKey)}
                      </TableCell>
                      <TableCell align="right">{movement.amount}</TableCell>
                      <TableCell align="right">{movement.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          </Stack>
        )}
      </FormDrawer>
    </Stack>
  )
}
