import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { Box, Paper, Popper, Stack, Typography } from '@mui/material'
import type { Locale } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { R, TS } from '@/theme/tokens'

/**
 * La lista de sugerencias del buscador de la cabecera (Storefront V2 · P14).
 *
 * ## Por qué vive en su propio archivo
 *
 * Para poder llegar por `lazy`. El panel arrastra `Popper` —con su motor de
 * posicionamiento— y es **ocho kilobytes gzip** que hasta P14 descargaba toda
 * visita a la tienda, incluidas las que nunca escriben nada en el buscador.
 *
 * Y no se nota al usarlo: el panel solo aparece con dos caracteres escritos, y
 * para entonces ya hay un rebote de 250 ms y una consulta de catálogo en vuelo.
 * El módulo viaja en paralelo con esa consulta, que es más lenta que él.
 *
 * ## Lo que NO se movió
 *
 * El `combobox` —la caja, su `aria-controls`, su `aria-activedescendant` y el
 * teclado— se queda en el componente de siempre. Es lo que un lector de
 * pantalla anuncia al enfocar la cabecera, y no puede depender de que haya
 * terminado de llegar un módulo. Por eso el identificador de la lista llega
 * como prop: lo declara quien lo referencia.
 */

/** Un resultado, tal y como lo entrega la búsqueda de catálogo. */
export interface QuickHit {
  readonly productId: string
  readonly slug: string
  readonly name: string
  readonly categoryName: string | null
  readonly imagePath: string | null
  readonly imageAlt: string | null
  readonly price: string | number | null
  readonly currency: string | null
}

export function QuickSearchPanel({
  open,
  anchorEl,
  listId,
  hits,
  thumbnails,
  cursor,
  loading,
  locale,
  emptyLabel,
  loadingLabel,
  seeAllLabel,
  onHover,
  onPick,
  onSeeAll,
}: {
  open: boolean
  anchorEl: HTMLElement | null
  listId: string
  hits: readonly QuickHit[]
  thumbnails: Record<string, string>
  cursor: number
  loading: boolean
  locale: Locale
  emptyLabel: string
  loadingLabel: string
  seeAllLabel: string
  onHover: (index: number) => void
  onPick: (slug: string) => void
  onSeeAll: () => void
}) {
  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="bottom-start"
      style={{ zIndex: 1300, width: anchorEl?.offsetWidth }}
    >
      <Paper
        elevation={0}
        sx={{
          mt: 0.5,
          border: '1px solid var(--border)',
          borderRadius: 'var(--sf-radius-sm)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {hits.length === 0 ? (
          <Typography sx={{ p: 2, fontSize: TS.body, color: 'var(--muted)' }}>
            {loading ? loadingLabel : emptyLabel}
          </Typography>
        ) : (
          <Stack role="listbox" id={listId}>
            {hits.map((hit, index) => (
              <Stack
                key={hit.productId}
                id={`${listId}-${hit.productId}`}
                component="button"
                type="button"
                role="option"
                aria-selected={index === cursor}
                direction="row"
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(hit.slug)}
                sx={{
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1,
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 0,
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'inherit',
                  '&:hover, &:focus-visible': { bgcolor: 'var(--neutral-soft)' },
                  ...(hits[cursor]?.productId === hit.productId
                    ? { bgcolor: 'var(--neutral-soft)' }
                    : {}),
                }}
              >
                <Thumb
                  url={hit.imagePath ? (thumbnails[hit.imagePath] ?? null) : null}
                  alt={hit.imageAlt ?? hit.name}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {hit.name}
                  </Typography>
                  {hit.categoryName && (
                    <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {hit.categoryName}
                    </Typography>
                  )}
                </Box>
                {hit.price && hit.currency && (
                  <Typography sx={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {formatMoney(Number(hit.price), hit.currency, locale)}
                  </Typography>
                )}
              </Stack>
            ))}

            <Stack
              component="button"
              type="button"
              onClick={onSeeAll}
              sx={{
                p: 1.25,
                background: 'none',
                border: 0,
                cursor: 'pointer',
                font: 'inherit',
                color: 'var(--accent-deep)',
                fontWeight: 800,
                fontSize: 13,
                '&:hover, &:focus-visible': { bgcolor: 'var(--neutral-soft)' },
              }}
            >
              {seeAllLabel}
            </Stack>
          </Stack>
        )}
      </Paper>
    </Popper>
  )
}

/**
 * Miniatura de la lista. Sin foto se pinta un hueco del mismo tamaño y NO nada:
 * una lista donde unas filas tienen imagen y otras no se descuadra entera, y el
 * salto se lee como un error de carga.
 */
function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <Box
      sx={{
        width: 44,
        height: 44,
        flexShrink: 0,
        borderRadius: `${R.sm}px`,
        bgcolor: 'var(--neutral-soft)',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {url ? (
        <Box
          component="img"
          src={url}
          alt={alt}
          loading="lazy"
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <SearchRoundedIcon aria-hidden sx={{ fontSize: 18, color: 'var(--muted)' }} />
      )}
    </Box>
  )
}
