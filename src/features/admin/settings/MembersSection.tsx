import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'
import { mapSettingsCode } from './api'
import {
  mapCreateAccountCode,
  useCreateAccount,
  type CuentaCreada,
} from '@/features/auth/createAccount'
import { TemporaryCredentials } from '@/features/auth/TemporaryCredentials'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import {
  MEMBER_ROLES,
  useAddMember,
  useChangeMemberRole,
  useMembers,
  useRestoreMember,
  useRevokeMember,
  type MemberRole,
} from './members'

const ROL_LABEL: Record<string, MessageKey> = {
  owner: 'settings.members.role.owner',
  admin: 'settings.members.role.admin',
  catalog: 'settings.members.role.catalog',
  orders: 'settings.members.role.orders',
  viewer: 'settings.members.role.viewer',
}

/**
 * Quién entra a este backoffice.
 *
 * Hasta aquí, saber quién tenía acceso a la tienda exigía consultar la base, y
 * dar de alta a alguien también. Las policies de `tenant_members` llevaban
 * escrito desde el principio quién puede hacer qué —`owner` y `admin`
 * administran, `owner` no se otorga desde la app, nadie se borra a sí mismo—:
 * lo que faltaba era la pantalla.
 *
 * Administra la MEMBRESÍA, no la identidad. El correo y la contraseña son de la
 * plataforma; aquí se le da acceso a alguien que YA existe.
 *
 * El alta pide solo el correo. Pedía además un «id de usuario» —un uuid que no
 * se enseña en ninguna pantalla de esta aplicación—, así que la única forma de
 * rellenarlo era entrar al panel de la base de datos: la pantalla existía y no
 * se podía usar. Ahora la traducción de correo a identidad la hace el servidor
 * en `add_tenant_member`, que además comprueba quién pregunta.
 *
 * ## Y si ese correo todavía no tiene cuenta
 *
 * Antes la pantalla se limitaba a decirlo, y ahí se acababa el camino: no hay
 * pantalla de registro a la que mandar a nadie, así que «esa persona no tiene
 * cuenta» era una pared. Ahora el mismo aviso trae el botón que la crea.
 *
 * La cuenta nace CONFIRMADA y con una contraseña temporal que se enseña una
 * sola vez. Es la alternativa a un correo de invitación que esta aplicación
 * todavía no puede enviar, y es mejor que fabricar una fila «invitada» sin
 * forma de avisar a nadie: ahí el acceso quedaba concedido a alguien que no se
 * había enterado.
 */
