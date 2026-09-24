import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, FormControlLabel, Stack, Switch, TextField } from '@mui/material'
import { useEffect, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { slugify } from '@/shared/lib/slug'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CatalogError } from './api/errors'
import { CategoryImageField } from './CategoryImageField'
import { CategoryPicker } from './CategoryPicker'
import {
  categoryDescendants,
  categoryFormSchema,
  categoryToForm,
  categoryTree,
  type Category,
  type CategoryFormValues,
} from './types'
import { useSaveCategory } from './useCategories'

/**
 * CRUD de categoría: nombre, dirección, madre y si se ve en la vitrina.
 *
 * ## El desplegable de madre no ofrece lo que la base va a rechazar
 *
 * Se excluyen la propia categoría y toda su descendencia —eso sería un ciclo— y
 * las que ya están a la profundidad máxima, porque colgar de ellas crearía un
 * cuarto nivel. La base lo rechaza igual (`CATEGORIA_CICLO`,
 * `CATEGORIA_PROFUNDIDAD`): esto no es la validación, es no ofrecer una opción
 * que se sabe que va a fallar.
 *
 * Las opciones llevan su RUTA completa («Salud › Sistema nervioso») y no solo
 * su nombre: en una lista de treinta, dos «Cuidado» sueltos no se distinguen.
 */
export function CategoryDrawer({
  open,
  category,
  categories,
  organizationId,
  companyId,
  storeId,
  canWrite,
  onClose,
}: {
  open: boolean
  category: Category | null
  /** Todas las de la tienda: de aquí sale el desplegable de madre. */
  categories: Category[]
  organizationId: string
  companyId: string
  storeId: string
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const save = useSaveCategory()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [slugEdited, setSlugEdited] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: categoryToForm(category),
  })

  useEffect(() => {
    if (!open) return
    reset(categoryToForm(category))
    setSlugEdited(Boolean(category))
    setServerError(null)
  }, [open, category, reset])

  async function onSubmit(values: CategoryFormValues) {
    setServerError(null)
    try {
      await save.mutateAsync({
        categoryId: category?.id ?? null,
        organizationId,
        companyId,
        storeId,
        values,
      })
      notify(t('catalog.toast.categorySaved'))
      onClose()
    } catch (error) {
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  const fieldError = (key: keyof CategoryFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  const busy = isSubmitting || save.isPending

  // Tres niveles es el tope de la base: una categoría que ya está en el segundo
  // puede ser madre; una que está en el tercero, no.
  const blocked = category ? categoryDescendants(categories, category.id) : new Set<string>()
  const parents = categoryTree(categories).filter(
    (node) => node.depth < 2 && !blocked.has(node.category.id),
  )

  return (
    <FormDrawer
      open={open}
      title={category ? t('catalog.categories.edit') : t('catalog.categories.new')}
      onClose={onClose}
      busy={busy}
      width={440}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="category-form"
            variant="contained"
            disabled={busy || !canWrite}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="category-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2.5}>
          {!canWrite && <Alert severity="info">{t('catalog.products.unauthorized')}</Alert>}
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <TextField
            label={t('catalog.field.name')}
            fullWidth
            autoFocus
            disabled={!canWrite}
            error={Boolean(errors.name)}
            helperText={fieldError('name')}
            {...register('name', {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                if (!slugEdited) setValue('slug', slugify(event.target.value))
              },
            })}
          />

          <TextField
            label={t('catalog.field.slug')}
            fullWidth
            disabled={!canWrite}
            error={Boolean(errors.slug)}
            helperText={fieldError('slug') ?? t('catalog.field.slug.help')}
            inputProps={{ spellCheck: false }}
            {...register('slug', { onChange: () => setSlugEdited(true) })}
          />

          {/* La foto va DESPUÉS del nombre a propósito: el icono de respaldo se
              deriva del nombre, así que enseñarlo antes de tenerlo sería enseñar
              el genérico y cambiarlo delante de quien escribe. */}
          <CategoryImageField
            name={watch('name')}
            imageUrl={watch('image_url')}
            imageAlt={watch('image_alt')}
            organizationId={organizationId}
            storeId={storeId}
            disabled={!canWrite}
            onChangeImage={(next) => setValue('image_url', next, { shouldDirty: true })}
            onChangeAlt={(next) => setValue('image_alt', next, { shouldDirty: true })}
          />

          <CategoryPicker
            label={t('catalog.categories.parent')}
            nodes={parents}
            value={watch('parent_id')}
            onChange={(next) => setValue('parent_id', next)}
            noneLabel={t('catalog.categories.parentNone')}
            disabled={!canWrite}
            helperText={t('catalog.categories.parentHelp')}
          />

          <FormControlLabel
            control={
              <Switch
                checked={watch('is_active')}
                disabled={!canWrite}
                onChange={(_, checked) => setValue('is_active', checked)}
              />
            }
            label={t('catalog.categories.isActive')}
          />
        </Stack>
      </Box>
    </FormDrawer>
  )
}
