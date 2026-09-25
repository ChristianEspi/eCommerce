import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Box, Stack, Typography } from '@mui/material'
import { useRef, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { GhostButton } from '@/shared/ui/buttons'
import { useFeedback } from '@/shared/ui/feedback-context'
import { R, T } from '@/theme/tokens'
import { CatalogError } from '../api/errors'
import { useBrandLogoUrls, useUploadBrandLogo } from './hooks'
import { BrandMonogram } from './BrandMonogram'

/** Los mismos tipos que admite el bucket. Sin SVG: ver `validateBrandLogo`. */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif'

/**
 * El logo de una marca, en el cajón de edición del PIM.
 *
 * ## El hueco ES el botón
 *
 * Es la misma anatomía que el branding de la tienda, y por la misma razón: si
 * la vista previa es un rectángulo decorativo y el botón que abre el selector
 * está al lado, el elemento más grande y más obvio de la fila no hace nada —
 * que es justo donde todo el mundo hace clic primero. Aquí el hueco es un
 * `<button>` de verdad, con foco, con `Enter` y con nombre accesible.
 *
 * ## Por qué el hueco es cuadrado y la imagen `contain`
 *
 * Un logo no se recorta. `cover` en un logotipo apaisado le corta los lados, y
 * lo que queda es un trozo de letra: peor que no enseñarlo. Con `contain` y un
 * hueco de proporción fija, cualquier logo cabe entero y la fila no cambia de
 * alto según la imagen que suba cada quien.
 *
 * ## Y qué se ve mientras no hay logo
 *
 * El MISMO monograma que la vitrina: dos letras sobre el tinte de la marca. No
 * un rectángulo gris ni un icono de cámara sobre vacío: así el backoffice
 * enseña exactamente lo que verá el comprador si nadie sube nada, en vez de
 * sugerir que la tienda está a medio hacer.
 */
export function BrandLogoField({
  name,
  value,
  organizationId,
  companyId,
  disabled,
  onChange,
}: {
  /** Nombre de la marca: es lo que se usa para el monograma y para el nombre accesible. */
  name: string
  /** Ruta del bucket o `https://` externa. `null` = sin logo. */
  value: string | null
  organizationId: string | null
  companyId: string | null
  disabled: boolean
  onChange: (next: string | null) => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const subir = useUploadBrandLogo()
  const inputRef = useRef<HTMLInputElement>(null)
  const [roto, setRoto] = useState(false)

  const urls = useBrandLogoUrls([value])
  const url = value ? urls[value] : undefined
  const ocupado = disabled || subir.isPending || !organizationId || !companyId

  async function elegir(file: File | undefined) {
    if (!file || !organizationId || !companyId) return
    try {
      const ruta = await subir.mutateAsync({ organizationId, companyId, file })
      setRoto(false)
      onChange(ruta)
    } catch (error) {
      notify(t(error instanceof CatalogError ? error.key : 'catalog.error.generic'), 'error')
    } finally {
      // Sin esto, volver a elegir EL MISMO archivo no dispara `change`.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <Stack spacing={1}>
      <Typography component="h4" sx={{ fontWeight: 700, fontSize: T.bodyStrong }}>
        {t('pim.brands.logo')}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Box
          component="button"
          type="button"
          disabled={ocupado}
          aria-label={`${t('pim.brands.logo')}: ${t('pim.brands.logo.upload')}`}
          onClick={() => inputRef.current?.click()}
          sx={{
            width: 104,
            height: 104,
            flexShrink: 0,
            p: 1,
            borderRadius: `${R.md}px`,
            border: '1px dashed var(--border)',
            bgcolor: 'var(--neutral-soft)',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            cursor: ocupado ? 'default' : 'pointer',
            transition: 'border-color 120ms, background-color 120ms',
            '&:hover:not(:disabled)': { borderColor: 'var(--accent)', bgcolor: 'var(--accent-soft)' },
            '&:disabled': { opacity: 0.6 },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
          }}
        >
          {url && !roto ? (
            <Box
              component="img"
              src={url}
              alt=""
              onError={() => setRoto(true)}
              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : value && !url ? (
            // Hay logo guardado pero su firma no ha llegado (o falló). El
            // monograma es mejor que un hueco: dice qué marca es.
            <BrandMonogram name={name} size={72} />
          ) : (
            <Stack sx={{ alignItems: 'center', gap: 0.5, color: 'var(--muted)' }}>
              <BrandMonogram name={name} size={48} />
              <AddPhotoAlternateRoundedIcon fontSize="small" />
            </Stack>
          )}
        </Box>

        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: T.label, color: 'var(--muted)' }}>
            {t('pim.brands.logo.help')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <GhostButton type="button" disabled={ocupado} onClick={() => inputRef.current?.click()}>
              {value ? t('pim.brands.logo.replace') : t('pim.brands.logo.upload')}
            </GhostButton>
            {value && (
              <GhostButton
                type="button"
                disabled={ocupado}
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                onClick={() => {
                  // Solo se suelta la referencia. El objeto se queda en el
                  // bucket: borrarlo aquí dejaría roto el logo de la marca si
                  // luego se cancela la edición, y un objeto huérfano no rompe
                  // ninguna pantalla.
                  setRoto(false)
                  onChange(null)
                }}
              >
                {t('pim.brands.logo.remove')}
              </GhostButton>
            )}
          </Stack>
        </Stack>
      </Stack>

      {/* Sin SVG: es un documento que puede llevar `<script>`, lo sube el
          tenant y lo sirve el dominio de la vitrina.

          `hidden` y con `aria-label`: el control que se ve es el hueco de
          arriba, pero el input sigue siendo el que recibe el archivo y quien
          navega con lector de pantalla necesita oír qué es. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label={t('pim.brands.logo.upload')}
        onChange={(event) => void elegir(event.target.files?.[0])}
      />
    </Stack>
  )
}
