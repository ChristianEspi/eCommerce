import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  InputBase,
  Stack,
  Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatMoneyOrDash } from '@/shared/lib/format'
import { Field } from '@/shared/ui/Field'
import { TS } from '@/theme/tokens'
import { EstadoChip } from '../account/EstadoChip'
import { markAiAttribution } from '../aiAttribution'
import { fetchPublicProductsByIds } from '../api'
import { CartContext } from '../cart/cart-context'
import { ProductCard } from '../components/ProductCard'
import { useSignedThumbnails } from '../hooks'
import { addSkuLinesToCart } from '../quick-order/addBySku'
import type { CartImportResult } from '../quick-order/importToCart'
import { offersPresentation, preselected, resolveChoice, type IntakeLine } from '../quick-order/intake'
import { PresentationPicker } from '../quick-order/PresentationPicker'
import { restockNote } from '../restockText'
import { CHAT_MAX_TEXT, ChatError, sendChat, type ChatCompareRow, type ChatCredit, type ChatData, type ChatDelivery, type ChatOrder, type ChatReply, type ChatTurn } from './chat'

/** Lo que se puede pedir sin saber qué pedir. */
const EJEMPLOS = ['store.chat.example.1', 'store.chat.example.5', 'store.chat.example.2', 'store.chat.example.3', 'store.chat.example.4', 'store.chat.example.6'] as const

interface Mensaje extends ChatTurn {
  readonly id: number
  readonly reply?: ChatReply
}

function errorKey(error: unknown): MessageKey {
  const code = error instanceof ChatError ? error.code : ''
  if (code === 'RATE_LIMITED') return 'store.chat.error.rateLimited'
  if (code === 'UNAUTHORIZED' || code === 'NO_AUTENTICADO') return 'store.chat.error.session'
  return 'store.chat.error.generic'
}

function motivoKey(motivo: string | null): MessageKey | null {
  if (!motivo) return null
  if (motivo === 'sin_cuota') return 'store.chat.noCredits'
  return 'store.chat.noText'
}

/**
 * Asistente de compra conversacional (2026-11-22), para quien tiene sesión.
 *
 * Cada respuesta trae una frase y DATOS. Las cifras —precios, totales, saldo,
 * crédito— se pintan desde los datos, que salen de la base con la sesión del
 * comprador; la frase del modelo no lleva ninguna. Un carrito propuesto no se
 * añade solo: la persona lo revisa y pulsa «Añadir», y el carrito lo valida con
 * el verificador del pedido rápido como si lo hubiera tecleado.
 */
export function ChatPanel({ storeSlug, storeId }: { storeSlug: string; storeId: string | null }) {
  const { t, locale } = useI18n()
  const [texto, setTexto] = useState('')
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const siguiente = useRef(1)
  const fondo = useRef<HTMLDivElement | null>(null)

  const chat = useMutation({
    mutationFn: (turns: ChatTurn[]) => sendChat({ storeSlug, locale: locale === 'en' ? 'en' : 'es', turns }),
    onSuccess: (reply) => {
      const frase = reply.respuesta ?? (motivoKey(reply.motivo) ? t(motivoKey(reply.motivo)!) : '')
      setMensajes((actual) => [...actual, { id: siguiente.current++, role: 'assistant', text: frase, reply }])
    },
  })

  useEffect(() => {
    fondo.current?.scrollIntoView?.({ block: 'end' })
  }, [mensajes.length, chat.isPending])

  function enviar(mensaje: string) {
    const limpio = mensaje.trim().slice(0, CHAT_MAX_TEXT)
    if (limpio.length < 2 || chat.isPending) return
    const nuevos: Mensaje[] = [...mensajes, { id: siguiente.current++, role: 'user', text: limpio }]
    setMensajes(nuevos)
    setTexto('')
    chat.mutate(nuevos.map(({ role, text }) => ({ role, text })))
  }

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }} aria-live="polite">
        {mensajes.length === 0 && (
          <Stack sx={{ gap: 1.5 }}>
            <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>{t('store.chat.intro')}</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {EJEMPLOS.map((clave) => (
                <Chip key={clave} label={t(clave)} onClick={() => enviar(t(clave))} sx={{ cursor: 'pointer' }} />
              ))}
            </Stack>
          </Stack>
        )}

        <Stack sx={{ gap: 1.5 }}>
          {mensajes.map((m) =>
            m.role === 'user' ? (
              <Box
                key={m.id}
                data-chat-turn="user"
                sx={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: 'var(--accent-soft)',
                  color: 'var(--text)',
                }}
              >
                <Typography sx={{ fontSize: TS.body, overflowWrap: 'anywhere' }}>{m.text}</Typography>
              </Box>
            ) : (
              <Stack key={m.id} data-chat-turn="assistant" sx={{ gap: 1 }}>
                {m.text && <Typography sx={{ fontSize: TS.body }}>{m.text}</Typography>}
                {m.reply && <ChatDataView datos={m.reply.datos} storeSlug={storeSlug} storeId={storeId} />}
              </Stack>
            ),
          )}
          {chat.isPending && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>{t('store.chat.thinking')}</Typography>
            </Stack>
          )}
          {chat.isError && <Alert severity="warning">{t(errorKey(chat.error))}</Alert>}
          <div ref={fondo} />
        </Stack>
      </Box>

      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault()
          enviar(texto)
        }}
        sx={{ p: 2, borderTop: '1px solid var(--border)' }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.5,
            border: '1px solid var(--sf-line-strong)',
            borderRadius: 'var(--sf-pill)',
            bgcolor: 'var(--card)',
            '&:focus-within': { borderColor: 'var(--accent)' },
          }}
        >
          <InputBase
            fullWidth
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder={t('store.chat.placeholder')}
            inputProps={{ 'aria-label': t('store.chat.inputLabel'), maxLength: CHAT_MAX_TEXT }}
            sx={{ fontSize: TS.body }}
          />
          <IconButton type="submit" size="small" disabled={texto.trim().length < 2 || chat.isPending} aria-label={t('store.assistant.send')}>
            <SendRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
    </Stack>
  )
}

