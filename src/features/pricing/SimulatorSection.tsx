import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { T } from '@/theme/tokens'
import { PricingError } from './errors'
import { simulatePrice } from './api'
import { useChannels, useProductSearch, useProductVariants, useSegments } from './hooks'
import type { PriceQuoteResult, PricedProduct } from './types'
import { Field } from '@/shared/ui/Field'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Simulador: «¿cuánto le costaría esto a este cliente, por este canal?».
 *
 * No calcula NADA en el navegador. Llama a `public.price_quote`, que es la
 * misma función que usa la vitrina y que usa el pedido; si la respuesta fuera
 * una estimación del cliente, el simulador diría una cosa y la caja otra —y el
 * simulador solo se abre precisamente cuando alguien duda del precio—.
 *
 * Enseña el desglose completo: qué lista ganó, por qué alcance y desde qué
 * escala. Esa es la respuesta a la única pregunta que se hace cuando un precio
 * sorprende.
 */
export function SimulatorSection() {
  const { t } = useI18n()
  const { activeStore } = useTenant()

  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const search = useProductSearch(activeStore?.id ?? null, debounced)
  const [product, setProduct] = useState<PricedProduct | null>(null)
  const variants = useProductVariants(product?.id ?? null)
  const channels = useChannels(activeStore?.id ?? null)
  const segments = useSegments()
  const customers = useCustomerOptions({ term: '' })

  const [variantId, setVariantId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<MessageKey | null>(null)
  const [result, setResult] = useState<PriceQuoteResult | null>(null)

  const run = useMutation({ mutationFn: simulatePrice })

  const label = useMemo(() => {
    const names = new Map<string, string>()
    for (const row of search.data ?? []) names.set(row.id, `${row.sku} · ${row.name}`)
    if (product) names.set(product.id, `${product.sku} · ${product.name}`)
    return names
  }, [search.data, product])

  async function simulate() {
    if (!activeStore || !product) {
      setError('pricing.error.product')
      return
    }
    const parsedQuantity = Number(quantity)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError('pricing.error.amount')
      return
    }

    setError(null)
    try {
      const quote = await run.mutateAsync({
        storeId: activeStore.id,
        productId: product.id,
        variantId: variantId || null,
        quantity: parsedQuantity,
        channelId: channelId || null,
        segmentId: segmentId || null,
        customerId: customerId || null,
      })
      setResult(quote)
    } catch (caught) {
      setResult(null)
      setError(caught instanceof PricingError ? caught.key : 'pricing.error.generic')
    }
  }

  const line = result?.lines[0] ?? null

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('pricing.simulator.help')}</Typography>

      {error && <Alert severity="error">{t(error)}</Alert>}

      <Card sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          {/*
            Tres filas, y el corte no es estético: es la pregunta del simulador
            partida en sus tres partes —QUÉ se cotiza, PARA QUIÉN, y CUÁNTO—.
            Antes iba todo en una: cuatro desplegables a `fullWidth` se repartían
            el ancho contra «Cantidad», que acababa en unos 40 px con la etiqueta
            recortada en «C…» y el botón pegado encima.
          */}

          {/* QUÉ se cotiza. La variante viaja con su producto, no suelta. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Autocomplete
              sx={{ flex: 1, minWidth: 0 }}
              options={search.data ?? []}
              value={product}
              onChange={(_, next) => {
                setProduct(next)
                setVariantId('')
                setResult(null)
              }}
              onInputChange={(_, next) => setTerm(next)}
              getOptionLabel={(option) => label.get(option.id) ?? option.sku}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              loading={search.isFetching}
              noOptionsText={t('pricing.noResults')}
              renderInput={(params) => (
                <TextField {...params} label={t('pricing.field.product')} size="small" />
              )}
            />

            <SelectField
              size="small"
              label={t('pricing.field.variant')}
              value={variantId}
              disabled={(variants.data ?? []).length === 0}
              onChange={(event) => setVariantId(event.target.value)}
              sx={{ width: { xs: '100%', sm: 260 }, flexShrink: 0 }}
            >
              <MenuItem value="">{t('pricing.field.noVariant')}</MenuItem>
              {(variants.data ?? []).map((variant) => (
                <MenuItem key={variant.id} value={variant.id}>
                  {variant.name}
                </MenuItem>
              ))}
            </SelectField>
          </Stack>

          {/* PARA QUIÉN se cotiza: los tres ejes con los que el motor decide. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <SelectField
              size="small"
              fullWidth
              label={t('pricing.field.channel')}
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
            >
              <MenuItem value="">{t('pricing.field.defaultChannel')}</MenuItem>
              {(channels.data ?? []).map((channel) => (
                <MenuItem key={channel.id} value={channel.id}>
                  {channel.code} · {channel.name}
                </MenuItem>
              ))}
            </SelectField>

            <SelectField
              size="small"
              fullWidth
              label={t('pricing.field.segment')}
              value={segmentId}
              onChange={(event) => setSegmentId(event.target.value)}
            >
              <MenuItem value="">{t('pricing.field.noSegment')}</MenuItem>
              {(segments.data ?? []).map((segment) => (
                <MenuItem key={segment.id} value={segment.id}>
                  {segment.name}
                </MenuItem>
              ))}
            </SelectField>

            {/* Desde P05-SaaS: elegir un cliente basta. Si no se declara
                segmento, el servidor toma el de su ficha —así el simulador
                responde lo que de verdad le van a cobrar—. Declarar los dos
                sigue valiendo, para responder «¿y si lo pasamos a mayorista?». */}
            <SelectField
              size="small"
              fullWidth
              label={t('pricing.field.customer')}
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <MenuItem value="">{t('pricing.field.noCustomer')}</MenuItem>
              {(customers.data ?? []).map((customer) => (
                <MenuItem key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </MenuItem>
              ))}
            </SelectField>
          </Stack>

          {/* CUÁNTO, y la pregunta. `flexShrink: 0` y ancho fijo: «Cantidad» es
              un número de tres cifras y no tiene por qué competir con nada. */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Field
              size="small"
              rule="integer"
              label={t('pricing.field.quantity')}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              sx={{ width: { xs: '100%', sm: 120 }, flexShrink: 0 }}
            />

            <Button variant="contained" onClick={() => void simulate()} disabled={run.isPending}>
              {t('pricing.simulator.run')}
            </Button>
          </Stack>
        </Stack>
      </Card>

      {result && line && (
        <Card sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography sx={{ fontSize: T.cardTitle, fontWeight: 800 }}>
              {line.unit_price} {result.currency}
              {line.compare_at_price && (
                <Typography
                  component="span"
                  sx={{ ml: 1, textDecoration: 'line-through', color: 'var(--muted)' }}
                >
                  {line.compare_at_price}
                </Typography>
              )}
            </Typography>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <StatusChip
                tone={line.source === 'price_list' ? 'success' : 'default'}
                label={t(`pricing.source.${line.source}`)}
              />
              {line.price_list_code && <StatusChip label={line.price_list_code} />}
              {line.scope && <StatusChip label={t(`pricing.scope.${line.scope}`)} />}
              {line.min_quantity && (
                <StatusChip label={`${t('pricing.field.minQuantity')}: ${Number(line.min_quantity)}`} />
              )}
              <StatusChip label={`${t('pricing.field.channel')}: ${result.channel}`} />
            </Stack>

            <Box sx={{ pt: 1 }}>
              <Typography sx={{ fontSize: T.label, color: 'var(--muted)' }}>
                {t('pricing.simulator.totals')}: {result.subtotal} + {result.tax_total} ={' '}
                {result.grand_total} {result.currency}
              </Typography>
            </Box>
          </Stack>
        </Card>
      )}
    </Stack>
  )
}
