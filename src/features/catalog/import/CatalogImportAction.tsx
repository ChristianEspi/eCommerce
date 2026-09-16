import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { UiError } from '@/shared/lib/appError'
import { useAttributeValues, useAttributes } from '../pim/hooks'
import { CATALOG_KEY } from '../useProducts'
import {
  axisColumns,
  importCategories,
  importProducts,
  importVocabulary,
  rowReasonKey,
  type ImportResult,
  type ImportRowResult,
  type VocabularySheets,
} from './api'
import {
  CATEGORIES_SHEET,
  PRODUCTS_SHEET,
  VOCABULARY_SHEETS,
  type AxisColumn,
  type SheetSpec,
} from './columns'
import { WorkbookReadError, buildTemplate, downloadTemplate, readWorkbook } from './excel'
import { findSheet, parseSheet, type ImportRow, type SheetIssue } from './parse'

export type CatalogImportKind = 'vocabulary' | 'categories' | 'products'

/** Cuántas filas se pintan: el resumen cuenta todas, la tabla es para leer. */
const MAX_VISIBLE = 300

const TITLE: Record<CatalogImportKind, MessageKey> = {
  vocabulary: 'catalogImport.title.vocabulary',
  categories: 'catalogImport.title.categories',
  products: 'catalogImport.title.products',
}
const HELP: Record<CatalogImportKind, MessageKey> = {
  vocabulary: 'catalogImport.help.vocabulary',
  categories: 'catalogImport.help.categories',
  products: 'catalogImport.help.products',
}
const FILE_NAME: Record<CatalogImportKind, string> = {
  vocabulary: 'plantilla-catalogo-avanzado.xlsx',
  categories: 'plantilla-categorias.xlsx',
  products: 'plantilla-productos.xlsx',
}

interface SheetProblem {
  readonly sheet: string
  readonly issue: SheetIssue | { readonly kind: 'missingSheet' } | { readonly kind: 'unreadable' }
}

function specsOf(kind: CatalogImportKind): readonly SheetSpec[] {
  if (kind === 'vocabulary') return VOCABULARY_SHEETS
  return kind === 'categories' ? [CATEGORIES_SHEET] : [PRODUCTS_SHEET]
}

/**
 * Botón «Importar» + diálogo de tres pasos: plantilla, archivo, revisión.
 *
 * Al subir el archivo se SIMULA la carga en el servidor (misma función, con
 * `dryRun`): la tabla que se ve es lo que va a pasar, fila por fila. «Aplicar»
 * solo se habilita sin errores, y aplica exactamente las mismas filas.
 */
export function CatalogImportAction({
  kind,
  storeId,
}: {
  kind: CatalogImportKind
  /** Tienda activa. El catálogo avanzado es de la empresa y no la necesita. */
  storeId?: string | null
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outlined" startIcon={<FileUploadRoundedIcon />} onClick={() => setOpen(true)}>
        {t('catalogImport.action')}
      </Button>
      {open && <CatalogImportDialog kind={kind} storeId={storeId ?? null} onClose={() => setOpen(false)} />}
    </>
  )
}