function ChatDataView({ datos, storeSlug, storeId }: { datos: ChatData; storeSlug: string; storeId: string | null }) {
  const { t } = useI18n()
  switch (datos.tipo) {
    case 'productos':
      return datos.product_ids.length > 0 ? (
        <ChatProducts ids={datos.product_ids} storeSlug={storeSlug} storeId={storeId} />
      ) : (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.chat.noProducts')}</Typography>
      )
    case 'sustitutos':
      return (
        <Stack sx={{ gap: 1 }}>
          {datos.principio_activo && (
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
              {t('store.chat.substitutes').replace('{ingredient}', datos.principio_activo)}
            </Typography>
          )}
          {datos.product_ids.length > 0 ? (
            <ChatProducts ids={datos.product_ids} storeSlug={storeSlug} storeId={storeId} />
          ) : (
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.chat.noProducts')}</Typography>
          )}
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.chat.pharmacistNote')}</Typography>
        </Stack>
      )
    case 'pedidos':
      return datos.pedidos.length > 0 ? (
        <Stack sx={{ gap: 1 }}>
          {datos.pedidos.map((p) => (
            <ChatOrderCard key={p.order_id} order={p} storeSlug={storeSlug} />
          ))}
        </Stack>
      ) : (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.chat.noOrders')}</Typography>
      )
    case 'pedido':
      return datos.pedido ? <ChatOrderCard order={datos.pedido} deliveries={datos.entregas} storeSlug={storeSlug} /> : null
    case 'credito':
      return datos.credito ? <ChatCreditCard credit={datos.credito} storeSlug={storeSlug} /> : null
    case 'carrito':
      return datos.lineas.length > 0 ? (
        <ChatCartProposal lines={datos.lineas} origin={datos.origen} storeSlug={storeSlug} storeId={storeId} />
      ) : null
    case 'reposicion':
      return datos.lineas.length > 0 ? (
        <ChatCartProposal
          lines={datos.lineas}
          origin={null}
          title={t('store.chat.restock.title')}
          notes={datos.lineas.map((_, i) => (datos.items[i] ? restockNote(t, datos.items[i]) : null))}
          storeSlug={storeSlug}
          storeId={storeId}
        />
      ) : (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.restock.empty')}</Typography>
      )
    case 'ficha':
      return datos.product_id ? (
        <Stack sx={{ gap: 1 }}>
          <ChatProducts ids={[datos.product_id]} storeSlug={storeSlug} storeId={storeId} />
          {datos.comparacion.length > 1 && <ChatCompareCard rows={datos.comparacion} />}
        </Stack>
      ) : (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.chat.noProduct')}</Typography>
      )
    case 'ninguno':
      return null
  }
}