export function MembersSection({
  organizationId,
  companyId,
  canManage,
  currentUserId,
}: {
  organizationId: string | null
  companyId: string | null
  /** `owner` o `admin`: lo mismo que exige la policy. */
  canManage: boolean
  /** Para no ofrecerle quitarse el acceso a sí mismo. */
  currentUserId: string | null
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const members = useMembers(organizationId, companyId)
  const add = useAddMember()
  const crearCuenta = useCreateAccount()
  const changeRole = useChangeMemberRole()
  const revoke = useRevokeMember()
  const restore = useRestoreMember()

  const [abierto, setAbierto] = useState(false)
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<MemberRole>('viewer')
  const [error, setError] = useState<string | null>(null)
  /** Se ofrece crear la cuenta solo cuando la base ha dicho que no la hay. */
  const [faltaCuenta, setFaltaCuenta] = useState(false)
  /** Mientras haya credenciales a la vista, el diálogo no enseña otra cosa. */
  const [credenciales, setCredenciales] = useState<CuentaCreada | null>(null)

  function cerrar() {
    setAbierto(false)
    setEmail('')
    setRol('viewer')
    setError(null)
    setFaltaCuenta(false)
    setCredenciales(null)
  }

  async function agregar() {
    if (!organizationId || !companyId) return
    if (!email.includes('@')) return setError(t('settings.members.error.email'))

    setError(null)
    setFaltaCuenta(false)
    try {
      await add.mutateAsync({ email, role: rol })
      notify(t('settings.members.added'), 'success')
      cerrar()
    } catch (fallo) {
      // La base es la autoridad, pero su MENSAJE no llega a la pantalla: se
      // traduce su código. Un texto de Postgres lleva dentro nombres de tabla y
      // de restricción, y aquí además el caso frecuente tiene una respuesta
      // concreta que dar —«esa persona todavía no tiene cuenta»— en vez de un
      // «algo salió mal» que no dice qué hacer.
      const code = codeFromDbError(fallo as PostgrestLike)
      setError(t(mapSettingsCode(code)))
      setFaltaCuenta(code === 'SIN_CUENTA')
    }
  }

  /**
   * Crear la cuenta y, acto seguido, dar el acceso que se estaba pidiendo.
   *
   * Son dos operaciones y dos permisos distintos en el servidor, y aquí se
   * encadenan a propósito: el que las separó nunca quiso crear una cuenta
   * suelta, quiso dar acceso y se encontró con que la persona no existía. Si el
   * alta sale bien y el acceso falla, las credenciales se enseñan igual —la
   * cuenta ya existe y la contraseña no se puede volver a consultar— y el
   * motivo del segundo fallo se queda a la vista.
   */
  async function crearYDarAcceso() {
    setError(null)
    try {
      const cuenta = await crearCuenta.mutateAsync(email)
      setFaltaCuenta(false)
      setCredenciales(cuenta)
      try {
        await add.mutateAsync({ email, role: rol })
        notify(t('account.create.created'), 'success')
      } catch (fallo) {
        setError(t(mapSettingsCode(codeFromDbError(fallo as PostgrestLike))))
      }
    } catch (fallo) {
      const code = (fallo as { code?: string })?.code ?? ''
      setError(t(mapCreateAccountCode(code)))
      // Si resulta que ya existía, lo que falta es el acceso, no la cuenta.
      setFaltaCuenta(code !== 'CUENTA_YA_EXISTE')
    }
  }

  if (members.isPending) return <LoadingState />
  if (members.isError) {
    return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
  }

  const filas = members.data ?? []

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ color: 'var(--muted)', flex: 1, minWidth: 260 }}>
          {t('settings.members.help')}
        </Typography>
        {canManage && (
          <Button
            variant="contained"
            startIcon={<PersonAddRoundedIcon />}
            onClick={() => setAbierto(true)}
          >
            {t('settings.members.add')}
          </Button>
        )}
      </Stack>

      {filas.length === 0 ? (
        <EmptyState title={t('settings.members.empty')} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('settings.members.email')}</TableCell>
                <TableCell>{t('settings.members.role')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filas.map((fila) => {
                // `owner` no se toca desde la app, y uno no se quita a sí mismo
                // el acceso. Las dos las exige la base; aquí solo se ocultan
                // para no ofrecer un control que va a fallar.
                const intocable = fila.role === 'owner' || fila.user_id === currentUserId
                const editable = canManage && !intocable

                return (
                  <TableRow key={fila.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{fila.email}</TableCell>
                    <TableCell>
                      {editable ? (
                        <TextField
                          select
                          size="small"
                          value={fila.role}
                          onChange={(event) =>
                            void changeRole
                              .mutateAsync({ id: fila.id, role: event.target.value as MemberRole })
                              .then(() => notify(t('settings.members.roleChanged'), 'success'))
                          }
                          sx={{ minWidth: 150 }}
                        >
                          {MEMBER_ROLES.map((valor) => (
                            <MenuItem key={valor} value={valor}>
                              {t(ROL_LABEL[valor] as MessageKey)}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        t(ROL_LABEL[fila.role] as MessageKey)
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(`settings.members.status.${fila.status}` as MessageKey)}
                        color={fila.status === 'active' ? 'success' : 'default'}
                        variant={fila.status === 'active' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {editable &&
                        (fila.status === 'active' ? (
                          <Button
                            size="small"
                            color="error"
                            onClick={() =>
                              void revoke
                                .mutateAsync(fila.id)
                                .then(() => notify(t('settings.members.revoked'), 'success'))
                            }
                          >
                            {t('settings.members.revoke')}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            onClick={() =>
                              void restore
                                .mutateAsync(fila.id)
                                .then(() => notify(t('settings.members.restored'), 'success'))
                            }
                          >
                            {t('settings.members.restore')}
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Con las credenciales a la vista el diálogo no se cierra al pinchar
          fuera: la contraseña no se guarda en ningún sitio y un clic distraído
          la perdería para siempre. Se sale por el botón, que dice lo que
          confirma. */}
      <Dialog
        open={abierto}
        onClose={credenciales ? undefined : cerrar}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {credenciales ? t('account.create.title') : t('settings.members.add')}
        </DialogTitle>
        <DialogContent>
          {credenciales ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <TemporaryCredentials cuenta={credenciales} />
            </Stack>
          ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Se explica lo que esta pantalla NO hace, porque es lo primero que
                se intenta: escribir un correo nuevo y esperar que llegue una
                invitación. */}
            <Alert severity="info">{t('settings.members.addHelp')}</Alert>
            {error && (
              <Alert
                severity={faltaCuenta ? 'warning' : 'error'}
                action={
                  faltaCuenta ? (
                    <Button
                      size="small"
                      onClick={() => void crearYDarAcceso()}
                      disabled={crearCuenta.isPending}
                    >
                      {t('account.create.action')}
                    </Button>
                  ) : undefined
                }
              >
                {error}
                {faltaCuenta && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {t('account.create.offer')}
                  </Typography>
                )}
              </Alert>
            )}

            <TextField
              label={t('settings.members.email')}
              type="email"
              fullWidth
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {/* Aquí había un campo «Id de usuario» que pedía pegar un uuid.
                Ese identificador no se enseña en ninguna pantalla de esta
                aplicación, así que la única forma de rellenarlo era entrar al
                panel de Supabase. La pantalla existía y no se podía usar.
                Ahora basta el correo: lo resuelve el servidor. */}
            <TextField
              select
              label={t('settings.members.role')}
              fullWidth
              value={rol}
              onChange={(event) => setRol(event.target.value as MemberRole)}
            >
              {MEMBER_ROLES.map((valor) => (
                <MenuItem key={valor} value={valor}>
                  {t(ROL_LABEL[valor] as MessageKey)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {credenciales ? (
            <Button variant="contained" onClick={cerrar}>
              {t('account.create.done')}
            </Button>
          ) : (
            <>
              <Button onClick={cerrar}>{t('common.cancel')}</Button>
              <Button variant="contained" onClick={() => void agregar()} disabled={add.isPending}>
                {t('common.add')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
