import { Box, Stack, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useId, useMemo, type ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import type { PublicVariant } from '../types'
import {
  chooseValue,
  selectionOf,
  shortVariantLabel,
  valueState,
  variantAxes,
} from '../variantChoice'

/**
 * Elegir variante con botones de opción, uno por valor.
 *
 * Con ejes declarados pinta un grupo por eje —«Talla: M» con XS S M L XL
 * debajo—; sin ellos, un grupo con el nombre corto de cada variante. Son
 * `<input type="radio">` de verdad dentro de un `<fieldset>`: el lector de
 * pantalla anuncia «Talla, grupo» y «M, botón de opción, 3 de 5», y las flechas
 * del teclado recorren los valores sin programar nada.
 *
 * Lo que no se puede comprar se dice, no se esconde: un valor sin stock en
 * ninguna combinación sale tachado y deshabilitado; uno que se vende pero no
 * con lo ya elegido sale con borde discontinuo y se puede pulsar.
 */
export function VariantPicker({
  productName,
  variants,
  selected,
  onSelect,
  disabled = false,
}: {
  productName: string
  variants: readonly PublicVariant[]
  selected: PublicVariant | null
  onSelect: (variantId: string) => void
  disabled?: boolean
}) {
  const { t, locale } = useI18n()
  const grupo = useId()
  const ejes = useMemo(() => variantAxes(variants), [variants])

  if (variants.length === 0) return null

  if (ejes) {
    const eleccion = selected ? selectionOf(selected) : {}
    return (
      <Stack sx={{ gap: 1.75 }}>
        {ejes.map((eje) => {
          const actual = eje.values.find((value) => value.code === eleccion[eje.code])
          return (
            <OptionGroup key={eje.code} legend={eje.name} current={actual?.label}>
              {eje.values.map((value) => {
                const estado = valueState(variants, selected, eje.code, value.code)
                return (
                  <OptionButton
                    key={value.code}
                    name={`${grupo}-${eje.code}`}
                    label={value.label}
                    checked={actual?.code === value.code}
                    disabled={disabled || estado === 'soldOut'}
                    elsewhere={estado === 'elsewhere'}
                    hint={
                      estado === 'soldOut'
                        ? t('store.product.variantOutOfStock')
                        : estado === 'elsewhere'
                          ? t('store.product.notInCombination')
                          : undefined
                    }
                    onChange={() => {
                      const siguiente = chooseValue(variants, selected, eje.code, value.code)
                      if (siguiente) onSelect(siguiente.variant_id)
                    }}
                  />
                )
              })}
            </OptionGroup>
          )
        })}
      </Stack>
    )
  }

  // Sin ejes: por nombre. El precio va en cada botón solo si NO es igual en
  // todas; repetir seis veces el mismo importe es ruido que empuja la talla.
  const preciosDistintos = new Set(variants.map((variant) => variant.price)).size > 1
  return (
    <OptionGroup legend={t('store.product.chooseVariant')}>
      {variants.map((variant) => (
        <OptionButton
          key={variant.variant_id}
          name={`${grupo}-variante`}
          label={shortVariantLabel(variant.name, productName)}
          detail={
            preciosDistintos
              ? formatMoney(Number(variant.price), variant.currency, locale)
              : undefined
          }
          checked={selected?.variant_id === variant.variant_id}
          disabled={disabled || variant.in_stock === false}
          hint={variant.in_stock === false ? t('store.product.variantOutOfStock') : undefined}
          onChange={() => onSelect(variant.variant_id)}
        />
      ))}
    </OptionGroup>
  )
}

function OptionGroup({
  legend,
  current,
  children,
}: {
  legend: string
  current?: string
  children: ReactNode
}) {
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography
        component="legend"
        sx={{ fontSize: TS.body, fontWeight: 700, color: 'var(--muted)', mb: 0.75, p: 0 }}
      >
        {legend}
        {current && (
          <>
            {': '}
            <Box component="span" sx={{ color: 'var(--text)', fontWeight: 800 }}>
              {current}
            </Box>
          </>
        )}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {children}
      </Stack>
    </Box>
  )
}

function OptionButton({
  name,
  label,
  detail,
  hint,
  checked,
  disabled,
  elsewhere = false,
  onChange,
}: {
  name: string
  label: string
  detail?: string
  /** Lo que el color y el tachado dicen a la vista, dicho al lector de pantalla. */
  hint?: string
  checked: boolean
  disabled: boolean
  elsewhere?: boolean
  onChange: () => void
}) {
  return (
    <Box
      component="label"
      sx={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        // 44 px: el mínimo de un objetivo táctil. Una talla es justo lo que se
        // pulsa con el pulgar en el móvil.
        minWidth: 48,
        minHeight: 44,
        px: 1.5,
        py: 0.5,
        borderRadius: 'var(--sf-radius-sm)',
        borderWidth: 1,
        borderStyle: elsewhere && !checked ? 'dashed' : 'solid',
        borderColor: checked ? 'var(--accent)' : 'var(--sf-line-strong)',
        // El borde marcado se engorda por dentro: con `borderWidth: 2` el botón
        // crecería un píxel y la fila entera saltaría al elegir.
        boxShadow: checked ? 'inset 0 0 0 1px var(--accent)' : 'none',
        bgcolor: checked ? 'var(--accent-soft)' : 'var(--card)',
        color: disabled ? 'var(--muted)' : checked ? 'var(--accent-deep)' : 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
        transition: 'border-color 120ms ease, background-color 120ms ease',
        '&:hover': disabled || checked ? undefined : { borderColor: 'var(--accent)' },
        '&:has(input:focus-visible)': { outline: '2px solid var(--accent)', outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box
        component="input"
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        sx={visuallyHidden}
      />
      <Box
        component="span"
        sx={{
          fontSize: TS.body,
          fontWeight: checked ? 800 : 700,
          lineHeight: 1.2,
          textDecoration: disabled ? 'line-through' : 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label}
      </Box>
      {detail && (
        <Box
          component="span"
          sx={{ fontSize: TS.label, fontWeight: 600, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}
        >
          {detail}
        </Box>
      )}
      {hint && (
        <Box component="span" sx={visuallyHidden}>
          {`, ${hint}`}
        </Box>
      )}
    </Box>
  )
}