const POR_UNIDAD: Record<'un' | 'ml' | 'g', MessageKey> = {
  un: 'store.chat.compare.perUnit',
  ml: 'store.chat.compare.per100ml',
  g: 'store.chat.compare.per100g',
}

/**
 * Presentaciones de un producto con su precio por unidad. Las cifras vienen del
 * servidor (cotización con la sesión del comprador); aquí solo se formatean.
 */
function ChatCompareCard({ rows }: { rows: readonly ChatCompareRow[] }) {
  const { t, locale } = useI18n()
  const comparables = rows.filter((r) => r.por_unidad !== null).length >= 2
  return (
    <Box sx={CARD_SX} data-chat-compare>
      <Typography sx={{ fontWeight: 800, fontSize: TS.body, mb: 1 }}>{t('store.chat.compare.title')}</Typography>
      <Stack component="ul" sx={{ gap: 1, m: 0, p: 0, listStyle: 'none' }}>
        {rows.map((r) => (
          <Box
            component="li"
            key={r.variant_id}
            data-chat-compare-row={r.variant_id}
            data-best={r.mejor || undefined}
            sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: TS.body, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.nombre}</Typography>
              <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                {r.mejor && <Chip size="small" color="primary" label={t('store.chat.compare.best')} />}
                {!r.en_stock && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.chat.compare.outOfStock')}</Typography>
                )}
              </Stack>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{formatMoneyOrDash(r.precio, r.moneda, locale)}</Typography>
              {r.por_unidad !== null && r.contenido && (
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {t(POR_UNIDAD[r.contenido.unidad])}: {formatMoneyOrDash(r.por_unidad, r.moneda, locale)}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Stack>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 1 }}>
        {t(comparables ? 'store.chat.compare.note' : 'store.chat.compare.notComparable')}
      </Typography>
    </Box>
  )
}

function ChatProducts({ ids, storeSlug, storeId }: { ids: readonly string[]; storeSlug: string; storeId: string | null }) {
  const productos = useQuery({
    queryKey: ['storefront', 'chat-products', storeId, ids],
    queryFn: () => fetchPublicProductsByIds(storeId, ids),
    enabled: Boolean(storeId) && ids.length > 0,
    staleTime: 60_000,
  })
  const lista = productos.data ?? []
  const miniaturas = useSignedThumbnails(lista.map((p) => p.primary_image_path))
  if (productos.isLoading) return <CircularProgress size={16} />
  return (
    <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {lista.map((producto) => (
        <ProductCard
          key={producto.product_id}
          reduced
          product={producto}
          storeSlug={storeSlug}
          imageUrl={producto.primary_image_path ? (miniaturas[producto.primary_image_path] ?? null) : null}
        />
      ))}
    </Box>
  )
}

/** `in_progress` → `inProgress`: las claves de entrega del diccionario van en camelCase. */
function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** «Reparto · En camino · prometido 19 nov · 3 días de retraso · último aviso: intento de entrega fallido». */
function deliveryLine(t: (k: MessageKey) => string, locale: 'es' | 'en', d: ChatDelivery): string {
  const partes = [d.metodo, t(`fulfillment.state.${d.estado}` as MessageKey)]
  if (d.entregado) partes.push(t('store.chat.delivery.delivered').replace('{date}', formatDate(d.entregado, locale)))
  else if (d.prometido_hasta) partes.push(t('store.chat.delivery.promised').replace('{date}', formatDate(d.prometido_hasta, locale)))
  if (d.dias_retraso > 0) partes.push(t('store.chat.delivery.late').replace('{days}', String(d.dias_retraso)))
  if (d.ultimo_evento && !d.entregado) partes.push(t('store.chat.delivery.lastEvent').replace('{event}', t(`fulfillment.tracking.${d.ultimo_evento.estado}` as MessageKey)))
  if (d.intentos_fallidos > 0) partes.push(t('store.chat.delivery.attempts').replace('{count}', String(d.intentos_fallidos)))
  return partes.filter(Boolean).join(' · ')
}

const CARD_SX = { p: 1.5, border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--card)' } as const

function ChatOrderCard({
  order,
  deliveries = [],
  storeSlug,
}: {
  order: ChatOrder
  deliveries?: readonly ChatDelivery[]
  storeSlug: string
}) {
  const { t, locale } = useI18n()
  return (
    <Box sx={CARD_SX} data-chat-order={order.order_number}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: TS.body }}>{order.order_number}</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: TS.body }}>
          {formatMoneyOrDash(order.total, order.currency, locale)}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mb: 0.75 }}>{formatDate(order.placed_at, locale)}</Typography>
      {deliveries.length > 0 && (
        <Stack sx={{ gap: 0.5, mb: 0.75 }} data-chat-deliveries>
          {deliveries.map((d, i) => (
            <Typography key={i} sx={{ fontSize: TS.label, color: d.dias_retraso > 0 ? 'var(--text)' : 'var(--muted)', fontWeight: d.dias_retraso > 0 ? 700 : 400 }}>
              {deliveryLine(t, locale, d)}
            </Typography>
          ))}
        </Stack>
      )}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
        <EstadoChip valor={order.status} clave="orders.status" />
        <EstadoChip valor={order.payment_status} clave="orders.payment" />
        {order.fulfillment_status && <EstadoChip valor={camel(order.fulfillment_status)} clave="orders.fulfillment" />}
        <Button size="small" component={Link} to={`/s/${storeSlug}/account#pedidos`} sx={{ ml: 'auto' }}>
          {t('store.chat.seeOrder')}
        </Button>
      </Stack>
    </Box>
  )
}

