import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import { Alert, Box, Card, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useMemo, useState } from 'react'
import { toStoreContent } from '@/features/storefront/content'
import { ContentBlocks } from '@/features/storefront/components/ContentBlocks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { usePreview } from './hooks'

/**
 * Vista previa: la portada tal y como se verá, con el reloj en la mano.
 *
 * ## Por qué esto es el MISMO componente que pinta la vitrina
 *
 * `ContentBlocks` es el de `features/storefront`, importado tal cual. Una vista
 * previa que se pinta con otros componentes es una vista previa que miente el
 * día que uno de los dos cambia, y ese día no avisa: alguien publica confiando
 * en lo que vio aquí.
 *
 * Lo mismo por debajo: `public.content_preview` llama a la MISMA
 * `ebim.resolve_content` que sirve a `store_page_for_slug`. Lo único que cambia
 * son tres argumentos —el instante, el canal y si se incluyen borradores— que
 * la vitrina fija y aquí se eligen.
 *
 * ## El interruptor que hace útil la pantalla
 *
 * «Como lo estoy editando» enseña todo, incluidos los bloques apagados o fuera
 * de vigencia. «Como se verá» aplica las reglas de la vitrina en el instante
 * elegido — así se responde «¿cómo queda el 24 de diciembre?» sin publicar y
 * mirar.
 *
 * **Las imágenes no se firman aquí.** El editor ve el hueco neutral en vez de la
 * foto: firmar exigiría el cliente anónimo de la vitrina —otro cliente, otras
 * policies— y montarlo dentro del backoffice para una previsualización sería
 * abrir un camino de lectura pública desde una pantalla con sesión.
 */
export function PreviewSection({ pageId }: { pageId: string | null }) {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const [at, setAt] = useState('')
  const [asPublished, setAsPublished] = useState(false)

  const input = useMemo(
    () =>
      pageId
        ? {
            pageId,
            at: at ? new Date(at).toISOString() : null,
            includeDrafts: !asPublished,
          }
        : null,
    [pageId, at, asPublished],
  )

  const preview = usePreview(input)

  const content = useMemo(() => {
    if (!preview.data) return null
    try {
      return toStoreContent(preview.data)
    } catch {
      // Una respuesta que no valida no se pinta a medias: el contrato entre la
      // base y la vitrina se ha separado y eso hay que verlo, no maquillarlo.
      return null
    }
  }, [preview.data])

  if (!pageId) {
    return (
      <EmptyState
        title={t('content.preview.noPageTitle')}
        description={t('content.preview.noPageBody')}
        icon={<VisibilityRoundedIcon fontSize="small" />}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <Field
          type="datetime-local"
          size="small"
          label={t('content.preview.at')}
          value={at}
          onChange={(event) => setAt(event.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 240 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={asPublished}
              onChange={(event) => setAsPublished(event.target.checked)}
            />
          }
          label={
            <Typography sx={{ fontWeight: 700 }}>{t('content.preview.asPublished')}</Typography>
          }
        />
      </Stack>

      <Alert severity="info">{t('content.preview.help')}</Alert>

      {preview.isPending && <LoadingState />}
      {preview.isError && (
        <Card>
          <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
        </Card>
      )}

      {content && content.blocks.length === 0 && (
        <Card>
          <EmptyState
            title={t('content.preview.emptyTitle')}
            description={t('content.preview.emptyBody')}
            icon={<VisibilityRoundedIcon fontSize="small" />}
          />
        </Card>
      )}

      {content && content.blocks.length > 0 && (
        <Box
          sx={{
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-preview, 14px)',
            p: { xs: 1.5, md: 2.5 },
            bgcolor: 'var(--bg)',
          }}
        >
          <ContentBlocks
            blocks={content.blocks}
            storeSlug={activeStore?.slug ?? ''}
            assets={{}}
            images={{}}
          />
        </Box>
      )}
    </Stack>
  )
}
