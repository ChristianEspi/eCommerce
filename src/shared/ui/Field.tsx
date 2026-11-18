import { InputAdornment, TextField, type TextFieldProps } from '@mui/material'
import { forwardRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { applyRule, ruleFor, type FieldRule, type FieldRuleKind } from '@/shared/lib/fieldRules'
import { FieldHelp } from './FieldHelp'

/**
 * El campo de texto de la suite (2026-11-18): un `TextField` de MUI con dos
 * cosas más, opcionales:
 *
 *  · `rule`: qué dato es (`'ruc'`, `'money'`, `'phone'`…). Filtra lo que se
 *    teclea o se pega, pone el máximo de caracteres y el teclado del móvil.
 *    `maxLength` cambia solo el máximo de la regla.
 *  · `help`: la explicación del campo, en un icono «i» al final con tooltip.
 *
 * Todo lo demás es lo de siempre —`register` de react-hook-form,
 * `value`/`onChange`, `select`, `multiline`— y se reenvía tal cual.
 *
 * El filtro corrige el valor ANTES de que lo vea el formulario: el `onChange`
 * de quien lo usa recibe ya el texto limpio.
 */
export type FieldProps = TextFieldProps & {
  rule?: FieldRuleKind | FieldRule
  maxLength?: number
  help?: ReactNode
}

type Slot = Record<string, unknown>

function asSlot(value: unknown): Slot {
  return value && typeof value === 'object' ? (value as Slot) : {}
}

const NUMBER_BLOCKED_UNSIGNED = new Set(['e', 'E', '+', '-'])
const NUMBER_BLOCKED_SIGNED = new Set(['e', 'E', '+'])

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { rule: ruleProp, maxLength, help, onChange, onKeyDown, slotProps, inputProps, InputProps, type, ...props },
  ref,
) {
  const base = typeof ruleProp === 'string' ? ruleFor(ruleProp) : ruleProp
  const rule: FieldRule | undefined =
    base || maxLength !== undefined
      ? { ...(base ?? { inputMode: 'text' as const }), maxLength: maxLength ?? base?.maxLength ?? 200 }
      : undefined
  const isNumber = type === 'number'
  const signed = typeof ruleProp === 'string' && ruleProp.startsWith('signed')

  // MUI 6: `slotProps` manda sobre `inputProps`/`InputProps` clave a clave, así
  // que se funden aquí para no perder lo que ya pasaba quien llama.
  const slots = asSlot(slotProps)
  const htmlInput: Slot = { ...asSlot(inputProps), ...asSlot(slots.htmlInput) }
  const input: Slot = { ...asSlot(InputProps), ...asSlot(slots.input) }

  if (rule && !props.select) {
    if (!isNumber && htmlInput.maxLength === undefined) htmlInput.maxLength = rule.maxLength
    if (htmlInput.inputMode === undefined && rule.inputMode !== 'text') htmlInput.inputMode = rule.inputMode
    if (htmlInput.autoComplete === undefined && rule.autoComplete) htmlInput.autoComplete = rule.autoComplete
    if (rule.uppercase && htmlInput.style === undefined) htmlInput.style = { textTransform: 'uppercase' }
  }

  if (help) {
    const existing = input.endAdornment as ReactNode
    input.endAdornment = (
      <>
        {existing}
        <InputAdornment
          position="end"
          sx={{
            ml: existing ? 0.5 : undefined,
            // En un desplegable la flecha va absoluta a la derecha: se le deja sitio.
            mr: props.select ? 2.5 : undefined,
            alignSelf: props.multiline ? 'flex-start' : undefined,
            mt: props.multiline ? 1 : undefined,
          }}
        >
          <FieldHelp text={help} label={typeof props.label === 'string' ? props.label : undefined} />
        </InputAdornment>
      </>
    )
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (rule && !props.select) {
      const target = event.target
      const raw = target.value
      let clean = raw
      if (isNumber) {
        // Un `type=number` no admite maxLength: se corta por cifras.
        const cifras = raw.replace(/\D/g, '')
        if (cifras.length > rule.maxLength) clean = raw.slice(0, raw.length - (cifras.length - rule.maxLength))
      } else {
        clean = applyRule(rule, raw)
      }
      if (clean !== raw) {
        const caret = target.selectionStart
        target.value = clean
        if (!isNumber && caret !== null) {
          const pos = Math.max(0, caret - (raw.length - clean.length))
          try {
            target.setSelectionRange(pos, pos)
          } catch {
            // algunos tipos de input no admiten selección
          }
        }
      }
    }
    onChange?.(event)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isNumber && rule) {
      const blocked = signed ? NUMBER_BLOCKED_SIGNED : NUMBER_BLOCKED_UNSIGNED
      if (blocked.has(event.key)) event.preventDefault()
    }
    onKeyDown?.(event)
  }

  return (
    <TextField
      ref={ref}
      type={type}
      {...props}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      slotProps={{ ...slots, htmlInput, input }}
    />
  )
})
