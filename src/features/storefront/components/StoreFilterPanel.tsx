import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  FormControlLabel,
  InputAdornment,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import { TS } from '@/theme/tokens'

export interface FacetOption {
  /** Slug de categoría o código de marca. `null` no se pinta: no se puede filtrar por nada. */
  code: string | null
  name: string | null
  /**
   * `null` = no se sabe, y entonces NO se enseña número.
   *
   * Hace falta porque el buscador calcula las facetas sobre el resultado YA
   * filtrado: en cuanto hay una categoría elegida, las demás salen a cero. Un
   * cero ahí no significa «no hay nada», significa «no te lo he contado», y
   * pintarlo haría que el panel mintiera justo cuando más se mira.
   */
  count: number | null
}

/** Cuántas opciones se ven antes de «mostrar todo». */
const VISIBLE = 8

/**
 * Panel de filtros de la vitrina.
 *
 * **Esto NO contradice la regla de suite «un buscador general, no paneles de
 * filtros multi-campo».** Esa regla es del BACKOFFICE, donde quien trabaja
 * conoce el dato que busca y una fila de seis cajas solo le hace adivinar cuál
 * rellenar. Aquí el visitante no sabe qué hay en el catálogo: las facetas son
 * la forma de enseñárselo, y por eso cada opción lleva su CONTADOR — un filtro
 * que no dice cuántos resultados deja es una apuesta a ciegas.
 *
 * Las opciones salen de las facetas que devuelve el buscador con la consulta
 * actual, no de una lista fija de marcas y categorías. Es lo que evita el
 * callejón sin salida clásico: marcar un filtro y llegar a cero resultados.
 * Aquí lo que da cero ni siquiera aparece.
 *
 * El estado vive en la URL (lo pone quien usa el panel, no el panel): una
 * búsqueda filtrada se comparte y el botón de atrás hace lo que se espera.
 */
