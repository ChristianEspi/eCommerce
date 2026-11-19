import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { Field } from '@/shared/ui/Field'
import { SelectField } from '@/shared/ui/SelectField'
import { TS } from '@/theme/tokens'
import { markAiAttribution } from '../aiAttribution'
import {
  INTAKE_ACCEPT,
  INTAKE_MAX_TEXT,
  IntakeError,
  checkIntakeFile,
  fileToBase64,
  preselected,
  readIntake,
  type Confidence,
  type IntakeFileIssue,
  type IntakeLine,
} from './intake'

/** Lo que se le pasa al pedido rápido: SKU y cantidad, como una fila tecleada. */
export interface IntakeAcceptedLine {
  readonly sku: string
  readonly quantity: number
}

interface Choice {
  readonly checked: boolean
  readonly sku: string | null
  readonly quantity: string
}

const CHIP: Record<Confidence, 'success' | 'info' | 'warning' | 'default'> = {
  codigo: 'success',
  probable: 'success',
  dudosa: 'warning',
  variante: 'info',
  ninguna: 'default',
}

function errorKey(error: unknown): MessageKey {
  const code = error instanceof IntakeError ? error.code : ''
  if (code === 'RATE_LIMITED') return 'store.intake.error.rateLimited'
  if (code === 'ARCHIVO_DEMASIADO_GRANDE') return 'store.intake.file.ARCHIVO_DEMASIADO_GRANDE'
  if (code === 'TIPO_NO_ADMITIDO' || code === 'ARCHIVO_ILEGIBLE') return 'store.intake.file.TIPO_NO_ADMITIDO'
  return 'store.intake.error.generic'
}

/**
 * «Con IA»: una foto, un PDF o el pedido escrito como se diga.
 *
 * La IA lee y el catálogo propone; la persona decide. Nada pasa al pedido sin
 * estar marcado, y lo dudoso empieza sin marcar. Lo aceptado llega al editor
 * del pedido rápido y se valida allí como cualquier fila (surtido, precio y
 * existencia los pone el carrito).
 */
