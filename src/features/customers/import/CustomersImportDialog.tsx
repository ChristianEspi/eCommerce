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
import { useCreateAccount, CreateAccountError, type CuentaCreada } from '@/features/auth/createAccount'
import { normalizeHeader, type SheetSpec } from '@/features/catalog/import/columns'
import { WorkbookReadError, readWorkbook, type WorkbookSheet } from '@/features/catalog/import/excel'
import { findSheet, parseSheet, type ImportRow } from '@/features/catalog/import/parse'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { UiError } from '@/shared/lib/appError'
import { downloadWorkbook } from '@/shared/lib/excel'
import { CUSTOMERS_KEY } from '../hooks'
import {
  customerRowReasonKey,
  emailsWithoutAccount,
  importAccountUsers,
  importCustomers,
  type CustomerImportResult,
  type CustomerImportRow,
} from './api'
import { CUSTOMERS_SHEET, accountUsersSheet, templateBook } from './columns'

/** Cuántas filas se pintan: el resumen cuenta todas, la tabla es para leer. */
const MAX_VISIBLE = 300

export type CustomersImportTarget =
  | { readonly kind: 'customers' }
  /** `account` fijada desde su ficha; `null` desde la pestaña (cada fila dice su cuenta). */
  | { readonly kind: 'accountUsers'; readonly account: { readonly id: string; readonly name: string } | null }

/** Botón «Importar» que abre el diálogo. */
export function CustomersImportButton({ target, label }: { target: CustomersImportTarget; label?: MessageKey }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outlined" startIcon={<FileUploadRoundedIcon />} onClick={() => setOpen(true)}>
        {t(label ?? 'catalogImport.action')}
      </Button>
      {open && <CustomersImportDialog target={target} onClose={() => setOpen(false)} />}
    </>
  )
}

type Problem = MessageKey | { readonly key: MessageKey; readonly detail: string }

/**
 * Plantilla, archivo y revisión, igual que la importación del catálogo: al
 * subir el archivo la base SIMULA la carga y la tabla es lo que va a pasar,
 * fila por fila. «Aplicar» solo se habilita sin errores.
 *
 * Con usuarios B2B hay un paso más: un correo sin usuario es el error más
 * común al cargar una empresa entera, y la revisión ofrece crearlos todos en
 * un clic. La contraseña de cada uno se ve UNA vez (se puede descargar).
 */
