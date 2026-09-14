import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import {
  addressBookKey,
  checkoutProfileKey,
  deleteAddress,
  fetchAddressBook,
  fetchCheckoutProfile,
  isMissingFunction,
  sameAddress,
  saveAddress,
  setDefaultAddress,
  type AddressInput,
  type BookAddress,
  type SavedAddress,
} from '../consumer'

/**
 * Mis direcciones (H04 → N06).
 *
 * Arriba, la LIBRETA: las direcciones que la persona guardó en esta tienda, con
 * nombre, la predeterminada primero. Se agregan, editan, eliminan y se marca
 * cuál se propone primero en el checkout. Todo pasa por funciones del servidor
 * que no reciben usuario: sale del JWT.
 *
 * Abajo, las direcciones de sus pedidos que todavía NO están guardadas, cada una
 * con «Guardar en mi libreta». Nada se guarda solo: comprar no escribe la
 * libreta, y guardar es siempre un gesto de la persona.
 *
 * Si la base todavía no tiene la libreta (función sin desplegar), la pestaña
 * sigue enseñando lo de antes: las direcciones de sus pedidos.
 */
export function ConsumerAddressesSection({ storeSlug }: { storeSlug: string }) {
  const { t } = useI18n()
  const book = useQuery({
    queryKey: addressBookKey(storeSlug),
    queryFn: () => fetchAddressBook(storeSlug),
    retry: (count, error) => !isMissingFunction(error) && count < 2,
  })
  const history = useQuery({
    queryKey: checkoutProfileKey(storeSlug),
    queryFn: () => fetchCheckoutProfile(storeSlug),
    retry: (count, error) => !isMissingFunction(error) && count < 2,
  })
  const [editing, setEditing] = useState<{ id: string | null; initial: AddressInput } | null>(null)

  const bookMissing = book.isError && isMissingFunction(book.error)
  if (book.isPending || history.isPending) return <BrandLoader />
  if (bookMissing && history.isError && isMissingFunction(history.error)) {
    return (
      <EmptyState
        title={t('account.consumer.unavailable')}
        description={t('account.consumer.unavailableBody')}
        icon={<PlaceRoundedIcon fontSize="small" />}
      />
    )
  }
  if (book.isError && !bookMissing) return <ErrorState error={book.error} onRetry={() => void book.refetch()} />

  const saved = book.data ?? []
  const used = (history.data?.addresses ?? []).filter((old) => !saved.some((entry) => sameAddress(entry, old)))

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 720 }}>
      {!bookMissing && (
        <Stack spacing={1.5} component="section" aria-labelledby="libreta-titulo">
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography id="libreta-titulo" component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
              {t('account.consumer.tab.addresses')}
            </Typography>
            <Button
              variant="contained"
              size="small"
              onClick={() => setEditing({ id: null, initial: { label: '', address: '' } })}
            >
              {t('account.consumer.addresses.add')}
            </Button>
          </Stack>

          {saved.length === 0 ? (
            <EmptyState
              title={t('account.consumer.addresses.empty')}
              description={t('account.consumer.addresses.emptyBody')}
              icon={<PlaceRoundedIcon fontSize="small" />}
            />
          ) : (
            saved.map((address) => (
              <SavedAddressCard
                key={address.id}
                storeSlug={storeSlug}
                address={address}
                onEdit={() => setEditing({ id: address.id, initial: inputOf(address) })}
              />
            ))
          )}
        </Stack>
      )}

      {used.length > 0 && (
        <Stack spacing={1.25} component="section" aria-labelledby="usadas-titulo">
          <Typography id="usadas-titulo" component="h3" sx={{ fontSize: TS.body, fontWeight: 800, color: 'var(--muted)' }}>
            {t('account.consumer.addresses.fromOrders')}
          </Typography>
          {used.map((address, index) => (
            <AddressCard
              key={`${address.address}-${address.city ?? ''}-${index}`}
              address={address}
              badge={index === 0 ? t('account.consumer.addresses.latest') : null}
            >
              {!bookMissing && (
                <Button
                  size="small"
                  onClick={() =>
                    setEditing({ id: null, initial: { ...inputOf(address), label: '' } })
                  }
                >
                  {t('account.consumer.addresses.saveFromOrder')}
                </Button>
              )}
            </AddressCard>
          ))}
        </Stack>
      )}

      {bookMissing && used.length === 0 && (
        <EmptyState
          title={t('account.consumer.addresses.empty')}
          description={t('account.consumer.addresses.emptyBody')}
          icon={<PlaceRoundedIcon fontSize="small" />}
        />
      )}

      {editing && (
        <AddressDialog
          storeSlug={storeSlug}
          addressId={editing.id}
          initial={editing.initial}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  )
}

