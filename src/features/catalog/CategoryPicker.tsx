import { Autocomplete, Box, TextField, Typography } from '@mui/material'
import type { CategoryNode } from './types'

/**
 * Elegir una categoría de un árbol de decenas.
 *
 * ## Por qué no un desplegable a secas
 *
 * Antes era un `select` con todas las categorías seguidas y la jerarquía
 * sostenida por catorce píxeles de sangría. Con cuarenta filas eso no se lee:
 * el desplegable tapaba el cajón entero, «Medicamentos» y sus quince hijas
 * parecían el mismo nivel, y para llegar a la de abajo había que recorrerlas
 * todas con la vista. Aquí se ESCRIBE y la lista se reduce sola.
 *
 * ## Tres cosas dicen dónde estás
 *
 *  · una **cabecera fija** con la raíz, que se queda pegada arriba mientras se
 *    recorre su descendencia — con quince hermanas seguidas, saber de quién
 *    cuelgan sin volver a subir es la mitad del problema;
 *  · la **sangría** dentro del grupo, para el tercer nivel;
 *  · y en el tercer nivel, además, **de qué madre cuelga**, porque «Dispositivos
 *    y materiales médicos» no dice por sí solo que esté bajo «Hematológicos».
 *
 * ## Y el campo cerrado enseña la RUTA
 *
 * No el nombre suelto. Un producto clasificado en «Cuidado de la piel» no dice
 * nada; «Cuidado personal › Cuidado de la piel» sí. Buscar también usa la ruta,
 * así que escribir la madre saca a todas sus hijas.
 *
 * Cualquier nivel se puede elegir, igual que antes: hay productos que van en la
 * raíz. Lo que cambia es lo que se ve, no lo que se puede.
 */
export function CategoryPicker({
  label,
  nodes,
  value,
  onChange,
  noneLabel,
  disabled = false,
  error = false,
  helperText,
  size = 'medium',
}: {
  label: string
  /** Ya aplanado por `categoryTree`, en orden de lectura. */
  nodes: readonly CategoryNode[]
  /** Id de la categoría, o cadena vacía si no hay ninguna. */
  value: string
  onChange: (next: string) => void
  /** Lo que se lee cuando no hay ninguna elegida: «Sin asignar», «Sin madre». */
  noneLabel: string
  disabled?: boolean
  error?: boolean
  helperText?: string
  /**
   * `medium` en un cajón de edición, donde todos los campos miden lo mismo;
   * `small` en una barra de filtros, por el mismo motivo. Un control más alto
   * que los de al lado no se lee como un control distinto, se lee como algo
   * descuadrado.
   */
  size?: 'small' | 'medium'
}) {
  const elegido = nodes.find((node) => node.category.id === value) ?? null

  /** La raíz de la que cuelga, que es como se agrupa la lista. */
  const raizDe = (node: CategoryNode) => node.path.split(' › ')[0] ?? node.category.name

  return (
    <Autocomplete<CategoryNode, false, false, false>
      options={nodes as CategoryNode[]}
      value={elegido}
      onChange={(_, node) => onChange(node?.category.id ?? '')}
      size={size}
      groupBy={raizDe}
      // La RUTA, no el nombre: es lo que se enseña al cerrar y contra lo que
      // busca el filtro, así que escribir «medicamentos» saca a toda su rama.
      getOptionLabel={(node) => node.path}
      isOptionEqualToValue={(node, elegida) => node.category.id === elegida.category.id}
      disabled={disabled}
      slotProps={{ listbox: { sx: { maxHeight: 340, py: 0 } } }}
      renderGroup={(params) => (
        <Box component="li" key={params.key}>
          <Typography
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              px: 1.5,
              py: 0.75,
              bgcolor: 'var(--card)',
              borderBottom: '1px solid var(--border)',
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}
          >
            {params.group}
          </Typography>
          <Box component="ul" sx={{ p: 0, m: 0, listStyle: 'none' }}>
            {params.children}
          </Box>
        </Box>
      )}
      renderOption={(props, node) => {
        const { key, ...rest } = props as typeof props & { key?: string }
        // Del tercer nivel en adelante, la madre. La raíz ya la dice la
        // cabecera del grupo, así que repetirla sería ruido.
        const madre = node.depth >= 2 ? node.path.split(' › ').slice(1, -1).join(' › ') : null
        return (
          <Box
            component="li"
            key={key ?? node.category.id}
            {...rest}
            sx={{
              display: 'block',
              px: 1.5,
              py: 0.75,
              pl: 1.5 + node.depth * 2,
              '&[aria-selected="true"]': { bgcolor: 'var(--accent-soft)' },
            }}
          >
            <Typography
              sx={{ fontSize: 13.5, fontWeight: node.depth === 0 ? 700 : 500 }}
            >
              {node.category.name}
            </Typography>
            {madre && (
              <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{madre}</Typography>
            )}
          </Box>
        )
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          // Vacío se lee «Sin asignar» en vez de quedarse en blanco, que no
          // distingue «ninguna» de «todavía no lo he mirado».
          placeholder={noneLabel}
          fullWidth
          error={error}
          helperText={helperText}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )}
    />
  )
}