export function IntakePanel({
  storeSlug,
  onAccept,
}: {
  storeSlug: string
  onAccept: (lines: readonly IntakeAcceptedLine[]) => void
}) {
  const { t, locale } = useI18n()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileIssue, setFileIssue] = useState<IntakeFileIssue | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])

  const read = useMutation({
    mutationFn: async () => {
      const payload = file ? { mediaType: file.type, data: await fileToBase64(file) } : null
      return readIntake({ storeSlug, locale: locale === 'en' ? 'en' : 'es', text, file: payload })
    },
    onSuccess: (result) => {
      setChoices(
        (result.data?.lineas ?? []).map((line) => ({
          checked: preselected(line),
          sku: line.sku_propuesto,
          quantity: String(line.cantidad),
        })),
      )
    },
  })

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    event.target.value = ''
    read.reset()
    if (!chosen) return
    const issue = checkIntakeFile(chosen)
    setFileIssue(issue)
    setFile(issue ? null : chosen)
  }

  const lines: readonly IntakeLine[] = read.data?.data?.lineas ?? []
  const motivo = read.data?.motivo ?? null

  function update(index: number, patch: Partial<Choice>) {
    setChoices((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const ready = choices
    .map((c) => ({ sku: c.sku, quantity: Number.parseInt(c.quantity, 10), checked: c.checked }))
    .filter((c): c is { sku: string; quantity: number; checked: true } =>
      c.checked && Boolean(c.sku) && Number.isInteger(c.quantity) && c.quantity >= 1 && c.quantity <= 9999,
    )

  const canRead = !read.isPending && (Boolean(file) || text.trim().length >= 3)

  /** Pasa lo marcado al pedido y anota sus productos para medir el valor de la IA. */
  function acceptAll() {
    const productIds = choices.flatMap((choice, index) => {
      const line = lines[index]
      if (!choice.checked || !choice.sku || !line) return []
      const match = [line.coincidencia, ...line.alternativas].find((p) => p?.sku === choice.sku)
      return match ? [match.product_id] : []
    })
    markAiAttribution(storeSlug, productIds, 'intake')
    onAccept(ready.map(({ sku, quantity }) => ({ sku, quantity })))
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)', fontSize: TS.body }}>{t('store.intake.help')}</Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadFileRoundedIcon />}
          onClick={() => fileRef.current?.click()}
          disabled={read.isPending}
        >
          {t('store.intake.file.choose')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={INTAKE_ACCEPT}
          hidden
          aria-label={t('store.intake.file.choose')}
          onChange={onFile}
        />
        {file && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              {t('store.intake.file.chosen').replace('{name}', file.name)}
            </Typography>
            <Button size="small" onClick={() => setFile(null)}>
              {t('store.intake.file.remove')}
            </Button>
          </Stack>
        )}
      </Stack>
      {fileIssue && <Alert severity="warning">{t(`store.intake.file.${fileIssue}`)}</Alert>}

      <Field
        label={t('store.intake.text.label')}
        helperText={t('store.intake.text.help')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rule="longText"
        maxLength={INTAKE_MAX_TEXT}
        multiline
        minRows={3}
        placeholder={t('store.intake.text.placeholder')}
      />

      <Button
        variant="contained"
        startIcon={read.isPending ? <CircularProgress size={16} aria-hidden /> : <AutoAwesomeRoundedIcon />}
        onClick={() => read.mutate()}
        disabled={!canRead}
        sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
      >
        {read.isPending ? t('store.intake.reading') : t('store.intake.read')}
      </Button>

      <Box aria-live="polite">
        {read.isError && <Alert severity="error">{t(errorKey(read.error))}</Alert>}
        {read.isSuccess && motivo && (
          <Alert severity={motivo === 'vacia' ? 'info' : 'warning'}>
            {t(motivo === 'vacia' ? 'store.intake.empty' : 'store.intake.unavailable')}
          </Alert>
        )}

        {lines.length > 0 && (
          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
              {t('store.intake.review.title')}
            </Typography>
            <Alert severity="info">{t('store.intake.review.hint')}</Alert>
            {read.data?.data?.notas && (
              <Alert severity="warning">{read.data.data.notas}</Alert>
            )}

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Box component="span" sx={visuallyHidden}>{t('store.intake.review.include')}</Box>
                    </TableCell>
                    <TableCell>{t('store.intake.review.read')}</TableCell>
                    <TableCell>{t('store.intake.review.product')}</TableCell>
                    <TableCell align="right">{t('store.quickOrder.field.quantity')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((line, index) => {
                    const choice = choices[index]
                    if (!choice) return null
                    const options = [line.coincidencia, ...line.alternativas].filter(
                      (p): p is NonNullable<typeof p> => Boolean(p && p.sku && p.kind !== 'variant'),
                    )
                    const label = t('store.intake.review.lineLabel').replace('{n}', String(index + 1))
                    return (
                      <TableRow key={line.indice} sx={{ verticalAlign: 'top' }}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={choice.checked}
                            disabled={!choice.sku}
                            onChange={(event) => update(index, { checked: event.target.checked })}
                            slotProps={{ input: { 'aria-label': `${t('store.intake.review.include')} · ${label}` } }}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 160 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {line.texto}
                          </Typography>
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                            <Chip size="small" color={CHIP[line.confianza]} label={t(`store.intake.confidence.${line.confianza}`)} />
                            {line.cantidad_supuesta && <Chip size="small" variant="outlined" label={t('store.intake.flag.assumedQty')} />}
                            {!line.legible && <Chip size="small" variant="outlined" label={t('store.intake.flag.unclear')} />}
                            {line.unidad && <Chip size="small" variant="outlined" label={line.unidad} />}
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          {line.confianza === 'variante' && line.coincidencia ? (
                            <Button size="small" component={Link} to={`/s/${storeSlug}/product/${line.coincidencia.slug}`}>
                              {t('store.intake.review.chooseVariant').replace('{name}', line.coincidencia.name)}
                            </Button>
                          ) : options.length > 0 ? (
                            <SelectField
                              size="small"
                              label={t('store.intake.review.product')}
                              value={choice.sku ?? ''}
                              onChange={(event) => update(index, { sku: event.target.value || null })}
                              fullWidth
                            >
                              {options.map((p) => (
                                <MenuItem key={p.product_id} value={p.sku ?? ''}>
                                  {p.name}
                                  {p.sku ? ` · ${p.sku}` : ''}
                                </MenuItem>
                              ))}
                            </SelectField>
                          ) : line.sku_propuesto ? (
                            <Typography variant="body2">
                              {t('store.intake.review.codeOnly').replace('{sku}', line.sku_propuesto)}
                            </Typography>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                              {t('store.intake.review.noMatch')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ width: 110 }}>
                          <Field
                            size="small"
                            label={t('store.quickOrder.field.quantity')}
                            value={choice.quantity}
                            onChange={(event) => update(index, { quantity: event.target.value })}
                            rule="integer"
                            maxLength={4}
                            slotProps={{ htmlInput: { 'aria-label': `${t('store.quickOrder.field.quantity')} · ${label}` } }}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>

            <Button
              variant="contained"
              onClick={acceptAll}
              disabled={ready.length === 0}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-end' } }}
            >
              {t('store.intake.review.accept').replace('{count}', String(ready.length))}
            </Button>
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