function inputOf(address: SavedAddress & { label?: string; recipient?: string; phone?: string }): AddressInput {
  return {
    label: address.label ?? '',
    address: address.address,
    ...(address.recipient ? { recipient: address.recipient } : {}),
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.reference ? { reference: address.reference } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.region ? { region: address.region } : {}),
    ...(address.postal_code ? { postal_code: address.postal_code } : {}),
    ...(address.country ? { country: address.country } : {}),
  }
}

function AddressCard({ address, title, badge, children }: {
  address: SavedAddress
  title?: string
  badge?: string | null
  children?: React.ReactNode
}) {
  return (
    <Card sx={{ borderRadius: 'var(--sf-radius)', border: '1px solid var(--sf-line)' }}>
      <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <PlaceRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)', mt: 0.25 }} aria-hidden />
        <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.5}>
          {!title && badge && <Chip size="small" label={badge} sx={{ alignSelf: 'flex-start' }} />}
          {title && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography component="h3" sx={{ fontWeight: 800, fontSize: TS.body, overflowWrap: 'anywhere' }}>
                {title}
              </Typography>
              {badge && <Chip size="small" color="primary" label={badge} />}
            </Stack>
          )}
          <Typography sx={{ fontWeight: title ? 600 : 700, fontSize: TS.body, overflowWrap: 'anywhere' }}>
            {address.address}
          </Typography>
          <Typography sx={{ color: 'var(--muted)', fontSize: TS.label, overflowWrap: 'anywhere' }}>
            {[address.reference, address.city, address.region, address.postal_code, address.country]
              .filter(Boolean)
              .join(', ')}
          </Typography>
        </Stack>
        {children && (
          <Stack
            direction="row"
            sx={{ gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}
          >
            {children}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}

function SavedAddressCard({ storeSlug, address, onEdit }: { storeSlug: string; address: BookAddress; onEdit: () => void }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: addressBookKey(storeSlug) })

  const remove = useMutation({
    mutationFn: () => deleteAddress(storeSlug, address.id),
    onSuccess: async () => {
      setConfirming(false)
      notify(t('account.consumer.addresses.deleted'), 'success')
      await refresh()
    },
    onError: () => notify(t('account.consumer.addresses.error'), 'error'),
  })
  const makeDefault = useMutation({
    mutationFn: () => setDefaultAddress(storeSlug, address.id),
    onSuccess: refresh,
    onError: () => notify(t('account.consumer.addresses.error'), 'error'),
  })
  const who = [address.recipient, address.phone].filter(Boolean).join(' · ')

  return (
    <>
      <AddressCard
        address={{ ...address, reference: [address.reference, who].filter(Boolean).join(' · ') || undefined }}
        title={address.label}
        badge={address.is_default ? t('account.consumer.addresses.default') : null}
      >
        {!address.is_default && (
          <Button size="small" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate()}>
            {t('account.consumer.addresses.makeDefault')}
          </Button>
        )}
        <Button size="small" onClick={onEdit} aria-label={`${t('common.edit')}: ${address.label}`}>
          {t('common.edit')}
        </Button>
        <Button
          size="small"
          color="error"
          onClick={() => setConfirming(true)}
          aria-label={`${t('common.delete')}: ${address.label}`}
        >
          {t('common.delete')}
        </Button>
      </AddressCard>
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{t('account.consumer.addresses.confirmDelete').replace('{label}', address.label)}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

const FIELDS = [
  { key: 'label', labelKey: 'account.consumer.addresses.label', required: true, max: 60, autoComplete: 'off' },
  { key: 'address', labelKey: 'store.checkout.address', required: true, max: 300, autoComplete: 'street-address' },
  { key: 'reference', labelKey: 'store.checkout.reference', required: false, max: 200, autoComplete: 'off' },
  { key: 'city', labelKey: 'store.checkout.city', required: false, max: 120, autoComplete: 'address-level2' },
  { key: 'region', labelKey: 'store.checkout.region', required: false, max: 120, autoComplete: 'address-level1' },
  { key: 'postal_code', labelKey: 'store.checkout.postalCode', required: false, max: 12, autoComplete: 'postal-code' },
  { key: 'country', labelKey: 'store.checkout.country', required: false, max: 2, autoComplete: 'country' },
  { key: 'recipient', labelKey: 'account.consumer.addresses.recipient', required: false, max: 120, autoComplete: 'name' },
  { key: 'phone', labelKey: 'account.consumer.profile.phone', required: false, max: 40, autoComplete: 'tel' },
] as const

type FieldKey = (typeof FIELDS)[number]['key']

function AddressDialog({
  storeSlug,
  addressId,
  initial,
  onClose,
}: {
  storeSlug: string
  addressId: string | null
  initial: AddressInput
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<FieldKey, string>>(() => {
    const base = {} as Record<FieldKey, string>
    for (const field of FIELDS) base[field.key] = String(initial[field.key] ?? '')
    return base
  })
  const [isDefault, setIsDefault] = useState(Boolean(initial.is_default))
  const [invalid, setInvalid] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      const input: Record<string, string | boolean> = {}
      for (const field of FIELDS) {
        const value = values[field.key].trim()
        if (value !== '') input[field.key] = field.key === 'country' ? value.toUpperCase() : value
      }
      if (isDefault) input.is_default = true
      return saveAddress(storeSlug, input as unknown as AddressInput, addressId)
    },
    onSuccess: async () => {
      notify(t('account.consumer.addresses.saved'), 'success')
      await queryClient.invalidateQueries({ queryKey: addressBookKey(storeSlug) })
      onClose()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const missing = values.label.trim() === '' || values.address.trim().length < 3
    setInvalid(missing)
    if (!missing) save.mutate()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      // En el teléfono ocupa la pantalla entera, sin media query en JS: con CSS
      // no hay parpadeo al montar ni un chunk más para la portada.
      slotProps={{
        paper: {
          sx: {
            m: { xs: 0, sm: 4 },
            width: { xs: '100%', sm: undefined },
            maxWidth: { xs: '100%', sm: 600 },
            height: { xs: '100%', sm: 'auto' },
            maxHeight: { xs: '100%', sm: 'calc(100% - 64px)' },
            borderRadius: { xs: 0, sm: undefined },
          },
        },
      }}
    >
      <Box component="form" onSubmit={submit} noValidate>
        <DialogTitle>
          {addressId ? t('account.consumer.addresses.formTitleEdit') : t('account.consumer.addresses.formTitleNew')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.75} sx={{ pt: 0.5 }}>
            {save.isError && <Alert severity="error">{t('account.consumer.addresses.error')}</Alert>}
            {FIELDS.map((field) => {
              const empty = field.required && invalid && (field.key === 'address' ? values.address.trim().length < 3 : values[field.key].trim() === '')
              return (
                <TextField
                  key={field.key}
                  id={`libreta-${field.key}`}
                  label={t(field.labelKey)}
                  required={field.required}
                  value={values[field.key]}
                  error={empty}
                  helperText={empty ? t('account.consumer.addresses.required') : undefined}
                  autoComplete={field.autoComplete}
                  slotProps={{ htmlInput: { maxLength: field.max } }}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  fullWidth
                />
              )
            })}
            <FormControlLabel
              control={<Checkbox checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />}
              label={t('account.consumer.addresses.useAsDefault')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>
            {t('account.consumer.addresses.save')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
