import { StatusChip } from '@/shared/ui/StatusChip'
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  IconButton,
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
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import { PromotionsError } from './errors'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useScopeTargets, useSimulate } from './hooks'
import type { Simulation } from './types'

/**
 * El producto de una línea, BUSCÁNDOLO por nombre o código.
 *
 * ## Por qué es un componente y no un campo más
 *
 * Porque cada línea necesita su propia consulta, y un hook dentro de un bucle
 * cambia de número cuando se añade o se quita una línea — que es justo lo que
 * React no admite. Con un componente por línea, cada una tiene su búsqueda y
 * quitar la de en medio no descoloca a las demás.
 *
 * ## Qué arregla
 *
 * El campo era un cuadro de texto cuyo contenido se enviaba TAL CUAL como
 * `product_id`, que es un uuid. La ayuda decía «escribe el nombre o el código»
 * y eso no podía funcionar: nadie tiene a mano el uuid de un producto, no se
 * enseña en ninguna pantalla, y escribir «Pañales» devolvía un error de tipo.
 * El simulador estaba, se veía bien y no se podía usar.
 *
 * Es el mismo buscador que ya usa el cajón de campañas para elegir el alcance,
 * y lo es a propósito: dos formas distintas de elegir un producto en la misma
 * pantalla de promociones serían dos cosas que aprender para la misma.
 */
function ProductoDeLinea({
  storeId,
  disabled,
  onPick,
}: {
  storeId: string | null
  disabled: boolean
  onPick: (productId: string) => void
}) {
  const { t } = useI18n()
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<PickerOption | null>(null)
  const debounced = useDebouncedValue(term, 300)

  // Con algo ya elegido y el texto igual a su nombre no hay nada que buscar: la
  // consulta devolvería justo lo que ya está elegido.
  const yaElegido = picked !== null && picked.primary === debounced
  const targets = useScopeTargets(storeId, 'product', debounced, !yaElegido)

  const options: PickerOption[] = (targets.data ?? []).map((fila) => ({
    id: fila.id,
    primary: fila.name,
    secondary: fila.code,
  }))

  return (
    <EntityPicker
      label={t('promotions.simulator.product')}
      placeholder={t('promotions.hint.target')}
      term={term}
      onTermChange={setTerm}
      options={options}
      value={picked}
      loading={targets.isFetching}
      disabled={disabled}
      onPick={(option) => {
        setPicked(option)
        // El campo pasa a decir lo ELEGIDO, no lo tecleado.
        setTerm(option.primary)
        onPick(option.id)
      }}
      onClear={() => {
        setPicked(null)
        setTerm('')
        onPick('')
      }}
    />
  )
}

interface Line {
  /** Estable: quitar la línea de en medio no puede descolocar a las de abajo. */
  id: string
  productId: string
  quantity: string
}

function lineaVacia(): Line {
  return { id: crypto.randomUUID(), productId: '', quantity: '1' }
}

/**
 * Las descartadas, agrupadas por el motivo.
 *
 * Se conserva el orden en el que llegaron: el motor las devuelve por prioridad,
 * y reordenarlas alfabéticamente escondería cuál pesa más.
 */
function agruparPorMotivo(
  skipped: ReadonlyArray<{ code: string; reason: string }>,
): Array<[string, string[]]> {
  const grupos = new Map<string, string[]>()
  for (const entry of skipped) {
    const codigos = grupos.get(entry.reason)
    if (codigos) codigos.push(entry.code)
    else grupos.set(entry.reason, [entry.code])
  }
  return [...grupos.entries()]
}

/**
 * El simulador: «¿qué le pasaría a este carrito?» (regla 9 del encargo).
 *
 * Es la única forma de comprobar una prioridad, una exclusión o un solapamiento
 * ANTES de que lo descubra un comprador — y la única de comprobar una campaña
 * programada, porque acepta una FECHA y responde qué pasaría ese día.
 *
 * Lo que hace que sirva de algo: **usa el mismo motor**. `promotion_simulate`
 * llama a `ebim.evaluate_promotions`, exactamente igual que el carrito de la
 * vitrina y que `create_order`. Un simulador con su propia lógica responde lo
 * que el programador creía, no lo que el sistema hace, y eso es peor que no
 * tener simulador.
 *
 * Y enseña las dos mitades: qué se aplicó **y qué no, con su motivo**. La
 * segunda es la que resuelve el ticket de soporte de verdad («¿por qué mi
 * cupón no hace nada?»).
 */