function ChatCreditCard({ credit, storeSlug }: { credit: ChatCredit; storeSlug: string }) {
  const { t, locale } = useI18n()
  const money = (v: string | null) => formatMoneyOrDash(v, credit.moneda, locale)
  const vencido = Number(credit.vencido) > 0
  const fila = (etiqueta: MessageKey, valor: string, fuerte = false) => (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t(etiqueta)}</Typography>
      <Typography sx={{ fontSize: TS.body, fontWeight: fuerte ? 800 : 600 }}>{valor}</Typography>
    </Stack>
  )
  return (
    <Box sx={CARD_SX} data-chat-credit>
      <Typography sx={{ fontWeight: 800, fontSize: TS.body, mb: 1 }}>{credit.cuenta}</Typography>
      <Stack sx={{ gap: 0.5 }}>
        {credit.disponible !== null && fila('store.chat.credit.available', money(credit.disponible), true)}
        {credit.limite !== null && fila('store.chat.credit.limit', money(credit.limite))}
        {fila('store.chat.credit.balance', money(credit.saldo))}
        {vencido && fila('store.chat.credit.overdue', money(credit.vencido), true)}
        {credit.proximo?.due_at &&
          fila(
            'store.chat.credit.nextDue',
            `${credit.proximo.order_number} · ${formatDate(credit.proximo.due_at, locale)} · ${money(credit.proximo.total)}`,
          )}
      </Stack>
      {vencido && <Alert severity="warning" sx={{ mt: 1 }}>{t('store.chat.credit.overdueNote')}</Alert>}
      <Button size="small" component={Link} to={`/s/${storeSlug}/account#estado`} sx={{ mt: 1 }}>
        {t('store.chat.credit.statement')}
      </Button>
    </Box>
  )
}

interface Eleccion {
  readonly checked: boolean
  readonly sku: string | null
  readonly quantity: string
}

