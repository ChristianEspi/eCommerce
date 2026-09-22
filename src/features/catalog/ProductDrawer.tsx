import { useCopilotEntity } from '@/features/ai/copilot/copilot-context'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { useTaxCategories } from '@/features/admin/settings/taxes'
import {
  useAdjustInventory,
  useStoreWarehouses,
  useWarehouses,
} from '@/features/inventory/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { slugify } from '@/shared/lib/slug'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CatalogError } from './api/errors'
import { CategoryPicker } from './CategoryPicker'
import { ProductImagesPanel } from './ProductImagesPanel'
import { StorePublicationsPanel } from './StorePublicationsPanel'
import { BundlePanel } from './pim/BundlePanel'
import { ProductAttributesPanel } from './pim/ProductAttributesPanel'
import { RelationsPanel } from './pim/RelationsPanel'
import { UomsPanel } from './pim/UomsPanel'
import { VariantsPanel } from './pim/VariantsPanel'
import { useBrands, useFamilies } from './pim/hooks'
import { ProductAiAssistant } from './ProductAiAssistant'
import {
  categoryTree,
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  productFormSchema,
  productToForm,
  type Category,
  type PimProduct,
  type ProductCandidate,
  type ProductFormValues,
  type ProductKind,
  type ProductMaster,
  type ProductStatus,
} from './types'
import { useProductPublications, useSaveProduct } from './useProducts'

const STATUS_LABEL: Record<ProductStatus, MessageKey> = {
  draft: 'catalog.status.draft',
  published: 'catalog.status.published',
  archived: 'catalog.status.archived',
}

const KIND_LABEL: Record<ProductKind, MessageKey> = {
  simple: 'catalog.kind.simple',
  variant: 'catalog.kind.variant',
  bundle: 'catalog.kind.bundle',
}

/**
 * Alta y edición de producto en panel lateral.
 *
 * Hasta P02 esto eran ocho campos en una columna y el drawer no necesitaba
 * tabs. Con el PIM son seis asuntos distintos —datos, imágenes, variantes,
 * unidades, ficha técnica, componentes y relacionados— y un formulario
 * monolítico obligaría a bajar cuatro pantallas para llegar a lo que se vino a
 * cambiar. Se parte en pestañas (regla de suite §8; aquí sin deep-link `#hash`
 * porque el cajón vive DENTRO del listado y el hash ya es del listado).
 *
 * La barra de Guardar es persistente y guarda SOLO la pestaña General: las
 * demás escriben su propia fila al confirmar cada acción, porque una variante y
 * un producto son dos filas distintas y guardarlas juntas obligaría a inventar
 * una transacción en el cliente.
 *
 * Las tres pestañas del PIM se gatean por `catalog.advanced` (P02-SaaS). Es
 * cortesía, no seguridad: la autoridad son las policies.
 */