export function StoreFilterPanel({
  brands,
  categories,
  selectedBrands,
  selectedCategory,
  inStockOnly,
  discountedOnly,
  priceMin = null,
  priceMax = null,
  priceBounds = null,
  onPrice,
  onBrand,
  onCategory,
  onInStock,
  onDiscounted,
  onClear,
  marco = 'tarjeta',
  currencySymbol = '',
}: {
  brands: readonly FacetOption[]
  categories: readonly FacetOption[]
  /**
   * Las marcas marcadas: VARIAS a la vez (se suman con «o»).
   *
   * Quien compra para una clínica compara Tecnofarma con Quilab; obligarlo a
   * elegir una sola era obligarlo a mirar el catálogo dos veces.
   */
  selectedBrands: readonly string[]
  selectedCategory: string | null
  /** Rango de precio puesto, como texto (es dinero). */
  priceMin?: string | null
  priceMax?: string | null
  /** Lo más barato y lo más caro del resultado: pistas, no límites. */
  priceBounds?: { min: string | null; max: string | null } | null
  onPrice?: (min: string | null, max: string | null) => void
  inStockOnly: boolean
  /**
   * Solo lo rebajado.
   *
   * Va con «solo disponibles» y no con las marcas a proposito: las dos son
   * ESTADOS del producto —cambian solos, los produce un dato— y no atributos de
   * identidad. «En oferta» como categoria obligaria a mover productos de
   * familia cada semana, y ademas depende de quien mira: con listas por
   * segmento, un mayorista y un visitante anonimo no ven las mismas rebajas.
   */
  discountedOnly: boolean
  /** Marca o desmarca UNA marca; la lista la mantiene quien usa el panel. */
  onBrand: (code: string) => void
  onCategory: (slug: string | null) => void
  onInStock: (only: boolean) => void
  onDiscounted: (only: boolean) => void
  onClear: () => void
  /**
   * Cómo se enmarca el panel (Storefront V3 · P09).
   *
   * `tarjeta` es el de siempre. `columna` le quita la caja: una tarjeta con
   * sombra al lado de la rejilla se lee como un panel de backoffice pegado a una
   * tienda, y lo que separa una columna de filtros de los resultados es una
   * línea fina y aire, no un recuadro flotante. `hoja` es para dentro del cajón
   * del teléfono, donde el diálogo ya pone el marco, el título y el cierre —
   * repetirlos ahí sería anunciar dos veces la misma región.
   */
  marco?: 'tarjeta' | 'columna' | 'hoja'
  /** Resumen v2 · El símbolo de la moneda de la tienda, delante de las cajas de precio. */
  currencySymbol?: string
}) {
  const { t } = useI18n()
  const dirty = Boolean(
    selectedBrands.length > 0 || selectedCategory || inStockOnly || discountedOnly || priceMin || priceMax,
  )
  const enCajon = marco === 'hoja'
  const conCaja = marco === 'tarjeta'
  // Resumen v2 · Cuántos filtros hay puestos, para «Limpiar (3)».
  const activos =
    selectedBrands.length +
    (selectedCategory ? 1 : 0) +
    (inStockOnly ? 1 : 0) +
    (discountedOnly ? 1 : 0) +
    (priceMin || priceMax ? 1 : 0)
  // El buscador de marcas solo aparece cuando hay tantas que hace falta buscar.
  const [busquedaMarca, setBusquedaMarca] = useState('')
  const marcasVisibles = busquedaMarca.trim()
    ? brands.filter((option) =>
        (option.name ?? option.code ?? '').toLocaleLowerCase().includes(busquedaMarca.trim().toLocaleLowerCase()),
      )
    : brands

  return (
    <Card
      component={enCajon ? 'div' : 'aside'}
      // Dentro del cajón el nombre accesible lo pone el diálogo.
      {...(enCajon ? {} : { 'aria-label': t('store.catalog.filters') })}
      data-filter-frame={marco}
      sx={{
        p: conCaja ? 2.25 : 0,
        ...(conCaja
          ? {
              borderRadius: 'var(--sf-radius)',
              border: '1px solid var(--sf-line)',
              boxShadow: 'var(--sf-shadow)',
            }
          : {
              borderRadius: 0,
              border: 'none',
              boxShadow: 'none',
              bgcolor: 'transparent',
            }),
        // La línea vertical solo en la columna de escritorio: es lo que separa
        // los filtros de los resultados sin dibujar una caja alrededor.
        ...(marco === 'columna' ? { pr: { md: 2.5 }, borderRight: { md: '1px solid var(--sf-line)' } } : {}),
        // Y dentro del cajón no se pega a nada: el cajón ya se desplaza solo.
        ...(enCajon ? {} : { position: { md: 'sticky' }, top: { md: 88 } }),
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 1,
          // El título sobra dentro del cajón, que ya lo lleva en su cabecera.
          ...(enCajon ? { display: dirty ? 'flex' : 'none' } : {}),
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            ...(enCajon ? visuallyHidden : {}),
          }}
        >
          {t('store.filter.heading')}
        </Typography>
        {/* Solo cuando hay algo que quitar: un botón que no hace nada enseña a
            no pulsarlo. Y nunca dentro del cajón del teléfono, que ya lo lleva
            en su pie: dos botones con el mismo nombre en la misma pantalla no
            se distinguen ni con el ratón ni con un lector. */}
        {dirty && !enCajon && (
          <Button
            size="small"
            onClick={onClear}
            sx={{ textTransform: 'none', fontWeight: 800, color: 'var(--accent-deep)', minWidth: 0, px: 0.5 }}
          >
            {t('store.filter.clearCount').replace('{n}', String(activos))}
          </Button>
        )}
      </Stack>

      {/* Lo rebajado, primero: es con lo que entra quien viene a por ofertas, y
          hasta ahora no habia forma de pedirlo — el enlace «Ofertas» llevaba al
          carrusel de campanas, que es otra cosa, y el «Ver todo» de la banda
          soltaba al visitante en el catalogo entero justo perdiendo la oferta
          que acababa de mirar. */}
      <ToggleRow
        icon={<LocalOfferOutlinedIcon sx={{ fontSize: 18 }} />}
        label={t('store.filter.discounted')}
        checked={discountedOnly}
        onChange={onDiscounted}
      />
      <ToggleRow
        icon={<Inventory2OutlinedIcon sx={{ fontSize: 18 }} />}
        label={t('store.filter.inStock')}
        checked={inStockOnly}
        onChange={onInStock}
      />

      {onPrice ? (
        <PriceRange
          min={priceMin}
          max={priceMax}
          bounds={priceBounds}
          onApply={onPrice}
          currencySymbol={currencySymbol}
        />
      ) : null}

      <FacetGroup
        title={t('store.filter.brand')}
        header={
          brands.length > VISIBLE ? (
            <TextField
              size="small"
              fullWidth
              value={busquedaMarca}
              onChange={(event) => setBusquedaMarca(event.target.value)}
              placeholder={t('store.filter.brandSearch')}
              slotProps={{
                htmlInput: { 'aria-label': t('store.filter.brandSearch') },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon sx={{ fontSize: 18, color: 'var(--muted)' }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ my: 0.75 }}
            />
          ) : null
        }
      >
        {marcasVisibles.map((option) => (
          <FacetRow
            key={option.code ?? option.name ?? ''}
            option={option}
            checked={option.code !== null && selectedBrands.includes(option.code)}
            onToggle={() => option.code && onBrand(option.code)}
          />
        ))}
      </FacetGroup>

      <FacetGroup title={t('store.filter.category')}>
        {categories.map((option) => (
          <FacetRow
            key={option.code ?? option.name ?? ''}
            option={option}
            checked={selectedCategory === option.code}
            onToggle={() => onCategory(selectedCategory === option.code ? null : option.code)}
          />
        ))}
      </FacetGroup>
    </Card>
  )
}

/**
 * Un grupo plegable con su lista recortada.
 *
 * Con más de ocho opciones se recorta y aparece «mostrar todo»: una barra
 * lateral de cuarenta marcas empuja el catálogo fuera de la pantalla, que es
 * justo lo que la persona vino a mirar.
 */
/**
 * Resumen v2 · Un interruptor como en el diseño: icono, texto y el interruptor
 * a la derecha. La fila entera es la etiqueta, así que se pulsa en cualquier
 * parte; el nombre accesible del interruptor es el texto.
 */
function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: ReactNode
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Stack
      component="label"
      direction="row"
      sx={{ alignItems: 'center', gap: 1, py: 0.375, cursor: 'pointer' }}
    >
      <Box aria-hidden sx={{ display: 'grid', color: 'var(--accent-deep)' }}>
        {icon}
      </Box>
      <Typography sx={{ flex: 1, fontSize: TS.body, fontWeight: 700 }}>{label}</Typography>
      <Switch
        size="small"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        inputProps={{ 'aria-label': label }}
      />
    </Stack>
  )
}

