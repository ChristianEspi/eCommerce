import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded'
import {
  Box,
  Button,
  Card,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { ContentError } from './errors'
import { useDeleteSynonym, useSaveSynonym, useSynonyms } from './hooks'
import { parseExpansions, synonymFormSchema, type SearchSynonymRow, type SynonymFormValues } from './types'

function emptyForm(): SynonymFormValues {
  return { term: '', expansions: '', is_active: true }
}

/**
 * Sinónimos de búsqueda: el discovery que el comercio ajusta sin desplegar.
 *
 * Es la respuesta directa al criterio de aceptación de la fase —«mejorar
 * discovery sin deploy»—. «Zapatilla = tenis = championes» cambia por país y
 * por sector; que fuera código significaría que ayudar a un comercio a vender
 * es una versión nueva de la aplicación.
 *
 * Debajo del campo se ve la forma NORMALIZADA del término, que es la que el
 * índice único usa: sin eso, dar de alta «Zapatilla» cuando ya existe
 * «zapatillas » falla con un error de clave duplicada que nadie entiende,
 * porque en la pantalla los dos se ven distintos. Es la misma lección que P10
 * aprendió con los cupones.
 */
export function SynonymsSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId, can } = useTenant()
  const canManage = can('store.manage')

  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SearchSynonymRow | null>(null)
  const [form, setForm] = useState<SynonymFormValues>(emptyForm)

  const synonyms = useSynonyms(activeStore?.id ?? null, term)

  const scope = useMemo(
    () =>
      tenant && activeCompanyId && activeStore
        ? {
            organizationId: tenant.organization_id,
            companyId: activeCompanyId,
            storeId: activeStore.id,
          }
        : null,
    [tenant, activeCompanyId, activeStore],
  )

  const save = useSaveSynonym(scope)
  const remove = useDeleteSynonym()

  const list = synonyms.data ?? []
  const parsed = synonymFormSchema.safeParse(form)
  const expansions = parseExpansions(form.expansions)
  const firstIssue = parsed.success
    ? expansions.length === 0
      ? 'content.error.expansions'
      : null
    : (parsed.error.issues[0]?.message ?? 'content.error.generic')

  async function submit() {
    if (!parsed.success || expansions.length === 0) return
    try {
      await save.mutateAsync({ id: editing?.id ?? null, values: parsed.data })
      notify(t(editing ? 'content.synonyms.updated' : 'content.synonyms.created'), 'success')
      setOpen(false)
    } catch (error) {
      const key: MessageKey = error instanceof ContentError ? error.key : 'content.error.generic'
      notify(t(key), 'error')
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!canManage) {
    return (
      <UnauthorizedState
        title={t('content.forbidden.title')}
        description={t('content.forbidden.body')}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('content.synonyms.help')}</Typography>

      <FilterBar
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setForm(emptyForm())
              setEditing(null)
              setOpen(true)
            }}
          >
            {t('content.synonyms.new')}
          </Button>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('content.synonyms.search')}
            ariaLabel={t('content.synonyms.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {synonyms.isPending && <TableSkeleton columns={4} />}
        {synonyms.isError && (
          <ErrorState error={synonyms.error} onRetry={() => void synonyms.refetch()} />
        )}
        {!synonyms.isPending && !synonyms.isError && list.length === 0 && (
          <EmptyState
            title={t('content.synonyms.emptyTitle')}
            description={t('content.synonyms.emptyBody')}
            icon={<ManageSearchRoundedIcon fontSize="small" />}
          />
        )}
        {list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('content.synonyms.term')}</TableCell>
                <TableCell>{t('content.synonyms.expansions')}</TableCell>
                <TableCell>{t('content.synonyms.state')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }}>{row.term}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                      {row.term_normalized}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                      {row.expansions.map((item) => (
                        <StatusChip key={item} label={item} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={t(row.is_active ? 'content.blocks.active' : 'content.blocks.inactive')}
                      tone={row.is_active ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: t('common.edit'),
                          tone: 'neutral',
                          onClick: () => {
                            setForm({
                              term: row.term,
                              expansions: row.expansions.join(', '),
                              is_active: row.is_active,
                            })
                            setEditing(row)
                            setOpen(true)
                          },
                        },
                        {
                          id: '1',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: t('common.delete'),
                          tone: 'danger',
                          onClick: () => void remove.mutateAsync(row.id),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {/* El paginador solo aparece cuando hay algo que paginar: un
            "0-0 de 0" bajo un estado vacio es ruido que contradice al
            propio estado vacio. */}
        {pager.total > 0 && (
          <TablePager
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
          />
        )}
      </Card>

      <FormDrawer
        open={open}
        title={editing ? t('content.synonyms.edit') : t('content.synonyms.new')}
        onClose={() => setOpen(false)}
        busy={save.isPending}
        actions={
          <>
            <Button onClick={() => setOpen(false)} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void submit()}
              disabled={firstIssue !== null || save.isPending}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <Field
            label={t('content.synonyms.term')}
            rule="text"
            maxLength={60}
            help={t('help.content.synonymTerm')}
            value={form.term}
            onChange={(event) => setForm({ ...form, term: event.target.value })}
            required
          />
          <Field
            label={t('content.synonyms.expansions')}
            rule="longText"
            maxLength={750}
            value={form.expansions}
            onChange={(event) => setForm({ ...form, expansions: event.target.value })}
            helperText={t('content.synonyms.expansionsHelp')}
            multiline
            minRows={2}
          />
          {expansions.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
              {expansions.map((item) => (
                <StatusChip key={item} label={item} />
              ))}
            </Stack>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <Switch
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
              inputProps={{ 'aria-label': t('content.blocks.active') }}
            />
            <Typography sx={{ fontWeight: 700 }}>{t('content.blocks.active')}</Typography>
          </Stack>
          {firstIssue && (
            <Typography sx={{ color: 'var(--red)', fontWeight: 700, fontSize: 12 }}>
              {t(firstIssue as MessageKey)}
            </Typography>
          )}
        </Stack>
      </FormDrawer>
    </Stack>
  )
}