export function ProductDrawer({
  open,
  product,
  categories,
  products,
  organizationId,
  companyId,
  storeId,
  storeName,
  currency,
  canWrite,
  onClose,
}: {
  open: boolean
  /** Null = alta. */
  product: ProductMaster | null
  /** Categorías de la tienda ACTIVA: solo para la publicación inicial del alta. */
  categories: Category[]
  /** Catálogo cargado por el listado: candidatos de kit y de relacionados. */
  products: ProductCandidate[]
  organizationId: string
  companyId: string
  /** Tienda activa: contexto inicial del alta, nunca dueña del maestro. */
  storeId: string
  storeName: string
  currency: string
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  // El Copilot sabe qué producto está abierto (tipo + id; la RLS decide).
  useCopilotEntity('product', open ? product?.id : null)
  const { notify } = useFeedback()
  const save = useSaveProduct()
  const entrada = useAdjustInventory()
  const { has } = useCapabilities()
  const advanced = has('catalog.advanced')

  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [slugEdited, setSlugEdited] = useState(false)
  const [tab, setTab] = useState('general')
  const [almacenInicial, setAlmacenInicial] = useState('')

  const brands = useBrands(open && advanced)

  /*
   * El precio base que heredan variantes y presentaciones es el de la tienda de
   * ORIGEN mientras dure la transición (ADR 018). Sale de la misma consulta que
   * pinta la pestaña «Tiendas»; sin publicación de origen no hay precio que
   * heredar y los paneles pintan «—» en vez de inventarlo.
   */
  const publications = useProductPublications(open && product ? product.id : null)
  const origin =
    (publications.data ?? []).find((row) => row.is_origin && row.publication_id !== null) ?? null
  const pimProduct: PimProduct | null = product
    ? {
        id: product.id,
        sku: product.sku,
        name: product.name,
        kind: product.kind,
        price: origin?.price ?? null,
        currency: origin?.currency ?? origin?.store_currency ?? currency,
      }
    : null
  const families = useFamilies(open && advanced)

  // Las categorías fiscales las administra Configuración; aquí solo se elige
  // una. La marcada por defecto se nombra en la ayuda para que «vacío» no se
  // lea como «sin impuesto».
  const categoriasFiscales = useTaxCategories(open)
  const porDefecto = (categoriasFiscales.data ?? []).find((fila) => fila.is_default) ?? null

  /*
   * La existencia inicial, y por qué está aquí y no solo en Inventario.
   *
   * Con almacenes configurados, `ebim.atp` deja de mirar `products.stock` y
   * pasa a sumar `inventory_levels`. Un producto recién creado no tiene
   * ninguna fila ahí, así que nace con cero disponible y la vitrina lo pinta
   * «Sin stock» por mucho que el campo de arriba diga cuarenta. Quien lo da de
   * alta rellena el único campo que el formulario le ofrece y se encuentra un
   * producto que no se puede comprar, sin nada que se lo explique.
   *
   * Así que el alta pregunta EN QUÉ ALMACÉN entra, que es la pregunta real en
   * cuanto hay más de uno, y escribe la entrada al guardar.
   */
  const multialmacen = has('inventory.multiwarehouse')
  const enlaces = useStoreWarehouses(open && multialmacen ? storeId : null)
  const almacenes = useWarehouses(open && multialmacen)

  // Los que de verdad sirven a esta tienda, en orden de prioridad: es el mismo
  // criterio de `ebim.serving_warehouses`, así que el primero es el natural.
  const almacenesServidores = useMemo(() => {
    const porId = new Map((almacenes.data ?? []).map((w) => [w.id, w]))
    return (enlaces.data ?? [])
      .filter((enlace) => enlace.is_active)
      .map((enlace) => porId.get(enlace.warehouse_id))
      .filter((w): w is NonNullable<typeof w> => Boolean(w?.is_active))
  }, [enlaces.data, almacenes.data])

  const pideExistencia = product === null && almacenesServidores.length > 0

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productToForm(product),
  })

  // Al abrir con otro producto (o para un alta) el formulario se recarga
  // entero: reusar el estado anterior mostraría datos del producto anterior.
  useEffect(() => {
    if (!open) return
    reset(productToForm(product))
    setSlugEdited(Boolean(product))
    setServerError(null)
    setTab('general')
    setAlmacenInicial('')
  }, [open, product, reset])

  // El de mayor prioridad viene ya elegido: en una tienda con un solo almacén
  // preguntar sería un trámite, y con varios el primero es el que sirve antes.
  useEffect(() => {
    if (!almacenInicial && almacenesServidores.length > 0) {
      setAlmacenInicial(almacenesServidores[0]!.id)
    }
  }, [almacenesServidores, almacenInicial])

  async function onSubmit(values: ProductFormValues) {
    setServerError(null)
    try {
      const creado = await save.mutateAsync({ productId: product?.id ?? null, storeId, values })

      // La entrada va DESPUÉS y en su propio comando: `inventory_levels` no
      // tiene GRANT de escritura, se mueve con una función que anota el
      // movimiento en la misma transacción. Si esto falla, el producto YA
      // existe —visible y corregible desde Inventario—; al revés quedaría una
      // entrada de almacén sin producto al que pertenecer.
      const cantidad = Number(values.stock)
      if (pideExistencia && almacenInicial && cantidad > 0) {
        try {
          await entrada.mutateAsync({
            warehouse_id: almacenInicial,
            product_id: creado.id,
            variant_id: null,
            quantity: cantidad,
            kind: 'receipt',
            reason: t('catalog.stock.initialReason'),
          })
        } catch {
          notify(t('catalog.toast.saved'))
          setServerError('catalog.stock.seedFailed')
          return
        }
      }

      notify(t('catalog.toast.saved'))
      onClose()
    } catch (error) {
      // El drawer NO se cierra: lo escrito se queda donde está.
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  const fieldError = (key: keyof ProductFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  const busy = isSubmitting || save.isPending
  const kind = watch('kind')
  const publish = watch('publish')

  // La publicación en la tienda ACTIVA: es donde el asistente puede aplicar
  // una categoría (su comando y su validación, al pulsar).
  const publicacionActiva =
    (publications.data ?? []).find((row) => row.store_id === storeId && row.publication_id !== null) ??
    null

  // El árbol se arma una vez por lista de categorías, no en cada tecla del
  // formulario: son decenas de filas y el cajón repinta con cada carácter.
  const arbol = useMemo(() => categoryTree(categories), [categories])

  const tabs = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [
      { id: 'general', label: t('catalog.tab.general') },
      { id: 'tiendas', label: t('catalog.tab.stores') },
      { id: 'imagenes', label: t('catalog.tab.images') },
    ]
    if (advanced) {
      // Variantes y Componentes son excluyentes y dependen del tipo: enseñar
      // las dos siempre obligaría a explicar en cada una por qué está vacía.
      if (kind === 'variant') items.push({ id: 'variantes', label: t('catalog.tab.variants') })
      if (kind === 'bundle') items.push({ id: 'componentes', label: t('catalog.tab.bundle') })
      items.push(
        { id: 'unidades', label: t('catalog.tab.uoms') },
        { id: 'ficha', label: t('catalog.tab.attributes') },
        { id: 'relacionados', label: t('catalog.tab.related') },
      )
    }
    return items
  }, [advanced, kind, t])

  // Cambiar el tipo puede quitar la pestaña abierta (de kit a simple, por
  // ejemplo). Volver a General es preferible a dejar un panel en blanco.
  const active = tabs.some((item) => item.id === tab) ? tab : 'general'

  const scope = { organizationId, companyId, storeId, canWrite }

  return (
    <FormDrawer
      open={open}
      title={product ? t('catalog.products.edit') : t('catalog.products.new')}
      subtitle={product?.sku}
      onClose={onClose}
      busy={busy}
      width={640}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="product-form"
            variant="contained"
            disabled={busy || !canWrite}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Tabs
        value={active}
        onChange={(_, value: string) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={t('admin.products.title')}
        sx={{
          borderBottom: '1px solid var(--border)',
          mb: 3,
          '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 44 },
        }}
      >
        {tabs.map((item) => (
          <Tab key={item.id} value={item.id} label={item.label} />
        ))}
      </Tabs>

      {/* El formulario se MONTA siempre, aunque su pestaña no esté activa: si se
          desmontara, cambiar de pestaña perdería lo escrito sin avisar. Lo que
          cambia es su visibilidad. */}
      <Box
        component="form"
        id="product-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        hidden={active !== 'general'}
      >
        <Stack spacing={2.5}>
          {!canWrite && <Alert severity="info">{t('catalog.products.unauthorized')}</Alert>}
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <TextField
            label={t('catalog.field.name')}
            fullWidth
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
            label={t('catalog.field.sku')}
            fullWidth
            disabled={!canWrite}
            error={Boolean(errors.sku)}
            helperText={fieldError('sku') ?? t('catalog.master.skuHelp')}
            inputProps={{ spellCheck: false }}
            {...register('sku')}
          />

          <Stack sx={{ gap: 0.75 }}>
            <TextField
              label={t('catalog.field.description')}
              fullWidth
              multiline
              minRows={3}
              disabled={!canWrite}
              error={Boolean(errors.description)}
              helperText={fieldError('description') ?? t('common.optional')}
              {...register('description')}
            />

            {/* Solo al EDITAR: para sugerir hace falta un producto guardado del
                que leer nombre, marca, categoría y atributos con su RLS. En el
                alta no hay nada de eso todavía, y un botón que no puede
                funcionar es peor que un botón que no está. Las sugerencias NO
                guardan: nombre y descripción van al formulario y se guardan
                con «Guardar»; categoría y atributos, al pulsar «Aplicar». */}
            {product?.id && (
              <ProductAiAssistant
                // Fase 12: una sugerencia de OTRO producto no puede quedar
                // viva al cambiar de ficha y «Aplicarse» a esta.
                key={product.id}
                productId={product.id}
                storeId={storeId}
                canWrite={canWrite}
                disabled={busy}
                current={{ name: watch('name'), description: watch('description') }}
                publication={publicacionActiva}
                scope={{ organizationId, companyId, storeId }}
                onApplyText={(field, value) =>
                  setValue(field, value, { shouldDirty: true, shouldValidate: true })
                }
              />
            )}
          </Stack>

          {advanced && (
            <>
              <TextField
                select
                label={t('catalog.field.kind')}
                fullWidth
                disabled={!canWrite}
                value={kind}
                error={Boolean(errors.kind)}
                helperText={fieldError('kind') ?? t('catalog.kind.help')}
                {...register('kind')}
              >
                {PRODUCT_KINDS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(KIND_LABEL[value])}
                  </MenuItem>
                ))}
              </TextField>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label={t('catalog.field.brand')}
                  fullWidth
                  disabled={!canWrite}
                  value={watch('brand_id')}
                  {...register('brand_id')}
                >
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  {(brands.data ?? [])
                    .filter((brand) => brand.is_active)
                    .map((brand) => (
                      <MenuItem key={brand.id} value={brand.id}>
                        {brand.name}
                      </MenuItem>
                    ))}
                </TextField>

                <TextField
                  select
                  label={t('catalog.field.family')}
                  fullWidth
                  disabled={!canWrite}
                  value={watch('family_id')}
                  {...register('family_id')}
                >
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  {(families.data ?? [])
                    .filter((family) => family.is_active)
                    .map((family) => (
                      <MenuItem key={family.id} value={family.id}>
                        {family.name}
                      </MenuItem>
                    ))}
                </TextField>
              </Stack>
            </>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('catalog.field.stock')}
              fullWidth
              // Un maestro de variantes y un kit no llevan existencia propia:
              // el campo se bloquea en vez de aceptar un número que no decide
              // nada y que el operario del almacén leería como verdad.
              disabled={!canWrite || kind !== 'simple'}
              error={Boolean(errors.stock)}
              helperText={
                kind !== 'simple'
                  ? kind === 'variant'
                    ? t('pim.variants.help')
                    : t('pim.bundle.help')
                  : // Con almacenes, este número solo vale como carga inicial:
                    // a partir de ahí la disponibilidad la manda Inventario, y
                    // callarlo es lo que hace que alguien lo rellene y no pase
                    // nada en la vitrina.
                    (fieldError('stock') ??
                      (pideExistencia
                        ? t('catalog.stock.initialHelp')
                        : almacenesServidores.length > 0
                          ? t('catalog.stock.managedHelp')
                          : undefined))
              }
              inputProps={{ inputMode: 'numeric' }}
              {...register('stock')}
            />
          </Stack>

          {/* La tasa del producto, junto al precio y no en Configuración.
              El impuesto se piensa cuando se pone el precio —«¿este va con IGV
              o está exonerado?»— y hasta ahora no había dónde decirlo: la
              columna existía y el catálogo entero caía en la categoría por
              defecto de la sociedad.

              Vacío NO es «sin impuesto», es «la de siempre», y el texto de
              ayuda lo dice con el nombre de la que se aplicaría: dejar que
              alguien lo lea como exento sería la peor forma de equivocarse. */}
          <TextField
            select
            label={t('catalog.field.taxCategory')}
            fullWidth
            disabled={!canWrite}
            // `displayEmpty` y no el hueco en blanco de «Marca» o «Familia»:
            // ahí vacío se lee bien como «ninguna», pero un campo de impuesto en
            // blanco se lee como «no lleva», que es lo contrario de lo que pasa.
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
            value={watch('tax_category_id')}
            helperText={
              porDefecto
                ? `${t('catalog.field.taxCategory.help')} ${porDefecto.name}`
                : t('catalog.field.taxCategory.help')
            }
            {...register('tax_category_id')}
          >
            <MenuItem value="">{t('catalog.field.taxCategory.default')}</MenuItem>
            {(categoriasFiscales.data ?? []).map((categoria) => (
              <MenuItem key={categoria.id} value={categoria.id}>
                {categoria.name}
              </MenuItem>
            ))}
          </TextField>

          {/* En qué almacén entra. Solo al dar de alta: después, la existencia
              se mueve desde Inventario con su movimiento y su motivo. */}
          {pideExistencia && kind === 'simple' && (
            <TextField
              select
              label={t('catalog.stock.warehouse')}
              fullWidth
              disabled={!canWrite}
              value={almacenInicial}
              onChange={(event) => setAlmacenInicial(event.target.value)}
              helperText={t('catalog.stock.warehouseHelp')}
            >
              {almacenesServidores.map((almacen) => (
                <MenuItem key={almacen.id} value={almacen.id}>
                  {almacen.code} · {almacen.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* La publicación INICIAL, solo en el alta y en la tienda activa. Es
              contexto, no propiedad: el producto es de la sociedad, y el resto
              de tiendas se decide después en «Tiendas». Al editar no aparece:
              precio, dirección y estado de cada tienda viven en su tarjeta. */}
          {product === null && (
            <Box
              component="fieldset"
              sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 2, m: 0 }}
            >
              <Typography component="legend" sx={{ px: 0.5, fontWeight: 700, fontSize: 14 }}>
                {t('catalog.master.initialPublication')}
              </Typography>
              <Stack spacing={2}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={publish}
                      disabled={!canWrite}
                      onChange={(event) =>
                        setValue('publish', event.target.checked, { shouldValidate: false })
                      }
                    />
                  }
                  label={t('catalog.master.publishIn').replace('{store}', storeName)}
                />

                {publish ? (
                  <>
                    <TextField
                      label={t('catalog.field.slug')}
                      fullWidth
                      disabled={!canWrite}
                      error={Boolean(errors.slug)}
                      helperText={fieldError('slug') ?? t('catalog.field.slug.help')}
                      inputProps={{ spellCheck: false }}
                      {...register('slug', { onChange: () => setSlugEdited(true) })}
                    />

                    {/* Con RUTA y agrupado por su raíz: dos «Cuidado» sueltos no
                        se distinguen. Solo las categorías de ESTA tienda. */}
                    <CategoryPicker
                      label={t('catalog.field.category')}
                      nodes={arbol}
                      value={watch('category_id')}
                      onChange={(next) => setValue('category_id', next, { shouldValidate: true })}
                      noneLabel={t('common.none')}
                      disabled={!canWrite}
                      error={Boolean(errors.category_id)}
                      helperText={fieldError('category_id')}
                    />

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField
                        label={t('catalog.field.price')}
                        fullWidth
                        disabled={!canWrite}
                        error={Boolean(errors.price)}
                        helperText={fieldError('price')}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">{currency}</InputAdornment>,
                        }}
                        inputProps={{ inputMode: 'decimal' }}
                        {...register('price')}
                      />
                      <TextField
                        select
                        label={t('catalog.field.status')}
                        fullWidth
                        disabled={!canWrite}
                        value={watch('status')}
                        error={Boolean(errors.status)}
                        helperText={fieldError('status')}
                        {...register('status')}
                      >
                        {PRODUCT_STATUSES.map((status) => (
                          <MenuItem key={status} value={status}>
                            {t(STATUS_LABEL[status])}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Stack>
                  </>
                ) : (
                  <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
                    {t('catalog.master.noPublicationHelp')}
                  </Typography>
                )}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>

      {active === 'tiendas' && (
        <StorePublicationsPanel
          productId={product?.id ?? null}
          productName={product?.name ?? ''}
          canWrite={canWrite}
        />
      )}

      {active === 'imagenes' && (
        <ProductImagesPanel
          organizationId={organizationId}
          companyId={companyId}
          storeId={storeId}
          productId={product?.id ?? null}
          canWrite={canWrite}
        />
      )}

      {/* Variantes y presentaciones son del MAESTRO: publicar en otra tienda
          no las copia. Su precio propio, en cambio, es el de la tienda de
          origen; las demás tiendas usan su lista o su precio de publicación. */}
      {(active === 'variantes' || active === 'unidades') && product && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {origin
            ? t('catalog.master.pimPriceScope').replace('{store}', origin.store_name)
            : t('catalog.master.pimNoOrigin')}
        </Alert>
      )}
      {active === 'variantes' && <VariantsPanel product={pimProduct} {...scope} />}
      {active === 'componentes' && (
        <BundlePanel product={pimProduct} products={products} {...scope} />
      )}
      {active === 'unidades' && <UomsPanel product={pimProduct} {...scope} />}
      {active === 'ficha' && <ProductAttributesPanel product={pimProduct} {...scope} />}
      {active === 'relacionados' && (
        <RelationsPanel product={pimProduct} products={products} {...scope} />
      )}
    </FormDrawer>
  )
}
