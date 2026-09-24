import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Alert, Box, Stack, TextField, Typography } from '@mui/material'
import { useRef, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { GhostButton } from '@/shared/ui/buttons'
import { useFeedback } from '@/shared/ui/feedback-context'
import { R, T } from '@/theme/tokens'
import { CatalogError } from './api/errors'
import { categoryMediaReady } from './api/categories'
import { iconoDe } from '@/shared/ui/categoryIcon'
import { useCategoryImageUrls, useUploadCategoryImage } from './useCategories'

/** Los mismos tipos que admite el bucket. Sin SVG: ver `validateCategoryImage`. */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif'

/**
 * La foto de una categoría, en el cajón de edición.
 *
 * ## Por qué el hueco es APAISADO y la imagen `cover`
 *
 * Es lo contrario de un logo, y por una razón concreta. Un logo se enseña
 * entero o no se enseña: recortarlo deja un trozo de letra. Una FOTOGRAFÍA de
 * categoría es un fondo: lo que hace es dar materia a la puerta, y encajarla
 * con `contain` dejaría dos franjas vacías a los lados dentro de un azulejo de
 * color. Así que `cover`, y el hueco tiene la misma proporción que la puerta de
 * la portada — quien sube la foto ve el recorte antes de guardar, en vez de
 * descubrirlo en la tienda.
 *
 * ## El texto alternativo va AQUÍ y no en un campo suelto
 *
 * Porque solo tiene sentido cuando hay foto: un `alt` sin imagen es un dato
 * huérfano, y un campo de alt siempre visible invita a rellenarlo antes de que
 * haya nada que describir. Aparece con la imagen y desaparece con ella.
 *
 * Y es OPCIONAL a propósito. Sin alt, la vitrina pinta la imagen como
 * decorativa (`alt=""`) y el nombre de la categoría —que está escrito al lado—
 * hace de nombre accesible. Eso es correcto; inventar un alt con el nombre haría
 * que un lector de pantalla dijera «Abrigos, Abrigos».
 *
 * ## Y qué se ve sin foto
 *
 * El MISMO icono que la vitrina deriva del nombre, sobre el acento de suite. No
 * un rectángulo gris: así el backoffice enseña la FORMA que verá el comprador si
 * nadie sube nada, en vez de sugerir que falta algo. El color no se comparte —
 * los tintes de orientación de la vitrina viven dentro de `.sf-scope`— y no hace
 * falta que se comparta: lo que se reconoce de un icono es su silueta.
 */
export function CategoryImageField({
  name,
  imageUrl,
  imageAlt,
  organizationId,
  storeId,
  disabled,
  onChangeImage,
  onChangeAlt,
}: {
  /** Nombre de la categoría: de él sale el icono de respaldo. */
  name: string
  /** Ruta del bucket o `https://` externa. `null` = sin foto. */
  imageUrl: string | null
  imageAlt: string
  organizationId: string
  storeId: string
  disabled: boolean
  onChangeImage: (next: string | null) => void
  onChangeAlt: (next: string) => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const subir = useUploadCategoryImage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [roto, setRoto] = useState(false)

  const urls = useCategoryImageUrls([imageUrl])
  const url = imageUrl ? urls[imageUrl] : undefined
  const ocupado = disabled || subir.isPending
  // El MISMO icono que la vitrina deriva del nombre. El color sí cambia: los
  // tintes de orientación viven dentro de `.sf-scope` y aquí manda el acento de
  // suite. Lo que se comparte es la forma, que es lo que se reconoce.
  const Icono = iconoDe(name)

  /**
   * Si la base todavía no tiene las columnas, la subida no se ofrece.
   *
   * Un campo que sube el archivo y luego no puede guardar la fila deja un
   * objeto en el bucket y al comercio convencido de que su categoría tiene
   * foto. Avisar es más honesto que ofrecerlo.
   */
  if (!categoryMediaReady()) {
    return (
      <Alert severity="info" icon={false} sx={{ fontSize: T.label }}>
        {t('catalog.categories.image.unavailable')}
      </Alert>
    )
  }

  async function elegir(file: File | undefined) {
    if (!file) return
    try {
      const ruta = await subir.mutateAsync({ organizationId, storeId, file })
      setRoto(false)
      onChangeImage(ruta)
    } catch (error) {
      notify(t(error instanceof CatalogError ? error.key : 'catalog.error.generic'), 'error')
    } finally {
      // Sin esto, volver a elegir EL MISMO archivo no dispara `change`.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const hayFoto = Boolean(url) && !roto

  return (
    <Stack spacing={1}>
      <Typography component="h4" sx={{ fontWeight: 700, fontSize: T.bodyStrong }}>
        {t('catalog.categories.image')}
      </Typography>

      {/* El hueco ES el botón: si la vista previa fuera decorativa y el botón
          estuviera al lado, el elemento más grande de la fila no haría nada —
          que es justo donde todo el mundo hace clic primero. */}
      <Box
        component="button"
        type="button"
        disabled={ocupado}
        aria-label={`${t('catalog.categories.image')}: ${t('catalog.categories.image.upload')}`}
        onClick={() => inputRef.current?.click()}
        sx={{
          width: '100%',
          // La misma proporción que la puerta de la portada: se ve el recorte
          // antes de subir, no al descubrirlo en la tienda.
          aspectRatio: '16 / 9',
          p: 0,
          borderRadius: `${R.md}px`,
          border: hayFoto ? '1px solid var(--border)' : '1px dashed var(--border)',
          background: hayFoto ? 'var(--neutral-soft)' : 'var(--accent-soft)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          color: 'var(--accent-deep)',
          cursor: ocupado ? 'default' : 'pointer',
          transition: 'border-color 120ms',
          '&:hover:not(:disabled)': { borderColor: 'var(--accent)' },
          '&:disabled': { opacity: 0.6 },
          '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
        }}
      >
        {hayFoto ? (
          <img
            src={url}
            alt=""
            onError={() => setRoto(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Stack sx={{ alignItems: 'center', gap: 0.5 }}>
            <Icono sx={{ fontSize: 40 }} />
            <AddPhotoAlternateRoundedIcon fontSize="small" />
          </Stack>
        )}
      </Box>

      <Typography sx={{ fontSize: T.label, color: 'var(--muted)' }}>
        {t('catalog.categories.image.help')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <GhostButton type="button" disabled={ocupado} onClick={() => inputRef.current?.click()}>
          {imageUrl ? t('catalog.categories.image.replace') : t('catalog.categories.image.upload')}
        </GhostButton>
        {imageUrl && (
          <GhostButton
            type="button"
            disabled={ocupado}
            startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
            onClick={() => {
              // Solo se suelta la referencia; el objeto se queda en el bucket.
              // Borrarlo aquí dejaría la categoría sin foto si luego se cancela
              // la edición, y un huérfano no rompe ninguna pantalla.
              setRoto(false)
              onChangeImage(null)
              onChangeAlt('')
            }}
          >
            {t('catalog.categories.image.remove')}
          </GhostButton>
        )}
      </Stack>

      {/* El alt solo existe si hay foto que describir. */}
      {imageUrl && (
        <TextField
          fullWidth
          size="small"
          label={t('catalog.categories.image.alt')}
          helperText={t('catalog.categories.image.altHelp')}
          disabled={ocupado}
          value={imageAlt}
          onChange={(event) => onChangeAlt(event.target.value)}
          inputProps={{ maxLength: 160 }}
        />
      )}

      {/* Sin SVG: es un documento que puede llevar `<script>`, lo sube el tenant
          y lo sirve el dominio de la vitrina. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label={t('catalog.categories.image.upload')}
        onChange={(event) => void elegir(event.target.files?.[0])}
      />
    </Stack>
  )
}
