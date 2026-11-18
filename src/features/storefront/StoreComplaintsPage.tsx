import { zodResolver } from '@hookform/resolvers/zod'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { isValidDocument, matchesRule, type DocType } from '@/shared/lib/fieldRules'
import { formatDate } from '@/shared/lib/format'
import { Field } from '@/shared/ui/Field'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { TS } from '@/theme/tokens'
import {
  COMPLAINT_KINDS,
  ComplaintError,
  DOC_TYPES,
  ITEM_KINDS,
  submitComplaint,
  type ComplaintReceipt,
} from './complaints/api'
import { useStorefront } from './hooks'
import { privateMeta } from './seo'
import { SelectField } from '@/shared/ui/SelectField'

/** El tipo del libro (`pasaporte`, en castellano en la base) con el nombre de su regla de campo. */
function docRule(type: (typeof DOC_TYPES)[number]): DocType {
  return type === 'pasaporte' ? 'passport' : type
}

const personName = (value: string) => matchesRule('personName', value)

/**
 * Libro de Reclamaciones virtual de la tienda (2026-10-02).
 *
 * La hoja que exige la ley peruana para todo comercio que vende al consumidor
 * final: proveedor, consumidor, bien contratado, tipo (reclamo o queja),
 * detalle y pedido. Se envía SIN cuenta —es un derecho, no un servicio para
 * clientes registrados— y la base devuelve el número de hoja correlativo.
 *
 * Las mismas reglas que la base (`submit_complaint`) se validan aquí antes de
 * enviar, para que el error se vea en el campo y no como un mensaje genérico.
 */
const schema = z
  .object({
    kind: z.enum(COMPLAINT_KINDS),
    consumer_name: z.string().trim().min(2).max(160).refine(personName),
    doc_type: z.enum(DOC_TYPES),
    doc_number: z.string().trim().regex(/^[0-9A-Za-z-]{6,20}$/),
    consumer_email: z.string().trim().email().max(254),
    consumer_phone: z
      .string()
      .trim()
      .regex(/^(\+?[0-9][0-9 ]{5,19})?$/),
    consumer_address: z.string().trim().max(240),
    is_minor: z.boolean(),
    guardian_name: z.string().trim().max(160),
    item_kind: z.enum(ITEM_KINDS),
    item_description: z.string().trim().min(2).max(500),
    amount: z
      .string()
      .trim()
      .regex(/^(\d{1,7}([.,]\d{1,2})?)?$/),
    order_reference: z.string().trim().max(40).regex(/^[A-Za-z0-9._-]*$/),
    detail: z.string().trim().min(10).max(3000),
    request: z.string().trim().min(5).max(2000),
    accept: z.literal(true),
  })
  .refine((v) => !v.is_minor || (v.guardian_name.length >= 2 && personName(v.guardian_name)), { path: ['guardian_name'] })
  // El número con la forma de su tipo: un DNI de 8 dígitos, un RUC con su dígito verificador.
  .refine((v) => isValidDocument(docRule(v.doc_type), v.doc_number), { path: ['doc_number'] })

type Form = z.input<typeof schema>

const ERRORES: Record<string, MessageKey> = {
  LIMITE_DE_TASA: 'store.complaints.error.rate',
}

