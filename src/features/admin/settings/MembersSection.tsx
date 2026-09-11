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
 * Si ese correo todavía no tiene cuenta, se dice tal cual. Crear una cuenta
 * desde aquí exigiría enviar un correo, y esta aplicación aún no envía correo:
 * fabricar una fila «invitada» sin forma de avisar a nadie dejaría un acceso
 * concedido a alguien que no se ha enterado.
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
  const changeRole = useChangeMemberRole()
  const revoke = useRevokeMember()
  const restore = useRestoreMember()

  const [abierto, setAbierto] = useState(false)
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<MemberRole>('viewer')
  const [error, setError] = useState<string | null>(null)

  function cerrar() {
    setAbierto(false)
    setEmail('')
    setRol('viewer')
    setError(null)
  }

  async function agregar() {
    if (!organizationId || !companyId) return
    if (!email.includes('@')) return setError(t('settings.members.error.email'))

    setError(null)
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
      setError(t(mapSettingsCode(codeFromDbError(fallo as PostgrestLike))))
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

      <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm">
        <DialogTitle>{t('settings.members.add')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Se explica lo que esta pantalla NO hace, porque es lo primero que
                se intenta: escribir un correo nuevo y esperar que llegue una
                invitación. */}
            <Alert severity="info">{t('settings.members.addHelp')}</Alert>
            {error && <Alert severity="error">{error}</Alert>}

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
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void agregar()} disabled={add.isPending}>
            {t('common.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