function ChatCartProposal({
  lines,
  origin,
  title,
  notes,
  storeSlug,
  storeId,
}: {
  lines: readonly IntakeLine[]
  origin: string | null
  /** Título propio (reposición); si no, el de «repetir» o el genérico. */
  title?: string
  /** Una nota por línea (el motivo de la reposición). */
  notes?: ReadonlyArray<string | null>
  storeSlug: string
  storeId: string | null
}) {
  const { t } = useI18n()
  const cart = useContext(CartContext)
  const [elecciones, setElecciones] = useState<Eleccion[]>(() =>
    lines.map((line) => ({
      checked: preselected(line) && resolveChoice(line, line.sku_propuesto) !== null,
      sku: line.sku_propuesto,
      quantity: String(line.cantidad),
    })),
  )

  const seleccion = elecciones.flatMap((e, index) => {
    const quantity = Number.parseInt(e.quantity, 10)
    const line = lines[index]
    if (!line || !e.checked || !e.sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return []
    return [{ row: index + 1, sku: e.sku, quantity, productId: resolveChoice(line, e.sku)?.product.product_id ?? null }]
  })

  const anadir = useMutation({
    mutationFn: async (): Promise<{ result: CartImportResult; rejected: number }> => {
      if (!cart || !storeId) throw new Error('CARRITO_NO_DISPONIBLE')
      const valid = seleccion.map(({ row, sku, quantity }) => ({ row, sku, quantity }))
      const { result, rejected, accepted } = await addSkuLinesToCart(cart, { storeId, storeSlug }, valid)
      markAiAttribution(storeSlug, accepted.map((l) => l.product_id), 'assistant')
      return { result, rejected }
    },
  })

  function cambiar(index: number, patch: Partial<Eleccion>) {
    setElecciones((actual) => actual.map((e, i) => (i === index ? { ...e, ...patch } : e)))
    anadir.reset()
  }

  return (
    <Box sx={CARD_SX} data-chat-cart>
      <Typography sx={{ fontWeight: 800, fontSize: TS.body, mb: 1 }}>
        {title ?? (origin ? t('store.chat.cart.repeatTitle').replace('{number}', origin) : t('store.chat.cart.title'))}
      </Typography>
      <Stack sx={{ gap: 1.25 }}>
        {lines.map((line, index) => {
          const e = elecciones[index]
          if (!e) return null
          const etiqueta = t('store.intake.review.lineLabel').replace('{n}', String(index + 1))
          return (
            <Stack key={index} direction="row" sx={{ gap: 1, alignItems: 'flex-start' }} data-chat-cart-line={index}>
              <Checkbox
                size="small"
                checked={e.checked}
                disabled={resolveChoice(line, e.sku) === null}
                onChange={(event) => cambiar(index, { checked: event.target.checked })}
                slotProps={{ input: { 'aria-label': `${t('store.intake.review.include')} · ${etiqueta}` } }}
                sx={{ p: 0.5 }}
              />
              <Stack sx={{ flex: 1, minWidth: 0, gap: 0.75 }}>
                <Typography sx={{ fontSize: TS.body, fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {line.coincidencia?.name ?? line.texto}
                </Typography>
                {notes?.[index] && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }} data-chat-cart-note>
                    {notes[index]}
                  </Typography>
                )}
                {offersPresentation(line) ? (
                  <PresentationPicker
                    storeSlug={storeSlug}
                    line={line}
                    value={e.sku}
                    onChange={(sku) => cambiar(index, { sku, checked: sku !== null })}
                  />
                ) : !line.coincidencia ? (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('store.chat.cart.noMatch').replace('{text}', line.texto)}
                  </Typography>
                ) : line.confianza === 'dudosa' ? (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('store.chat.cart.check').replace('{text}', line.texto)}
                  </Typography>
                ) : null}
              </Stack>
              <Box sx={{ width: 84, flexShrink: 0 }}>
                <Field
                  size="small"
                  label={t('store.quickOrder.field.quantity')}
                  value={e.quantity}
                  onChange={(event) => cambiar(index, { quantity: event.target.value })}
                  rule="integer"
                  maxLength={4}
                  slotProps={{ htmlInput: { 'aria-label': `${t('store.quickOrder.field.quantity')} · ${etiqueta}` } }}
                />
              </Box>
            </Stack>
          )
        })}
      </Stack>

      {anadir.isSuccess && (
        <Alert severity={anadir.data.result.added + anadir.data.result.updated > 0 ? 'success' : 'info'} sx={{ mt: 1.5 }}>
          {t('store.chat.cart.done')
            .replace('{added}', String(anadir.data.result.added + anadir.data.result.updated + anadir.data.result.unchanged))
            .replace('{skipped}', String(anadir.data.result.skipped + anadir.data.rejected))}
          <Button size="small" onClick={() => cart?.openCart()} sx={{ ml: 1 }}>
            {t('store.chat.cart.open')}
          </Button>
        </Alert>
      )}
      {anadir.isError && <Alert severity="error" sx={{ mt: 1.5 }}>{t('store.chat.cart.failed')}</Alert>}

      <Button
        variant="contained"
        size="small"
        fullWidth
        sx={{ mt: 1.5 }}
        disabled={seleccion.length === 0 || anadir.isPending || !cart}
        onClick={() => anadir.mutate()}
      >
        {anadir.isPending ? t('store.chat.cart.adding') : t('store.chat.cart.add').replace('{count}', String(seleccion.length))}
      </Button>
    </Box>
  )
}
