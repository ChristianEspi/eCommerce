import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Box,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  InputBase,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { useAssistant } from '../assistant'
import { useSignedThumbnails } from '../hooks'
import { ProductCard } from './ProductCard'

/** Lo que se puede preguntar sin saber qué preguntar. */
const EJEMPLOS = [
  'store.assistant.example.1',
  'store.assistant.example.2',
  'store.assistant.example.3',
] as const

/**
 * El asistente de compra.
 *
 * ## Qué pinta, y de dónde sale cada cosa
 *
 * El texto lo escribe el asistente. **Las tarjetas no.** Son las mismas
 * `ProductCard` del catálogo, alimentadas con productos que la vitrina resolvió
 * contra `public_products` después de recibir los identificadores. Por eso el
 * precio que se ve aquí no puede discrepar del que se ve en la ficha: es el
 * mismo dato leído del mismo sitio.
 *
 * Que sean las tarjetas de siempre también resuelve lo demás gratis —foto
 * firmada, insignia de descuento, estado de stock, favorito, añadir al
 * carrito— y evita una segunda versión de la tarjeta que se quedaría atrás.
 *
 * ## Cuando no hay IA no se pide perdón
 *
 * Sin proveedor configurado el servidor responde `mode: 'search'` con los
 * resultados del buscador. Aquí eso se pinta igual, sin cartel de error: lo que
 * el comprador pidió era encontrar productos, y los tiene. La única diferencia
 * visible es que no hay frase de recomendación y aparece una etiqueta discreta
 * diciendo que son resultados de búsqueda.
 *
 * ## Un fallo aquí no puede tocar la tienda
 *
 * El panel vive fuera del flujo de compra: si la llamada falla, se dice y el
 * catálogo, el carrito y el checkout siguen exactamente igual. No hay ningún
 * estado compartido que se pueda corromper desde aquí.
 */
export function AssistantDrawer({
  open,
  onClose,
  storeSlug,
  storeId,
}: {
  open: boolean
  onClose: () => void
  storeSlug: string
  storeId: string | null
}) {
  const { t } = useI18n()
  const [texto, setTexto] = useState('')
  const asistente = useAssistant()

  const productos = asistente.data?.products ?? []
  const miniaturas = useSignedThumbnails(productos.map((producto) => producto.primary_image_path))

  function preguntar(mensaje: string) {
    const limpio = mensaje.trim()
    if (limpio.length < 2 || asistente.isPending) return
    setTexto(limpio)
    asistente.mutate({ storeSlug, storeId, message: limpio })
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 420 },
            bgcolor: 'var(--bg)',
            backgroundImage: 'none',
          },
        },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1.5,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <AutoAwesomeRoundedIcon aria-hidden sx={{ fontSize: 20, color: 'var(--accent-deep)' }} />
          <Typography component="h2" sx={{ flex: 1, fontSize: TS.cardTitle, fontWeight: 800 }}>
            {t('store.assistant.title')}
          </Typography>
          <IconButton onClick={onClose} aria-label={t('common.close')} size="small">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
          {asistente.isIdle && (
            <Stack sx={{ gap: 1.5 }}>
              <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
                {t('store.assistant.intro')}
              </Typography>
              {/* Ejemplos pulsables: una caja de texto vacía delante de alguien
                  que no sabe qué se le puede pedir es una caja que no se usa. */}
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {EJEMPLOS.map((clave) => (
                  <Chip
                    key={clave}
                    label={t(clave)}
                    onClick={() => preguntar(t(clave))}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Stack>
          )}

          {asistente.isPending && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
                {t('store.assistant.thinking')}
              </Typography>
            </Stack>
          )}

          {asistente.isError && (
            <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
              {t('store.assistant.failed')}
            </Typography>
          )}

          {asistente.isSuccess && (
            <Stack sx={{ gap: 1.5 }}>
              {asistente.data.reply && (
                <Typography sx={{ fontSize: TS.body }}>{asistente.data.reply}</Typography>
              )}
              {/* Un parecido no se presenta como una respuesta.

                  Cuando el buscador cae a `fuzzy` no encontró lo que se pidió:
                  devolvió lo más cercano por letras. Enmarcarlo —«no encontré X,
                  esto es lo más parecido»— convierte un resultado desconcertante
                  en uno útil, porque lo primero que aprende quien pregunta es
                  que la tienda no tiene eso. Sin el marco, un catálogo sin
                  pañales contesta con óvulos vaginales y parece roto. */}
              {asistente.data.match === 'fuzzy' ? (
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {t('store.assistant.fuzzy').replace('{term}', asistente.data.query)}
                </Typography>
              ) : (
                asistente.data.mode === 'search' && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('store.assistant.searchMode')}
                  </Typography>
                )
              )}

              {productos.length === 0 ? (
                <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
                  {t('store.assistant.empty')}
                </Typography>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  }}
                >
                  {productos.map((producto) => (
                    <ProductCard
                      key={producto.product_id}
                      compact
                      product={producto}
                      storeSlug={storeSlug}
                      imageUrl={
                        producto.primary_image_path
                          ? (miniaturas[producto.primary_image_path] ?? null)
                          : null
                      }
                    />
                  ))}
                </Box>
              )}
            </Stack>
          )}
        </Box>

        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault()
            preguntar(texto)
          }}
          sx={{ p: 2, borderTop: '1px solid var(--border)' }}
        >
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.5,
              border: '1px solid var(--sf-line-strong)',
              borderRadius: 'var(--sf-pill)',
              bgcolor: 'var(--card)',
              '&:focus-within': { borderColor: 'var(--accent)' },
            }}
          >
            <InputBase
              fullWidth
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              placeholder={t('store.assistant.placeholder')}
              inputProps={{ 'aria-label': t('store.assistant.title'), maxLength: 400 }}
              sx={{ fontSize: TS.body }}
            />
            <IconButton
              type="submit"
              size="small"
              disabled={texto.trim().length < 2 || asistente.isPending}
              aria-label={t('store.assistant.send')}
            >
              <SendRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      </Stack>
    </Drawer>
  )
}