export function CustomersImportDialog({ target, onClose }: { target: CustomersImportTarget; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const createUser = useCreateAccount()

  const isUsers = target.kind === 'accountUsers'
  const accountId = target.kind === 'accountUsers' ? (target.account?.id ?? null) : null
  const spec: SheetSpec = useMemo(
    () => (target.kind === 'customers' ? CUSTOMERS_SHEET : accountUsersSheet(target.account === null)),
    [target],
  )

  const [fileName, setFileName] = useState<string | null>(null)
  const [pending, setPending] = useState<readonly ImportRow[] | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [ignored, setIgnored] = useState<string[]>([])
  const [preview, setPreview] = useState<CustomerImportResult | null>(null)
  const [applied, setApplied] = useState<CustomerImportResult | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(true)
  const [created, setCreated] = useState<CuentaCreada[]>([])
  const [notCreated, setNotCreated] = useState<string[]>([])
  const [creating, setCreating] = useState<{ done: number; total: number } | null>(null)

  const runImport = (rows: readonly ImportRow[], dryRun: boolean) =>
    isUsers ? importAccountUsers(accountId, rows, dryRun) : importCustomers(rows, dryRun)

  const check = useMutation({
    mutationFn: (rows: readonly ImportRow[]) => runImport(rows, true),
    onSuccess: (result) => {
      setPreview(result)
      setOnlyErrors(result.errors > 0)
    },
  })
  const apply = useMutation({
    mutationFn: (rows: readonly ImportRow[]) => runImport(rows, false),
    onSuccess: (result) => {
      setApplied(result)
      if (result.applied) {
        void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY })
      } else {
        // Entre la revisión y el clic algo cambió: se enseña el resultado nuevo.
        setPreview(result)
        setOnlyErrors(true)
      }
    },
  })

  function reset() {
    setPending(null)
    setProblem(null)
    setIgnored([])
    setPreview(null)
    setApplied(null)
    setNotCreated([])
    check.reset()
    apply.reset()
  }

  async function onTemplate() {
    await downloadWorkbook(templateBook(spec, t), t)
  }

  /** La hoja de datos: por su nombre, o la primera que no sea la guía. */
  function pickSheet(workbook: readonly WorkbookSheet[]): WorkbookSheet | null {
    const guide = normalizeHeader(t('excel.guide.sheet'))
    return (
      findSheet(workbook, spec, false) ??
      workbook.find((sheet) => !['guia', 'guide', 'instrucciones', guide].includes(normalizeHeader(sheet.sheet))) ??
      null
    )
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    reset()
    setCreated([])
    setFileName(file.name)

    let workbook: WorkbookSheet[]
    try {
      workbook = await readWorkbook(file)
    } catch (error) {
      if (error instanceof WorkbookReadError) {
        setProblem('catalogImport.issue.unreadable')
        return
      }
      throw error
    }

    const sheet = pickSheet(workbook)
    if (!sheet) {
      setProblem('catalogImport.issue.missingSheet')
      return
    }
    const parsed = parseSheet(sheet.data, spec)
    setIgnored([...parsed.ignoredHeaders])
    if (parsed.issue) {
      const issue = parsed.issue
      if (issue.kind === 'empty') setProblem('catalogImport.issue.empty')
      else if (issue.kind === 'missingHeaders')
        setProblem({ key: 'catalogImport.issue.missingHeaders', detail: issue.headers.join(', ') })
      else setProblem({ key: 'catalogImport.issue.tooManyRows', detail: String(issue.max) })
      return
    }
    setPending(parsed.rows)
    check.mutate(parsed.rows)
  }

  const missing = useMemo(() => (isUsers ? emailsWithoutAccount(preview) : []), [isUsers, preview])

  /** Crea los usuarios que faltan, uno a uno, y vuelve a revisar el archivo. */
  async function createMissing() {
    if (!pending || missing.length === 0) return
    const ok: CuentaCreada[] = []
    const failed: string[] = []
    setCreating({ done: 0, total: missing.length })
    for (const [index, email] of missing.entries()) {
      try {
        ok.push(await createUser.mutateAsync(email))
      } catch (error) {
        // Ya existe: alguien lo creó entretanto y el vínculo va a funcionar.
        if (!(error instanceof CreateAccountError && error.code === 'CUENTA_YA_EXISTE')) failed.push(email)
      }
      setCreating({ done: index + 1, total: missing.length })
    }
    setCreating(null)
    setCreated((current) => [...current, ...ok])
    setNotCreated(failed)
    check.mutate(pending)
  }

  async function downloadPasswords() {
    await downloadWorkbook(
      {
        fileName: 'usuarios-creados',
        guide: {
          title: t('customersImport.created.title'),
          paragraphs: [t('customersImport.created.body')],
        },
        sheets: [
          {
            name: t('customersImport.created.sheet'),
            columns: [
              { header: t('customersImport.col.email'), description: t('customersImport.col.email'), format: 'text' },
              {
                header: t('customersImport.col.password'),
                description: t('customersImport.created.body'),
                format: 'text',
              },
            ],
            rows: created.map((account) => [account.email, account.temporary_password]),
          },
        ],
      },
      t,
    )
  }

  const result = applied?.applied ? applied : preview
  const visibleRows: CustomerImportRow[] = useMemo(() => {
    const rows = result?.rows ?? []
    return (onlyErrors ? rows.filter((row) => row.status === 'error') : rows).slice(0, MAX_VISIBLE)
  }, [result, onlyErrors])

  const headerOf = (field: string | null | undefined) =>
    field ? (spec.columns.find((column) => column.key === field)?.header ?? field) : null

  const busy = check.isPending || apply.isPending || creating !== null
  const failure = check.error ?? apply.error
  const failureKey: MessageKey = failure instanceof UiError ? failure.key : 'catalogImport.error.generic'
  const canApply = Boolean(pending && preview && preview.errors === 0 && preview.total > 0 && !applied?.applied)

  const title: string =
    target.kind === 'customers'
      ? t('customersImport.title.customers')
      : target.account
        ? t('customersImport.title.usersOf').replace('{name}', target.account.name)
        : t('customersImport.title.users')
  const help: MessageKey =
    target.kind === 'customers'
      ? 'customersImport.help.customers'
      : target.account
        ? 'customersImport.help.usersOf'
        : 'customersImport.help.users'

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="customers-import-title">
      <DialogTitle id="customers-import-title">{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            {t(help)}
          </Typography>

          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 700 }}>{t('catalogImport.step.template')}</Typography>
            <Box>
              <Button variant="text" startIcon={<FileDownloadRoundedIcon />} onClick={() => void onTemplate()}>
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

          {problem && (
            <Alert severity="error">
              {typeof problem === 'string' ? t(problem) : `${t(problem.key)} ${problem.detail}`}
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
                {creating
                  ? t('customersImport.missing.creating')
                      .replace('{done}', String(creating.done))
                      .replace('{total}', String(creating.total))
                  : t(apply.isPending ? 'catalogImport.applying' : 'catalogImport.checking')}
              </Typography>
              <LinearProgress />
            </Stack>
          )}

          {failure && !busy && <Alert severity="error">{t(failureKey)}</Alert>}

          {created.length > 0 && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" onClick={() => void downloadPasswords()}>
                  {t('customersImport.created.download')}
                </Button>
              }
            >
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {t('customersImport.created.title')} ({created.length})
              </Typography>
              <Typography variant="body2">{t('customersImport.created.body')}</Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {created.map((account) => (
                  <li key={account.email}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {account.email} · {account.temporary_password}
                    </Typography>
                  </li>
                ))}
              </Box>
            </Alert>
          )}

          {notCreated.length > 0 && (
            <Alert severity="error">
              {t('customersImport.missing.failed')} {notCreated.join(', ')}
            </Alert>
          )}

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

              {missing.length > 0 && !applied?.applied && (
                <Alert
                  severity="info"
                  action={
                    <Button color="inherit" size="small" onClick={() => void createMissing()}>
                      {t('customersImport.missing.create').replace('{count}', String(missing.length))}
                    </Button>
                  }
                >
                  {t('customersImport.missing.body').replace('{count}', String(missing.length))}
                </Alert>
              )}

              <FormControlLabel
                control={<Switch checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />}
                label={t('catalogImport.onlyErrors')}
              />

              {visibleRows.length > 0 && (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label={t('catalogImport.step.review')}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('catalogImport.col.row')}</TableCell>
                        <TableCell>{t('catalogImport.col.key')}</TableCell>
                        <TableCell>{t('catalogImport.col.status')}</TableCell>
                        <TableCell>{t('catalogImport.col.detail')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleRows.map((row) => (
                        <TableRow key={`${row.row}-${row.key ?? ''}`}>
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
                              ? [t(customerRowReasonKey(row.reason)), headerOf(row.field), row.value ? `«${row.value}»` : null]
                                  .filter(Boolean)
                                  .join(' · ')
                              : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
              {result.rows.length > MAX_VISIBLE && (
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
          <Button variant="contained" disabled={!canApply || busy} onClick={() => pending && apply.mutate(pending)}>
            {t('catalogImport.apply')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
