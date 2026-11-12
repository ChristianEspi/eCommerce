import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import { zodResolver } from '@hookform/resolvers/zod'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CatalogError } from '../api/errors'
import {
  useAttributeValues,
  useAttributes,
  useSaveAttribute,
  useSaveAttributeValue,
} from './hooks'
import {
  ATTRIBUTE_DATA_TYPES,
  attributeFormSchema,
  attributeToForm,
  attributeValueFormSchema,
  type Attribute,
  type AttributeDataType,
  type AttributeFormValues,
  type AttributeValue,
  type AttributeValueFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

const DATA_TYPE_LABEL: Record<AttributeDataType, MessageKey> = {
  text: 'pim.type.text',
  number: 'pim.type.number',
  boolean: 'pim.type.boolean',
  date: 'pim.type.date',
  option: 'pim.type.option',
}

/**
 * Atributos de la sociedad y sus valores admitidos.
 *
 * El drawer edita las dos cosas juntas —definición arriba, lista de valores
 * abajo— porque separarlas obligaría a abrir dos pantallas para dar de alta
 * "Color" con sus cuatro colores, que es la operación real.
 *
 * Los valores solo aparecen cuando el atributo es de tipo lista: la base lo
 * impide con una FK y aquí se dice antes, en vez de dejar que el usuario
 * escriba y luego se coma un error.
 */
export function AttributesSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, can } = useTenant()
  const canWrite = can('catalog.write')

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ open: boolean; attribute: Attribute | null }>({
    open: false,
    attribute: null,
  })

  const attributes = useAttributes()
  const values = useAttributeValues()
  const saveAttribute = useSaveAttribute()
  const saveValue = useSaveAttributeValue()

  const valuesByAttribute = useMemo(() => {
    const map = new Map<string, AttributeValue[]>()
    for (const value of values.data ?? []) {
      map.set(value.attribute_id, [...(map.get(value.attribute_id) ?? []), value])
    }
    return map
  }, [values.data])

  const items = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = attributes.data ?? []
    if (!term) return all
    return all.filter(
      (attribute) =>
        attribute.name.toLowerCase().includes(term) || attribute.code.toLowerCase().includes(term),
    )
  }, [attributes.data, search])

  const isEmpty = !attributes.isPending && !attributes.isError && items.length === 0
  const current = editing.attribute

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(items)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('pim.attributes.help')}</Typography>

      <FilterBar
        actions={
          canWrite && (
            <Button variant="contained" onClick={() => setEditing({ open: true, attribute: null })}>
              {t('pim.attributes.new')}
            </Button>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('pim.search')} />
        </Box>
      </FilterBar>

      <Card>
        {attributes.isPending && <TableSkeleton columns={5} />}
        {attributes.isError && (
          <ErrorState error={attributes.error} onRetry={() => void attributes.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={search ? t('pim.noResults') : t('pim.attributes.empty')}
            icon={<TuneRoundedIcon fontSize="small" />}
          />
        )}
        {!attributes.isPending && !attributes.isError && items.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('pim.field.code')}</TableCell>
                <TableCell>{t('pim.field.name')}</TableCell>
                <TableCell>{t('pim.field.type')}</TableCell>
                <TableCell align="right">{t('pim.field.values')}</TableCell>
                <TableCell>{t('pim.field.axis')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((attribute) => (
                <TableRow key={attribute.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{attribute.code}</TableCell>
                  <TableCell>{attribute.name}</TableCell>
                  <TableCell sx={{ color: 'var(--muted)' }}>
                    {t(DATA_TYPE_LABEL[attribute.data_type])}
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {attribute.data_type === 'option'
                      ? (valuesByAttribute.get(attribute.id)?.length ?? 0)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {attribute.is_variant_axis ? (
                      <StatusChip tone="success" label={t('common.yes')} />
                    ) : (
                      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                        {t('common.no')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: `${t('common.edit')}: ${attribute.name}`,
                          tone: 'neutral',
                          onClick: () => setEditing({ open: true, attribute }),
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
      </Card>

      <AttributeDrawer
        open={editing.open}
        attribute={current}
        values={current ? (valuesByAttribute.get(current.id) ?? []) : []}
        canWrite={canWrite}
        onClose={() => setEditing({ open: false, attribute: null })}
        onSubmit={async (formValues) => {
          if (!tenant || !activeCompanyId) return
          await saveAttribute.mutateAsync({
            id: current?.id ?? null,
            scope: { organizationId: tenant.organization_id, companyId: activeCompanyId },
            values: formValues,
          })
          notify(t('pim.toast.saved'))
          setEditing({ open: false, attribute: null })
        }}
        onAddValue={async (formValues) => {
          if (!tenant || !activeCompanyId || !current) return
          await saveValue.mutateAsync({
            attributeId: current.id,
            scope: { organizationId: tenant.organization_id, companyId: activeCompanyId },
            values: formValues,
          })
          notify(t('pim.toast.saved'))
        }}
      />
    </Stack>
  )
}

function AttributeDrawer({
  open,
  attribute,
  values,
  canWrite,
  onClose,
  onSubmit,
  onAddValue,
}: {
  open: boolean
  attribute: Attribute | null
  values: AttributeValue[]
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: AttributeFormValues) => Promise<void>
  onAddValue: (values: AttributeValueFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AttributeFormValues>({
    resolver: zodResolver(attributeFormSchema),
    defaultValues: attributeToForm(attribute),
  })

  useEffect(() => {
    if (!open) return
    reset(attributeToForm(attribute))
    setServerError(null)
  }, [open, attribute, reset])

  const dataType = watch('data_type')
  const isOption = dataType === 'option'

  const fieldError = (key: keyof AttributeFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(formValues: AttributeFormValues) {
    setServerError(null)
    try {
      await onSubmit(formValues)
    } catch (error) {
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={attribute ? attribute.name : t('pim.attributes.new')}
      subtitle={attribute?.code}
      onClose={onClose}
      busy={isSubmitting}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="pim-attribute-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="pim-attribute-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <TextField
            label={t('pim.field.name')}
            fullWidth
            autoFocus
            disabled={!canWrite}
            error={Boolean(errors.name)}
            helperText={fieldError('name')}
            {...register('name')}
          />

          <TextField
            label={t('pim.field.code')}
            fullWidth
            disabled={!canWrite}
            error={Boolean(errors.code)}
            helperText={fieldError('code')}
            inputProps={{ spellCheck: false }}
            {...register('code')}
          />

          <SelectField
            label={t('pim.field.type')}
            fullWidth
            disabled={!canWrite}
            value={dataType}
            error={Boolean(errors.data_type)}
            helperText={fieldError('data_type')}
            {...register('data_type')}
          >
            {ATTRIBUTE_DATA_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {t(DATA_TYPE_LABEL[type])}
              </MenuItem>
            ))}
          </SelectField>

          <TextField
            label={t('pim.field.unit')}
            fullWidth
            disabled={!canWrite}
            error={Boolean(errors.unit)}
            helperText={fieldError('unit') ?? t('common.optional')}
            {...register('unit')}
          />

          <FormControlLabel
            control={
              <Switch
                checked={watch('is_variant_axis')}
                disabled={!canWrite || !isOption}
                onChange={(_, checked) => setValue('is_variant_axis', checked)}
              />
            }
            label={t('pim.field.axis')}
          />
          {!isOption && (
            <Typography sx={{ color: 'var(--muted)', fontSize: 13, mt: -1.5 }}>
              {t('pim.axis.hint')}
            </Typography>
          )}
          {errors.is_variant_axis && (
            <Alert severity="warning">{t(errors.is_variant_axis.message as MessageKey)}</Alert>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={watch('is_filterable')}
                disabled={!canWrite}
                onChange={(_, checked) => setValue('is_filterable', checked)}
              />
            }
            label={t('pim.field.filterable')}
          />

          <FormControlLabel
            control={
              <Switch
                checked={watch('is_active')}
                disabled={!canWrite}
                onChange={(_, checked) => setValue('is_active', checked)}
              />
            }
            label={t('pim.field.active')}
          />
        </Stack>
      </Box>

      <Divider sx={{ my: 3 }} />

      <AttributeValuesPanel
        attribute={attribute}
        values={values}
        canWrite={canWrite}
        isOption={isOption}
        onAdd={onAddValue}
      />
    </FormDrawer>
  )
}

/** Valores admitidos. Solo existen para el atributo de tipo lista. */
function AttributeValuesPanel({
  attribute,
  values,
  canWrite,
  isOption,
  onAdd,
}: {
  attribute: Attribute | null
  values: AttributeValue[]
  canWrite: boolean
  isOption: boolean
  onAdd: (values: AttributeValueFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [error, setError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AttributeValueFormValues>({
    resolver: zodResolver(attributeValueFormSchema),
    defaultValues: { code: '', label: '', is_active: true },
  })

  if (!isOption) {
    return (
      <Stack spacing={1}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
          {t('pim.values.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.values.only')}</Typography>
      </Stack>
    )
  }

  if (!attribute) {
    return (
      <Stack spacing={1}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
          {t('pim.values.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.attributes.saveFirst')}</Typography>
      </Stack>
    )
  }

  async function submit(formValues: AttributeValueFormValues) {
    setError(null)
    try {
      await onAdd(formValues)
      reset({ code: '', label: '', is_active: true })
    } catch (caught) {
      setError(caught instanceof CatalogError ? caught.key : 'catalog.error.generic')
    }
  }

  return (
    <Stack spacing={2}>
      <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
        {t('pim.values.title')}
      </Typography>

      {error && <Alert severity="error">{t(error)}</Alert>}

      {values.length === 0 ? (
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.values.empty')}</Typography>
      ) : (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {values.map((value) => (
            <StatusChip
              key={value.id}
              label={value.label}
              tone={value.is_active ? 'success' : 'default'}
            />
          ))}
        </Stack>
      )}

      {canWrite && (
        <Box component="form" onSubmit={handleSubmit(submit)} noValidate aria-label={t('pim.values.new')}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              label={t('pim.field.label')}
              fullWidth
              error={Boolean(errors.label)}
              helperText={errors.label ? t(errors.label.message as MessageKey) : undefined}
              {...register('label')}
            />
            <TextField
              size="small"
              label={t('pim.field.code')}
              fullWidth
              error={Boolean(errors.code)}
              helperText={errors.code ? t(errors.code.message as MessageKey) : undefined}
              inputProps={{ spellCheck: false }}
              {...register('code')}
            />
            <Button type="submit" variant="outlined" disabled={isSubmitting}>
              {t('common.add')}
            </Button>
          </Stack>
        </Box>
      )}
    </Stack>
  )
}