export function StoreComplaintsPage() {
  const { t, locale } = useI18n()
  const { store, storeSlug } = useStorefront()
  useDocumentMeta(
    privateMeta(
      { store, storeSlug, locale, pathname: `/s/${storeSlug}` },
      t('store.complaints.book'),
      '/libro-de-reclamaciones',
    ),
  )

  const { control, register, handleSubmit, watch, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'reclamo',
      consumer_name: '',
      doc_type: 'dni',
      doc_number: '',
      consumer_email: '',
      consumer_phone: '',
      consumer_address: '',
      is_minor: false,
      guardian_name: '',
      item_kind: 'producto',
      item_description: '',
      amount: '',
      order_reference: '',
      detail: '',
      request: '',
      accept: false as unknown as true,
    },
  })
  const enviar = useMutation<ComplaintReceipt, ComplaintError, Form>({
    mutationFn: (v) =>
      submitComplaint(storeSlug, {
        kind: v.kind,
        consumer_name: v.consumer_name,
        doc_type: v.doc_type,
        doc_number: v.doc_number,
        consumer_email: v.consumer_email,
        consumer_phone: v.consumer_phone,
        consumer_address: v.consumer_address,
        is_minor: v.is_minor,
        guardian_name: v.guardian_name,
        item_kind: v.item_kind,
        item_description: v.item_description,
        amount: v.amount ? Number(v.amount.replace(',', '.')) : null,
        order_reference: v.order_reference,
        detail: v.detail,
        request: v.request,
      }),
  })
  const menor = watch('is_minor')
  const reglaDoc = docRule(watch('doc_type'))
  const e = formState.errors
  const err = (campo: keyof Form) => (e[campo] ? t('store.complaints.invalid') : undefined)

  const proveedor = store.legal_name?.trim() || store.business_display_name?.trim() || store.name

  if (enviar.data) {
    return (
      <Stack sx={{ maxWidth: 720, mx: 'auto', py: 4, gap: 2, alignItems: 'flex-start' }} data-complaint-done>
        <CheckCircleRoundedIcon sx={{ fontSize: 44, color: 'var(--sf-ok, var(--accent-deep))' }} />
        <Typography component="h1" sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 800 }}>
          {t('store.complaints.done.title')}
        </Typography>
        <Typography sx={{ fontSize: TS.bodyStrong }}>
          {t('store.complaints.done.code')}{' '}
          <Box component="strong" className="tnum" data-complaint-code>
            {enviar.data.code}
          </Box>
        </Typography>
        <Typography sx={{ color: 'var(--muted)' }}>{t('store.complaints.done.body')}</Typography>
        <Button component={Link} to={`/s/${storeSlug}`} variant="contained">
          {t('store.complaints.done.back')}
        </Button>
      </Stack>
    )
  }

  return (
    <Box
      component="form"
      noValidate
      onSubmit={handleSubmit((v) => enviar.mutate(v))}
      sx={{ maxWidth: 820, mx: 'auto', py: { xs: 2, md: 3 } }}
    >
      <Typography component="h1" sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 800, letterSpacing: '-0.02em' }}>
        {t('store.complaints.book')}
      </Typography>
      <Typography sx={{ color: 'var(--muted)', mt: 1, mb: 3 }}>{t('store.complaints.intro')}</Typography>

      <Seccion titulo={`1. ${t('store.complaints.provider')}`}>
        <Dato etiqueta={t('store.complaints.provider.name')} valor={proveedor} />
        {store.tax_id ? <Dato etiqueta={t('store.footer.taxId')} valor={store.tax_id} /> : null}
        {store.contact_address ? <Dato etiqueta={t('store.contact.address')} valor={store.contact_address} /> : null}
        <Dato etiqueta={t('store.complaints.date')} valor={formatDate(new Date().toISOString(), locale)} />
      </Seccion>

      <Seccion titulo={`2. ${t('store.complaints.consumer')}`}>
        <Field label={t('store.complaints.field.name')} rule="personName" maxLength={160} required {...register('consumer_name')} error={!!e.consumer_name} helperText={err('consumer_name')} />
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
          <Controller
            control={control}
            name="doc_type"
            render={({ field }) => (
              <SelectField label={t('store.complaints.field.docType')} sx={{ minWidth: 180 }} {...field}>
                {DOC_TYPES.map((d) => (
                  <MenuItem key={d} value={d}>
                    {t(`store.complaints.doc.${d}` as MessageKey)}
                  </MenuItem>
                ))}
              </SelectField>
            )}
          />
          <Field
            label={t('store.complaints.field.docNumber')}
            rule={reglaDoc}
            help={t(`field.help.${reglaDoc}`)}
            required
            fullWidth
            {...register('doc_number')}
            error={!!e.doc_number}
            helperText={e.doc_number ? t(`field.error.${reglaDoc}`) : undefined}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
          <Field label={t('store.complaints.field.email')} type="email" rule="email" required fullWidth {...register('consumer_email')} error={!!e.consumer_email} helperText={err('consumer_email')} />
          <Field label={t('store.complaints.field.phone')} rule="phone" maxLength={21} fullWidth {...register('consumer_phone')} error={!!e.consumer_phone} helperText={err('consumer_phone')} />
        </Stack>
        <Field label={t('store.complaints.field.address')} rule="text" maxLength={240} {...register('consumer_address')} error={!!e.consumer_address} />
        <Controller
          control={control}
          name="is_minor"
          render={({ field }) => (
            <FormControlLabel
              control={<Checkbox checked={field.value} onChange={(_, v) => field.onChange(v)} />}
              label={t('store.complaints.field.minor')}
            />
          )}
        />
        {menor ? (
          <Field label={t('store.complaints.field.guardian')} rule="personName" maxLength={160} required {...register('guardian_name')} error={!!e.guardian_name} helperText={err('guardian_name')} />
        ) : null}
      </Seccion>

      <Seccion titulo={`3. ${t('store.complaints.item')}`}>
        <Controller
          control={control}
          name="item_kind"
          render={({ field }) => (
            <RadioGroup row {...field}>
              {ITEM_KINDS.map((k) => (
                <FormControlLabel key={k} value={k} control={<Radio />} label={t(`store.complaints.item.${k}` as MessageKey)} />
              ))}
            </RadioGroup>
          )}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
          <Field
            label={t('store.complaints.field.amount')}
            rule="money"
            maxLength={10}
            help={t('sfHelp.complaints.amount')}
            sx={{ minWidth: 200 }} {...register('amount')} error={!!e.amount} helperText={err('amount')} />
          <Field
            label={t('store.complaints.field.order')}
            rule="code"
            maxLength={40}
            help={t('sfHelp.complaints.order')}
            fullWidth
            {...register('order_reference')}
            error={!!e.order_reference}
            helperText={err('order_reference')}
          />
        </Stack>
        <Field label={t('store.complaints.field.itemDescription')} rule="longText" maxLength={500} required multiline minRows={2} {...register('item_description')} error={!!e.item_description} helperText={err('item_description')} />
      </Seccion>

      <Seccion titulo={`4. ${t('store.complaints.detail')}`}>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <RadioGroup {...field}>
              {COMPLAINT_KINDS.map((k) => (
                <FormControlLabel
                  key={k}
                  value={k}
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography sx={{ fontWeight: 700 }}>{t(`store.complaints.kind.${k}` as MessageKey)}</Typography>
                      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                        {t(`store.complaints.kind.${k}.help` as MessageKey)}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start', mb: 1 }}
                />
              ))}
            </RadioGroup>
          )}
        />
        <Field label={t('store.complaints.field.detail')} rule="longText" maxLength={3000} required multiline minRows={4} {...register('detail')} error={!!e.detail} helperText={err('detail') ?? t('store.complaints.field.detail.help')} />
        <Field label={t('store.complaints.field.request')} rule="longText" maxLength={2000} required multiline minRows={3} {...register('request')} error={!!e.request} helperText={err('request')} />
      </Seccion>

      <Controller
        control={control}
        name="accept"
        render={({ field }) => (
          <FormControlLabel
            control={<Checkbox checked={Boolean(field.value)} onChange={(_, v) => field.onChange(v)} />}
            label={<Typography sx={{ fontSize: TS.label }}>{t('store.complaints.accept')}</Typography>}
          />
        )}
      />
      {e.accept ? (
        <Typography sx={{ color: 'var(--red)', fontSize: TS.label }}>{t('store.complaints.acceptRequired')}</Typography>
      ) : null}

      {enviar.error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t(ERRORES[enviar.error.code] ?? 'store.complaints.error.generic')}
        </Alert>
      ) : null}

      <Button type="submit" variant="contained" size="large" className="sf-pdp-buy" disabled={enviar.isPending} sx={{ mt: 2, minWidth: 240 }}>
        {t('store.complaints.submit')}
      </Button>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 2 }}>{t('store.complaints.legal')}</Typography>
    </Box>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Box
      component="fieldset"
      sx={{ border: '1px solid var(--sf-line)', borderRadius: 'var(--sf-radius-sm, 8px)', p: { xs: 2, md: 2.5 }, mb: 2.5, minWidth: 0 }}
    >
      <Typography component="legend" sx={{ px: 1, fontWeight: 800, fontSize: TS.bodyStrong }}>
        {titulo}
      </Typography>
      <Stack sx={{ gap: 2 }}>{children}</Stack>
    </Box>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
      <Typography sx={{ fontWeight: 700, minWidth: 140 }}>{etiqueta}</Typography>
      <Typography>{valor}</Typography>
    </Stack>
  )
}