function FacetGroup({ title, children, header }: { title: string; children: ReactNode; header?: ReactNode }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)

  const items = Array.isArray(children) ? (children as ReactNode[]).filter(Boolean) : [children]
  if (items.length === 0 && !header) return null

  const shown = all ? items : items.slice(0, VISIBLE)

  return (
    <Box sx={{ borderTop: '1px solid var(--sf-line)', pt: 1.5, mt: 1.5 }}>
      <Stack
        component="button"
        type="button"
        direction="row"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        sx={{
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 0,
          p: 0,
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <Typography
          component="h3"
          sx={{
            fontSize: TS.label,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}
        >
          {title}
        </Typography>
        {open ? (
          <ExpandLessRoundedIcon sx={{ fontSize: 20, color: 'var(--muted)' }} />
        ) : (
          <ExpandMoreRoundedIcon sx={{ fontSize: 20, color: 'var(--muted)' }} />
        )}
      </Stack>

      <Collapse in={open} unmountOnExit>
        {header}
        <Stack sx={{ mt: 0.5 }}>{shown}</Stack>
        {items.length > VISIBLE && (
          <Button
            size="small"
            onClick={() => setAll((value) => !value)}
            sx={{ mt: 0.5, textTransform: 'none', fontWeight: 800, px: 0 }}
          >
            {all ? t('store.filter.showLess') : t('store.filter.showAll')}
          </Button>
        )}
      </Collapse>
    </Box>
  )
}

/**
 * Una opción con su contador.
 *
 * El número va SIEMPRE, y por eso es texto y no un adorno: es la diferencia
 * entre elegir un filtro y adivinarlo. Va dentro del `label` de la casilla para
 * que un lector de pantalla anuncie «Sillas, 20» y no solo «Sillas».
 */
function FacetRow({
  option,
  checked,
  onToggle,
}: {
  option: FacetOption
  checked: boolean
  onToggle: () => void
}) {
  if (!option.code) return null

  return (
    <FormControlLabel
      sx={{ ml: -0.75, mr: 0, '& .MuiFormControlLabel-label': { minWidth: 0, flex: 1 } }}
      control={<Checkbox size="small" checked={checked} onChange={onToggle} />}
      label={
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography
            sx={{
              flex: 1,
              fontSize: TS.body,
              fontWeight: checked ? 800 : 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {option.name ?? option.code}
          </Typography>
          {option.count !== null && (
            <Typography className="tnum" sx={{ fontSize: TS.label, color: 'var(--muted)', flexShrink: 0 }}>
              {option.count}
            </Typography>
          )}
        </Stack>
      }
    />
  )
}

/**
 * Rango de precio: «desde» y «hasta», y se aplica al pulsar.
 *
 * Dos cajas y no un deslizador: con un deslizador no se escribe «150», se
 * arrastra hasta acercarse, y en un teléfono es imposible dar con la cifra.
 * Las pistas son lo más barato y lo más caro de lo que hay AHORA en pantalla.
 *
 * Se aplica con el botón (o Enter), no a cada tecla: cada cambio es una
 * consulta nueva al buscador, y escribir «1-5-0» serían tres.
 */
function PriceRange({
  min,
  max,
  bounds,
  onApply,
  currencySymbol,
}: {
  min: string | null
  max: string | null
  bounds: { min: string | null; max: string | null } | null
  onApply: (min: string | null, max: string | null) => void
  currencySymbol: string
}) {
  const { t } = useI18n()
  const [desde, setDesde] = useState(min ?? '')
  const [hasta, setHasta] = useState(max ?? '')
  // Si el filtro cambia desde fuera (un chip, «quitar filtros»), las cajas lo siguen.
  useEffect(() => setDesde(min ?? ''), [min])
  useEffect(() => setHasta(max ?? ''), [max])

  const limpio = (valor: string) => {
    const numero = Number(valor.replace(',', '.'))
    return valor.trim() !== '' && Number.isFinite(numero) && numero >= 0 ? String(numero) : null
  }
  const aplicar = (d = desde, h = hasta) => {
    // Solo si cambió: salir de la caja sin tocarla no es una consulta nueva.
    if (limpio(d) === (min ?? null) && limpio(h) === (max ?? null)) return
    onApply(limpio(d), limpio(h))
  }
  // Resumen v2 · El deslizador, entre lo más barato y lo más caro del resultado.
  const piso = bounds?.min ? Math.floor(Number(bounds.min)) : null
  const techo = bounds?.max ? Math.ceil(Number(bounds.max)) : null
  const conDeslizador = piso !== null && techo !== null && techo > piso

  return (
    <Box sx={{ borderTop: '1px solid var(--sf-line)', pt: 1.5, mt: 1.5 }}>
      <Typography
        component="h3"
        sx={{
          fontSize: TS.label,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          mb: 1,
        }}
      >
        {t('store.filter.price')}
      </Typography>
      {conDeslizador ? (
        <Box sx={{ px: 1 }}>
          <Slider
            size="small"
            min={piso}
            max={techo}
            value={[
              limpio(desde) !== null ? Number(limpio(desde)) : piso,
              limpio(hasta) !== null ? Number(limpio(hasta)) : techo,
            ]}
            onChange={(_, valor) => {
              const [a, b] = valor as number[]
              setDesde(a === piso ? '' : String(a))
              setHasta(b === techo ? '' : String(b))
            }}
            onChangeCommitted={(_, valor) => {
              const [a, b] = valor as number[]
              aplicar(a === piso ? '' : String(a), b === techo ? '' : String(b))
            }}
            getAriaLabel={(indice) => (indice === 0 ? t('store.filter.priceMin') : t('store.filter.priceMax'))}
            disableSwap
          />
        </Box>
      ) : null}
      <Stack
        component="form"
        direction="row"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault()
          aplicar()
        }}
        sx={{ gap: 0.75, alignItems: 'center' }}
      >
        <Field
          size="small"
          rule="money"
          value={desde}
          onChange={(event) => setDesde(event.target.value)}
          onBlur={() => aplicar()}
          placeholder={piso !== null ? String(piso) : ''}
          slotProps={{
            htmlInput: { inputMode: 'decimal', 'aria-label': t('store.filter.priceMin') },
            input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> },
          }}
        />
        <Field
          size="small"
          rule="money"
          value={hasta}
          onChange={(event) => setHasta(event.target.value)}
          onBlur={() => aplicar()}
          placeholder={techo !== null ? String(techo) : ''}
          slotProps={{
            htmlInput: { inputMode: 'decimal', 'aria-label': t('store.filter.priceMax') },
            input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> },
          }}
        />
        {/* Enter aplica; el botón queda para el lector de pantalla y el teclado. */}
        <Box component="button" type="submit" sx={visuallyHidden}>
          {t('store.filter.priceApply')}
        </Box>
      </Stack>
    </Box>
  )
}