export function CatalogImportDialog({
  kind,
  storeId,
  onClose,
}: {
  kind: CatalogImportKind
  storeId: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const inputRef = useRef<HTMLInputElement>(null)
  const specs = specsOf(kind)

  // Los ejes (talla, color…) solo hacen falta para la hoja de productos.
  const wantsAxes = kind === 'products' && has('catalog.advanced')
  const attributes = useAttributes(wantsAxes)
  const values = useAttributeValues(wantsAxes)
  const axes: AxisColumn[] = useMemo(
    () => (wantsAxes ? axisColumns(attributes.data ?? [], values.data ?? []) : []),
    [wantsAxes, attributes.data, values.data],
  )

  const [fileName, setFileName] = useState<string | null>(null)
  const [pending, setPending] = useState<VocabularySheets | readonly ImportRow[] | null>(null)
  const [problems, setProblems] = useState<SheetProblem[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(true)

  const runImport = (payload: VocabularySheets | readonly ImportRow[], dryRun: boolean) => {
    if (kind === 'vocabulary') return importVocabulary(payload as VocabularySheets, dryRun)
    if (!storeId) throw new UiError({ boundary: 'catalog', key: 'catalogImport.error.generic', code: 'SIN_TIENDA' })
    const rows = payload as readonly ImportRow[]
    return kind === 'categories' ? importCategories(storeId, rows, dryRun) : importProducts(storeId, rows, dryRun)
  }

  const check = useMutation({
    mutationFn: (payload: VocabularySheets | readonly ImportRow[]) => runImport(payload, true),
    onSuccess: (result) => {
      setPreview(result)
      setOnlyErrors(result.errors > 0)
    },
  })
  const apply = useMutation({
    mutationFn: (payload: VocabularySheets | readonly ImportRow[]) => runImport(payload, false),
    onSuccess: (result) => {
      setApplied(result)
      if (result.applied) {
        void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] })
      } else {
        // Entre la revisión y el clic alguien cambió el catálogo: se enseña el
        // resultado nuevo en vez de fingir que se aplicó.
        setPreview(result)
        setOnlyErrors(true)
      }
    },
  })

  function reset() {
    setPending(null)
    setProblems([])
    setIgnored([])
    setPreview(null)
    setApplied(null)
    check.reset()
    apply.reset()
  }

  async function onTemplate() {
    await downloadTemplate(FILE_NAME[kind], buildTemplate(specs, axes))
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    reset()
    setFileName(file.name)

    let workbook
    try {
      workbook = await readWorkbook(file)
    } catch (error) {
      if (error instanceof WorkbookReadError) {
        setProblems([{ sheet: file.name, issue: { kind: 'unreadable' } }])
        return
      }
      throw error
    }

    const found: SheetProblem[] = []
    const skipped: string[] = []
    if (kind === 'vocabulary') {
      const sheets: VocabularySheets = {}
      let any = false
      for (const spec of specs) {
        const sheet = findSheet(workbook, spec, false)
        if (!sheet) continue
        const parsed = parseSheet(sheet.data, spec)
        skipped.push(...parsed.ignoredHeaders)
        // Una hoja vacía del libro de vocabulario no es un error: no se usa.
        if (parsed.issue?.kind === 'empty') continue
        if (parsed.issue) {
          found.push({ sheet: spec.name, issue: parsed.issue })
          continue
        }
        any = true
        sheets[spec.id as keyof VocabularySheets] = parsed.rows
      }
      if (!any && found.length === 0) found.push({ sheet: file.name, issue: { kind: 'missingSheet' } })
      setIgnored(skipped)
      setProblems(found)
      if (found.length === 0) {
        setPending(sheets)
        check.mutate(sheets)
      }
      return
    }

    const spec = specs[0] as SheetSpec
    const sheet = findSheet(workbook, spec, true)
    if (!sheet) {
      setProblems([{ sheet: file.name, issue: { kind: 'missingSheet' } }])
      return
    }
    const parsed = parseSheet(sheet.data, spec, axes)
    setIgnored([...parsed.ignoredHeaders])
    if (parsed.issue) {
      setProblems([{ sheet: spec.name, issue: parsed.issue }])
      return
    }
    setPending(parsed.rows)
    check.mutate(parsed.rows)
  }

  const headerOf = (sheetId: string, field: string | null | undefined): string | null => {
    if (!field) return null
    const spec = specs.find((candidate) => candidate.id === sheetId)
    return (
      spec?.columns.find((column) => column.key === field)?.header ??
      axes.find((axis) => axis.code === field)?.header ??
      field
    )
  }
  const sheetName = (sheetId: string) => specs.find((spec) => spec.id === sheetId)?.name ?? sheetId

  const result = applied?.applied ? applied : preview
  const visibleRows: ImportRowResult[] = useMemo(() => {
    const rows = result?.rows ?? []
    return (onlyErrors ? rows.filter((row) => row.status === 'error') : rows).slice(0, MAX_VISIBLE)
  }, [result, onlyErrors])

  const busy = check.isPending || apply.isPending
  const failure = check.error ?? apply.error
  const failureKey: MessageKey =
    failure instanceof UiError ? failure.key : 'catalogImport.error.generic'
  const canApply = Boolean(pending && preview && preview.errors === 0 && preview.total > 0 && !applied?.applied)

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="catalog-import-title">
      <DialogTitle id="catalog-import-title">{t(TITLE[kind])}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            {t(HELP[kind])}
          </Typography>

          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 700 }}>{t('catalogImport.step.template')}</Typography>
            <Box>
              <Button
                variant="text"
                startIcon={<FileDownloadRoundedIcon />}
                onClick={() => void onTemplate()}
                disabled={wantsAxes && (attributes.isPending || values.isPending)}
              >
                {t('catalogImport.template')}
              </Button>
            </Box>
          </Stack>

          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 700 }}>{t('catalogImport.step.upload')}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
              <Button
                variant="outlined"
                startIcon={<UploadFileRoundedIcon />}
                onClick={() => inputRef.current?.click()}
                disabled={busy || Boolean(applied?.applied)}
              >
                {t('catalogImport.choose')}
              </Button>
              {fileName && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {fileName}
                </Typography>
              )}
            </Stack>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label={t('catalogImport.choose')}
              onChange={(event) => void onFile(event)}
            />
          </Stack>

          {problems.length > 0 && (
            <Alert severity="error">
              <Stack spacing={0.5}>
                {problems.map((problem, index) => (
                  <Typography key={index} variant="body2">
                    {problemText(problem, t)}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          )}

          {ignored.length > 0 && (
            <Alert severity="info">
              {t('catalogImport.ignored')} {[...new Set(ignored)].join(', ')}
            </Alert>
          )}

          {busy && (
            <Stack spacing={1}>
              <Typography variant="body2">
                {t(apply.isPending ? 'catalogImport.applying' : 'catalogImport.checking')}
              </Typography>
              <LinearProgress />
            </Stack>
          )}

          {failure && !busy && <Alert severity="error">{t(failureKey)}</Alert>}

          {result && !busy && (
            <Stack spacing={1.5}>
              <Typography sx={{ fontWeight: 700 }}>{t('catalogImport.step.review')}</Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip label={`${t('catalogImport.summary.total')}: ${result.total}`} />
                <Chip color="success" variant="outlined" label={`${t('catalogImport.summary.created')}: ${result.created}`} />
                <Chip color="info" variant="outlined" label={`${t('catalogImport.summary.updated')}: ${result.updated}`} />
                <Chip
                  color={result.errors > 0 ? 'error' : 'default'}
                  variant={result.errors > 0 ? 'filled' : 'outlined'}
                  label={`${t('catalogImport.summary.errors')}: ${result.errors}`}
                />
              </Stack>

              {applied?.applied ? (
                <Alert severity="success">{t('catalogImport.done')}</Alert>
              ) : result.errors > 0 ? (
                <Alert severity="warning">{t('catalogImport.hasErrors')}</Alert>
              ) : (
                <Alert severity="info">{t('catalogImport.ready')}</Alert>
              )}
              {result.inventory_by_warehouse && <Alert severity="info">{t('catalogImport.warehouseNote')}</Alert>}

              <FormControlLabel
                control={<Switch checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />}
                label={t('catalogImport.onlyErrors')}
              />

              {visibleRows.length > 0 && (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label={t('catalogImport.step.review')}>
                    <TableHead>
                      <TableRow>
                        {kind === 'vocabulary' && <TableCell>{t('catalogImport.col.sheet')}</TableCell>}
                        <TableCell>{t('catalogImport.col.row')}</TableCell>
                        <TableCell>{t('catalogImport.col.key')}</TableCell>
                        <TableCell>{t('catalogImport.col.status')}</TableCell>
                        <TableCell>{t('catalogImport.col.detail')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleRows.map((row) => (
                        <TableRow key={`${row.sheet}-${row.row}-${row.key ?? ''}`}>
                          {kind === 'vocabulary' && <TableCell>{sheetName(row.sheet)}</TableCell>}
                          <TableCell>{row.row}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{row.key ?? '—'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={row.status === 'error' ? 'error' : row.status === 'created' ? 'success' : 'info'}
                              variant={row.status === 'error' ? 'filled' : 'outlined'}
                              label={t(`catalogImport.status.${row.status}` as MessageKey)}
                            />
                          </TableCell>
                          <TableCell>
                            {row.status === 'error'
                              ? [t(rowReasonKey(row.reason)), headerOf(row.sheet, row.field)].filter(Boolean).join(' · ')
                              : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
              {(result.rows.length > MAX_VISIBLE) && (
                <Typography variant="caption" color="text.secondary">
                  {t('catalogImport.moreRows')}
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('catalogImport.close')}
        </Button>
        {!applied?.applied && (
          <Button
            variant="contained"
            disabled={!canApply || busy}
            onClick={() => pending && apply.mutate(pending)}
          >
            {t('catalogImport.apply')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

function problemText(problem: SheetProblem, t: (key: MessageKey) => string): string {
  const prefix = `${problem.sheet}: `
  switch (problem.issue.kind) {
    case 'unreadable':
      return t('catalogImport.issue.unreadable')
    case 'missingSheet':
      return t('catalogImport.issue.missingSheet')
    case 'empty':
      return prefix + t('catalogImport.issue.empty')
    case 'missingHeaders':
      return `${prefix}${t('catalogImport.issue.missingHeaders')} ${problem.issue.headers.join(', ')}`
    case 'tooManyRows':
      return `${prefix}${t('catalogImport.issue.tooManyRows')} ${problem.issue.max}`
  }
}
