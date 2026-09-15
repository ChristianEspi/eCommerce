import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { PlanningScope } from './api'
import { PlanningError } from './errors'
import { useProductLabels, usePreviewSuggestion, useSaveSuggestion } from './hooks'
import { SuggestedLinesTable } from './SuggestedLinesTable'
import {
  SUGGEST_MODEL_V1,
  SUGGEST_WINDOWS,
  isSaveableLine,
  modelOf,
  type SuggestedLine,
} from './types'

/**
 * Generar un sugerido: dos pasos, y el segundo lo da una persona.
 *
 * ## Primero se ve, después se guarda
 *
 * `ebim.suggest_order` devuelve FILAS y no crea nada. Aquí se enseñan, con su
 * motivo, y hace falta un segundo clic para que existan. Un sistema que pide
 * por ti es un sistema que se equivoca por ti, y en distribución eso se paga en
 * devoluciones y mercadería vencida.
 *
 * ## El motivo va al lado de la cifra
 *
 * «12 unidades» no se defiende delante de un cliente; «compró 12 en los últimos
 * 30 días» sí. Una cifra que nadie discute es una cifra que nadie corrige, y un
 * sugerido que no se discute acaba pidiéndose entero o ignorándose entero.
 */
export function GenerateDrawer({
  open,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  scope: PlanningScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  // El cliente elegido se guarda ENTERO, no solo su id: el desplegable tiene
  // que seguir enseñando su nombre aunque la siguiente búsqueda ya no lo traiga.
  const [elegido, setElegido] = useState<PickerOption | null>(null)
  const [days, setDays] = useState('30')
  const [lineas, setLineas] = useState<SuggestedLine[] | null>(null)

  const preview = usePreviewSuggestion()
  const save = useSaveSuggestion()

  // Cierre · item 11: v2 explica cada línea y puede caer al modelo simple; la
  // pantalla lo dice en vez de esconderlo, y no ofrece guardar lo que no hay.
  const ids = useMemo(() => [...new Set((lineas ?? []).map((l) => l.product_id))], [lineas])
  const productos = useProductLabels(ids)
  const etiquetas = useMemo(
    () => new Map((productos.data ?? []).map((p) => [p.id, p])),
    [productos.data],
  )
  const guardables = (lineas ?? []).filter(isSaveableLine).length
  const sinGuardar = (lineas ?? []).length - guardables
  const esFallback = lineas !== null && lineas.length > 0 && modelOf(lineas) === SUGGEST_MODEL_V1

  const customers = useCustomerOptions({
    term: customerSearch,
    enabled: open && customerSearch.trim().length >= 2,
  })

  const opciones = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )

  useEffect(() => {
    if (!open) return
    setCustomerSearch('')
    setElegido(null)
    setDays('30')
    setLineas(null)
    setServerError(null)
  }, [open])

  async function calcular() {
    if (!scope || !elegido) return
    setServerError(null)
    try {
      const filas = await preview.mutateAsync({
        storeId: scope.storeId,
        customerId: elegido.id,
        days: Number(days),
      })
      setLineas(filas)
    } catch (error) {
      setServerError(error instanceof PlanningError ? error.key : 'planning.error.generic')
    }
  }

  async function guardar() {
    if (!scope || !elegido || !lineas) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, customerId: elegido.id, lines: lineas })
      notify(t('planning.toast.saved'), 'success')
      onClose()
    } catch (error) {
      setServerError(error instanceof PlanningError ? error.key : 'planning.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={t('planning.generate.title')}
      subtitle={t('planning.generate.subtitle')}
      onClose={onClose}
      busy={preview.isPending || save.isPending}
      width={640}
      actions={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          {/* El segundo clic es el que crea algo. Hasta que hay líneas a la
              vista, no hay nada que guardar. */}
          <Button
            variant="contained"
            disabled={!canWrite || lineas === null || guardables === 0 || save.isPending}
            onClick={() => void guardar()}
          >
            {save.isPending ? t('common.saving') : t('planning.generate.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5}>
        {serverError && <Alert severity="error">{t(serverError)}</Alert>}

        <EntityPicker
          label={t('planning.field.customer')}
          placeholder={t('planning.generate.searchCustomer')}
          term={customerSearch}
          onTermChange={setCustomerSearch}
          options={opciones}
          loading={customers.isFetching}
          value={elegido}
          onPick={(option) => {
            setElegido(option)
            // Cambiar de cliente invalida lo calculado: enseñar las líneas del
            // anterior junto al nombre del nuevo sería una pantalla que miente.
            setLineas(null)
          }}
        />

        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <TextField
            select
            label={t('planning.field.window')}
            value={days}
            onChange={(event) => {
              setDays(event.target.value)
              setLineas(null)
            }}
            helperText={t('planning.field.windowHint')}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 180 }}
          >
            {SUGGEST_WINDOWS.map((option) => (
              <MenuItem key={option} value={String(option)}>
                {t('planning.field.days').replace('{n}', String(option))}
              </MenuItem>
            ))}
          </TextField>

          <Button
            variant="outlined"
            disabled={!elegido || preview.isPending}
            onClick={() => void calcular()}
            sx={{ mt: 1 }}
          >
            {preview.isPending ? t('planning.generate.calculating') : t('planning.generate.calculate')}
          </Button>
        </Stack>

        {lineas !== null && lineas.length === 0 && (
          <Alert severity="info">{t('planning.generate.nothing')}</Alert>
        )}

        {lineas !== null && lineas.length > 0 && (
          <Box>
            <Typography sx={{ fontWeight: 800, mb: 1 }}>
              {t('planning.generate.proposal')}
            </Typography>
            <Typography sx={{ color: 'var(--muted)', fontSize: 13, mb: 1 }}>
              {t('planning.generate.proposalHint')}
            </Typography>

            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {/* El modelo a la vista: sin él, la cifra no tiene procedencia. */}
              <Typography sx={{ fontSize: 13 }}>
                {t('planning.field.model')}:{' '}
                <strong>
                  {esFallback ? t('planning.v2.model.fallback') : t('planning.v2.model.seasonal')}
                </strong>{' '}
                <Box component="span" sx={{ color: 'var(--muted)' }}>
                  ({modelOf(lineas)})
                </Box>
              </Typography>
              {esFallback && <Alert severity="info">{t('planning.v2.fallbackNotice')}</Alert>}
              {guardables === 0 && <Alert severity="warning">{t('planning.v2.nothingToSave')}</Alert>}
              {guardables > 0 && sinGuardar > 0 && (
                <Alert severity="warning">
                  {t('planning.v2.skipped').replace('{n}', String(sinGuardar))}
                </Alert>
              )}
            </Stack>

            {/* El motivo al lado de la cifra, y debajo las piezas con que se
                calculó: es lo que permite discutirla, y una cifra que no se
                discute no se corrige. */}
            <Box sx={{ overflowX: 'auto' }}>
              <SuggestedLinesTable lines={lineas} labels={etiquetas} />
            </Box>
          </Box>
        )}
      </Stack>
    </FormDrawer>
  )
}
