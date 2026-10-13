import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PRODUCTS_TABLE } from '@/shared/lib/db-schema'
import { useFeedback } from '@/shared/ui/feedback-context'
import { catalogClient } from '../api/client'
import { catalogErrorFromDb } from '../api/errors'
import { MAX_HIGHLIGHTS, MAX_HIGHLIGHT_LENGTH, cleanHighlights } from './highlights'

const highlightsRow = z.object({ highlights: z.array(z.string()).catch([]) })

/**
 * Los puntos destacados del producto (2026-10-13): las frases con ✓ que la
 * ficha pública pinta bajo la galería. Son del MAESTRO, así que valen en todas
 * las tiendas que lo publiquen.
 *
 * Va en la pestaña «Ficha», junto a las especificaciones, con su propio
 * «Guardar»: es una lista que se edita entera, no un campo suelto.
 */
export function ProductHighlightsPanel({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const key = ['catalog', 'product-highlights', productId]

  const current = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await catalogClient()
        .from(PRODUCTS_TABLE)
        .select('highlights')
        .eq('id', productId)
        .maybeSingle()
      if (error) throw catalogErrorFromDb(error)
      return data ? highlightsRow.parse(data).highlights : []
    },
  })

  const [items, setItems] = useState<string[]>([])
  useEffect(() => {
    if (current.data) setItems(current.data.length > 0 ? current.data : [''])
  }, [current.data])

  const save = useMutation({
    mutationFn: async (list: string[]) => {
      const { error } = await catalogClient().from(PRODUCTS_TABLE).update({ highlights: list }).eq('id', productId)
      if (error) throw catalogErrorFromDb(error)
    },
    onSuccess: () => {
      notify(t('catalog.highlights.saved'), 'success')
      void queryClient.invalidateQueries({ queryKey: key })
    },
    onError: () => notify(t('catalog.highlights.error'), 'error'),
  })

  const limpia = cleanHighlights(items)
  const cambio = JSON.stringify(limpia) !== JSON.stringify(current.data ?? [])

  return (
    <Stack component="section" aria-labelledby="pim-highlights-title" sx={{ gap: 1.25, mb: 3 }}>
      <Typography id="pim-highlights-title" component="h3" sx={{ fontWeight: 700, fontSize: 15 }}>
        {t('catalog.highlights.title')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
        {t('catalog.highlights.help')}
      </Typography>
      {items.map((value, index) => (
        <Stack key={index} direction="row" sx={{ gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            value={value}
            disabled={!canWrite}
            inputProps={{ maxLength: MAX_HIGHLIGHT_LENGTH, 'aria-label': `${t('catalog.highlights.item')} ${index + 1}` }}
            placeholder={t('catalog.highlights.placeholder')}
            onChange={(event) => setItems((list) => list.map((v, i) => (i === index ? event.target.value : v)))}
          />
          <IconButton
            aria-label={`${t('catalog.highlights.remove')} ${index + 1}`}
            disabled={!canWrite}
            onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          disabled={!canWrite || items.length >= MAX_HIGHLIGHTS}
          onClick={() => setItems((list) => [...list, ''])}
        >
          {t('catalog.highlights.add')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!canWrite || !cambio || save.isPending}
          onClick={() => save.mutate(limpia)}
        >
          {t('catalog.highlights.save')}
        </Button>
      </Stack>
    </Stack>
  )
}
