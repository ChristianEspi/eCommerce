import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { API_SCOPES, API_VERSION } from '@/domain'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDateTime } from '@/shared/lib/format'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { IntegrationsError, isForbidden, isMissingModule } from './errors'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import {
  useApiClients,
  useCreateApiClient,
  useRotateApiClientSecret,
  useSetApiClientActive,
} from './hooks'
import type { NewCredential } from './types'

/**
 * Credenciales de la API de socio.
 *
 * ## El secreto se enseña UNA vez y no se puede volver a pedir
 *
 * La base guarda su sha256. `api_client_create` lo devuelve en la respuesta de
 * creación y nadie —ni el propietario— puede releerlo después: no existe la
 * consulta que lo devuelva. Por eso el diálogo lo dice con todas las letras y
 * por eso hay un botón de rotar: perder un secreto no es un problema de soporte,
 * es un secreto nuevo.
 *
 * Lo que sí se ve siempre es la PISTA (los seis últimos caracteres), que es lo
 * único que permite reconocer cuál de las tres credenciales es sin poder
 * reconstruir ninguna. Misma técnica que `gift_cards.code_last4` (P10).
 *
 * ## Los permisos son las operaciones canónicas del dominio
 *
 * `order.create`, `stock.read`… las mismas que declara un conector y las mismas
 * que viajan en la cola. Un segundo vocabulario para lo mismo se separa del
 * primero en la primera revisión.
 */

function SecretDialog({
  credential,
  onClose,
}: {
  credential: NewCredential | null
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Dialog open={credential !== null} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('integrations.api.secretTitle')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('integrations.api.secretWarning')}
        </Alert>
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>client_id</Typography>
        <Typography sx={{ fontSize: 13, wordBreak: 'break-all', mb: 1.5 }}>
          {credential?.client_id}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>client_secret</Typography>
        <Typography sx={{ fontSize: 13, wordBreak: 'break-all' }}>
          {credential?.client_secret}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('integrations.api.secretDone')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function ApiClientsSection() {
  const { t, locale } = useI18n()
  const clients = useApiClients()
  const create = useCreateApiClient()
  const rotate = useRotateApiClientSecret()
  const setActive = useSetApiClientActive()

  // Leer credenciales no exige el módulo; crearlas sí (la base responde
  // SIN_MODULO). Sin mirar la capacidad aquí, el aviso de «no contratado» no
  // salía nunca y el formulario fallaba en silencio (403 solo en consola).
  const { has } = useCapabilities()
  const contratado = has('integrations.enterprise')

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [credential, setCredential] = useState<NewCredential | null>(null)

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows((clients.data ?? []))

  if (isForbidden(clients.error)) {
    return (
      <UnauthorizedState
        title={t('integrations.error.forbidden')}
        description={t('integrations.forbiddenBody')}
      />
    )
  }
  if (isMissingModule(clients.error)) {
    return (
      <EmptyState
        title={t('integrations.error.noModule')}
        description={t('integrations.noModuleBody')}
      />
    )
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <Alert severity="info">
        {t('integrations.api.docs').replace('{version}', API_VERSION)}
      </Alert>

      {contratado ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            onClick={() => {
              create.reset()
              setCreating(true)
            }}
          >
            {t('integrations.api.new')}
          </Button>
        </Stack>
      ) : (
        <Alert severity="warning">
          <strong>{t('integrations.error.noModule')}.</strong> {t('integrations.noModuleBody')}
        </Alert>
      )}

      <Card>
        {clients.isPending ? (
          <TableSkeleton columns={5} />
        ) : clients.isError ? (
          <ErrorState error={clients.error} onRetry={() => void clients.refetch()} />
        ) : (clients.data ?? []).length === 0 ? (
          <EmptyState
            title={t('integrations.api.empty')}
            description={t('integrations.api.emptyBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('integrations.api.name')}</TableCell>
                <TableCell>{t('integrations.api.scopes')}</TableCell>
                <TableCell>{t('integrations.api.lastUsed')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{row.name}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>
                      {row.client_id} · ···{row.secret_hint}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                      {row.scopes.map((scope) => (
                        <StatusChip key={scope} label={scope} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {row.last_used_at ? formatDateTime(row.last_used_at, locale) : '—'}
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {row.rate_limit_per_minute} {t('integrations.api.perMinute')}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() =>
                        rotate.mutate(row.id, { onSuccess: (data) => setCredential(data) })
                      }
                    >
                      {t('integrations.api.rotate')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setActive.mutate({ id: row.id, isActive: !row.is_active })}
                    >
                      {row.is_active ? t('integrations.api.revoke') : t('integrations.api.enable')}
                    </Button>
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

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('integrations.api.newTitle')}</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            {create.isError && (
              <Alert severity="error">
                {t(create.error instanceof IntegrationsError ? create.error.key : 'integrations.error.generic')}
              </Alert>
            )}
            <TextField
              label={t('integrations.api.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              fullWidth
            />
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              {t('integrations.api.scopes')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('integrations.api.scopesHelp')}
            </Typography>
            <Stack>
              {API_SCOPES.map((scope) => (
                <FormControlLabel
                  key={scope}
                  control={
                    <Checkbox
                      size="small"
                      checked={scopes.includes(scope)}
                      onChange={(_, checked) =>
                        setScopes((current) =>
                          checked ? [...current, scope] : current.filter((item) => item !== scope),
                        )
                      }
                    />
                  }
                  label={scope}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={name.trim().length < 1 || scopes.length === 0 || create.isPending}
            onClick={() =>
              create.mutate(
                { name, scopes },
                {
                  onSuccess: (data) => {
                    setCredential(data)
                    setCreating(false)
                    setName('')
                    setScopes([])
                  },
                },
              )
            }
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <SecretDialog credential={credential} onClose={() => setCredential(null)} />
    </Stack>
  )
}