export function SimulatorSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore } = useTenant()

  const [lines, setLines] = useState<Line[]>([lineaVacia()])
  const [coupons, setCoupons] = useState('')
  const [at, setAt] = useState('')
  const [result, setResult] = useState<Simulation | null>(null)

  /**
   * A nombre de QUIÉN se simula.
   *
   * Opcional, y aun así imprescindible: un cupón con tope por cliente —«uno por
   * persona», que es el caso normal de un cupón de bienvenida— no se puede
   * evaluar sin saber quién lo usa. El motor responde `sin_identidad` y la
   * pantalla decía «falta el correo» sin ofrecer dónde ponerlo.
   *
   * También cambia el precio: un cliente con lista de precios acordada no paga
   * lo mismo que el mostrador, y simular sin él responde por otro carrito.
   */
  const [customerTerm, setCustomerTerm] = useState('')
  const [customer, setCustomer] = useState<PickerOption | null>(null)
  const customerDebounced = useDebouncedValue(customerTerm, 300)
  const customerYaElegido = customer !== null && customer.primary === customerDebounced
  const customers = useCustomerOptions({
    term: customerDebounced,
    enabled: !customerYaElegido && customerDebounced.trim().length >= 2,
  })
  const customerOptions: PickerOption[] = (customers.data ?? []).map((fila) => ({
    id: fila.id,
    primary: fila.name,
    secondary: fila.email ?? fila.code,
  }))

  const simulate = useSimulate()

  function update(index: number, patch: Partial<Line>) {
    setLines((previous) =>
      previous.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    )
  }

  async function run() {
    if (!activeStore) return
    const items = lines
      .filter((line) => line.productId.trim() !== '' && Number(line.quantity) > 0)
      .map((line) => ({
        productId: line.productId.trim(),
        variantId: null,
        quantity: Number(line.quantity),
      }))
    if (items.length === 0) {
      notify(t('promotions.simulator.needLines'), 'error')
      return
    }
    try {
      setResult(
        await simulate.mutateAsync({
          storeId: activeStore.id,
          items,
          // Los códigos se separan por coma o espacio: es como los pega quien
          // está probando, no como los formatearía un programador.
          couponCodes: coupons
            .split(/[\s,]+/)
            .map((code) => code.trim())
            .filter((code) => code !== ''),
          channelId: null,
          segmentId: null,
          customerId: customer?.id ?? null,
          at: at === '' ? null : at,
        }),
      )
    } catch (error) {
      const key: MessageKey =
        error instanceof PromotionsError ? error.key : 'promotions.error.generic'
      notify(t(key), 'error')
      setResult(null)
    }
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('promotions.simulator.help')}</Typography>

      <Card sx={{ p: 2 }}>
        <Stack spacing={2}>
          {lines.map((line, index) => (
            <Stack key={line.id} direction="row" spacing={1} alignItems="flex-start">
              {/* `flex: 1` con `minWidth: 0`: el buscador se queda con el hueco
                  que deja la cantidad, y puede encogerse por debajo de su
                  contenido en una pantalla estrecha en vez de desbordar. */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <ProductoDeLinea
                  storeId={activeStore?.id ?? null}
                  disabled={simulate.isPending}
                  onPick={(productId) => update(index, { productId })}
                />
              </Box>
              <TextField
                size="small"
                label={t('promotions.simulator.quantity')}
                value={line.quantity}
                onChange={(event) => update(index, { quantity: event.target.value })}
                sx={{ width: 120 }}
              />
              <IconButton
                aria-label={t('promotions.simulator.removeLine')}
                onClick={() => setLines((previous) => previous.filter((_, i) => i !== index))}
                disabled={lines.length === 1}
              >
                <span aria-hidden>×</span>
              </IconButton>
            </Stack>
          ))}
          <Button
            size="small"
            onClick={() => setLines((previous) => [...previous, lineaVacia()])}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('promotions.simulator.addLine')}
          </Button>

          <Divider />

          {/* Los tres reparten la fila a partes iguales.
              Los otros dos campos llevan `fullWidth`, que en una fila flexible
              significa «el 100 % del contenedor»: entre los dos se llevaban
              todo el ancho y el buscador de cliente quedaba aplastado a cero,
              con su desplegable partiendo «Escribe al menos 2 letras» palabra
              por palabra encima del campo de al lado. */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ '& > *': { flex: 1, minWidth: 0 } }}
          >
            {/* El marcador dice QUÉ escribir y la ayuda PARA QUÉ sirve. Antes
                los dos decían la misma frase larga: el marcador salía cortado
                en «Opcional. Hace f…» y la ayuda ocupaba tres líneas. */}
            <Box>
              <EntityPicker
                label={t('promotions.simulator.customer')}
                placeholder={t('promotions.hint.simulatorCustomerPlaceholder')}
                term={customerTerm}
                onTermChange={setCustomerTerm}
                options={customerOptions}
                value={customer}
                loading={customers.isFetching}
                disabled={simulate.isPending}
                helperText={t('promotions.hint.simulatorCustomer')}
                onPick={(option) => {
                  setCustomer(option)
                  setCustomerTerm(option.primary)
                }}
                onClear={() => {
                  setCustomer(null)
                  setCustomerTerm('')
                }}
              />
            </Box>
            <TextField
              size="small"
              label={t('promotions.simulator.coupons')}
              value={coupons}
              onChange={(event) => setCoupons(event.target.value)}
              helperText={t('promotions.hint.simulatorCoupons')}
              fullWidth
            />
            <TextField
              size="small"
              type="datetime-local"
              label={t('promotions.simulator.at')}
              value={at}
              onChange={(event) => setAt(event.target.value)}
              helperText={t('promotions.hint.simulatorAt')}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>

          <Button
            variant="contained"
            onClick={() => void run()}
            disabled={simulate.isPending}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('promotions.simulator.run')}
          </Button>
        </Stack>
      </Card>

      {!result && (
        <Card>
          <EmptyState
            title={t('promotions.simulator.empty')}
            description={t('promotions.simulator.emptyBody')}
            icon={<ScienceRoundedIcon fontSize="small" />}
          />
        </Card>
      )}

      {result && (
        <Card sx={{ p: 2 }}>
          <Stack spacing={2}>
            {!result.promotions.entitled && (
              <Alert severity="warning">{t('promotions.error.notEntitled')}</Alert>
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('promotions.simulator.line')}</TableCell>
                  <TableCell align="right">{t('promotions.simulator.quantity')}</TableCell>
                  {/* Dos columnas y no una. La de «precio» enseñaba el importe
                      de la línea, así que cuatro unidades a 50 se leían como
                      «4 × 200» y el subtotal parecía mal calculado. El unitario
                      es lo que se compara con la lista; el importe es lo que
                      suma. Juntarlos obligaba a dividir de cabeza. */}
                  <TableCell align="right">{t('promotions.simulator.unitPrice')}</TableCell>
                  <TableCell align="right">{t('promotions.simulator.amount')}</TableCell>
                  <TableCell align="right">{t('promotions.field.discount')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.lines.map((line) => (
                  <TableRow key={`${line.product_id}-${line.name}`}>
                    <TableCell>{line.name}</TableCell>
                    <TableCell align="right">{line.quantity}</TableCell>
                    <TableCell align="right">{line.unit_price}</TableCell>
                    <TableCell align="right">{line.net_amount}</TableCell>
                    {/* Una raya y no «−0»: un cero con signo menos delante se
                        lee como un descuento diminuto, y es que no hay. */}
                    <TableCell align="right">
                      {Number(line.discount) > 0 ? `−${line.discount}` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Divider />

            <Stack spacing={0.5} sx={{ alignSelf: 'flex-end', minWidth: 260 }}>
              <Row label={t('promotions.field.subtotal')} value={`${result.subtotal} ${result.currency}`} />
              <Row
                label={t('promotions.field.discount')}
                value={`−${result.discount_total} ${result.currency}`}
              />
              <Row label={t('promotions.field.tax')} value={`${result.tax_total} ${result.currency}`} />
              <Row
                label={t('common.total')}
                value={`${result.grand_total} ${result.currency}`}
                strong
              />
            </Stack>

            {result.promotions.applied.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">{t('promotions.simulator.applied')}</Typography>
                {result.promotions.applied.map((entry) => (
                  <Stack
                    key={entry.promotion_id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusChip tone="success" label={entry.code} />
                      <Typography>{entry.label}</Typography>
                      {entry.coupon_code && (
                        <StatusChip label={entry.coupon_code} />
                      )}
                    </Stack>
                    <Typography sx={{ fontWeight: 700 }}>−{entry.amount}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}

            {/* La mitad que casi nunca se enseña, y la que resuelve el ticket. */}
            {result.promotions.skipped.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">{t('promotions.simulator.skipped')}</Typography>
                {/* Agrupadas POR MOTIVO, no una fila por campaña.
                    Una tienda con veinte campañas activas producía veinte
                    líneas repitiendo «No alcanza ninguna línea del carrito», y
                    entre ellas se perdía la única que decía algo distinto —que
                    es justo la que se venía a buscar—. El motivo manda; los
                    códigos van a su lado. */}
                {agruparPorMotivo(result.promotions.skipped).map(([reason, codes]) => (
                  <Stack
                    key={reason}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                  >
                    <Typography sx={{ color: 'var(--muted)', minWidth: 0 }}>
                      {t(`promotions.reason.${reason}` as MessageKey)}
                    </Typography>
                    {codes.map((code) => (
                      <StatusChip key={code} label={code} />
                    ))}
                  </Stack>
                ))}
              </Stack>
            )}

            {result.promotions.coupons.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">{t('promotions.simulator.coupons')}</Typography>
                {result.promotions.coupons.map((entry) => (
                  <Stack key={entry.code} direction="row" spacing={1} alignItems="center">
                    <StatusChip
                      tone={entry.status === 'aplicado' ? 'success' : 'default'}
                      label={entry.code}
                    />
                    <Typography sx={{ color: 'var(--muted)' }}>
                      {t(`promotions.couponStatus.${entry.status}` as MessageKey)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography sx={{ color: 'var(--muted)' }}>{label}</Typography>
      <Typography sx={{ fontWeight: strong ? 800 : 600 }}>{value}</Typography>
    </Stack>
  )
}
