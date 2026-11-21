import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  API_SCOPES,
  API_VERSION,
} from '../../../../supabase/functions/_shared/api/contract.ts'
import { API_ROUTES, type ApiParam, type ApiRoute } from '../../../../supabase/functions/_shared/api/routes.ts'
import { eventLabel } from '@/shared/i18n/codeLabels'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { SUPABASE_URL } from '@/shared/lib/env'
import { BrandLockup } from '@/shared/ui/BrandLockup'
import { BRAND_FONT_STACKS, TS } from '@/theme/tokens'
import { WEBHOOK_EVENT_TYPES } from '../webhookEvents'
import {
  CATALOG_REQUEST_EXAMPLE,
  POSTMAN_TOKEN_SCRIPT,
  RESPONSE_EXAMPLES,
  TOKEN_OPERATION_ID,
  TOKEN_REQUEST_EXAMPLE,
  WEBHOOK_BODY_EXAMPLE,
  WEBHOOK_SIGNATURE_SNIPPET,
} from './apiExamples'

/**
 * Guía pública de la API de socio, dentro de la app: `/api` (2026-11-21).
 *
 * La lee el técnico del ERP de un cliente, que no tiene cuenta en el panel: por
 * eso es pública y no lleva nada que no sea ya público (rutas, formatos, la URL
 * de la función). Rutas, permisos, parámetros y cuerpos salen de `API_ROUTES`,
 * la tabla con la que el gateway despacha: una ruta nueva aparece aquí sola, y
 * esta página no puede describir una ruta que no existe.
 *
 * No hay «Probar»: la API cierra CORS a propósito (la llama un servidor, no un
 * navegador), así que la página da cada llamada lista para copiar en Postman.
 */

const MONO = BRAND_FONT_STACKS.mono
const API_BASE = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/api`
const OPENAPI_URL = `${API_BASE}/${API_VERSION}/openapi.json`

/** Para el índice y las anclas: la ficha del token no está en la tabla. */
interface DocRoute {
  readonly id: string
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly summary: string
  readonly scope: string | null
  readonly params: readonly (ApiParam & { in: 'path' | 'query' })[]
  readonly idempotent: boolean
  readonly body: unknown
}

function docRoutes(tokenSummary: string): DocRoute[] {
  const fromTable = API_ROUTES.map((route: ApiRoute): DocRoute => ({
    id: route.operationId,
    method: route.method,
    path: route.path,
    summary: route.summary,
    scope: route.scope,
    params: [
      ...(route.pathParams ?? []).map((p) => ({ ...p, in: 'path' as const })),
      ...(route.query ?? []).map((p) => ({ ...p, in: 'query' as const })),
    ],
    idempotent: route.requiresIdempotencyKey === true,
    body:
      route.method === 'POST'
        ? route.operationId === 'upsertCatalogProducts'
          ? CATALOG_REQUEST_EXAMPLE
          : route.requestExample ?? null
        : null,
  }))
  return [
    {
      id: TOKEN_OPERATION_ID,
      method: 'POST',
      path: `/${API_VERSION}/oauth/token`,
      summary: tokenSummary,
      scope: null,
      params: [],
      idempotent: false,
      body: TOKEN_REQUEST_EXAMPLE,
    },
    ...fromTable,
  ]
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip title={copied ? t('apiDocs.copied') : label}>
      <IconButton
        size="small"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            })
            .catch(() => undefined)
        }}
        sx={{ color: 'inherit' }}
      >
        <ContentCopyRoundedIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  )
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  const { t } = useI18n()
  return (
    <Box sx={{ minWidth: 0 }}>
      {title && <Eyebrow>{title}</Eyebrow>}
      <Box
        sx={{
          position: 'relative',
          bgcolor: '#0f1d1a',
          color: '#dbe9e3',
          borderRadius: 2,
          '& pre': { m: 0, p: 2, pr: 5, overflowX: 'auto', fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6 },
        }}
      >
        <Box sx={{ position: 'absolute', top: 6, right: 6 }}>
          <CopyButton text={code} label={t('apiDocs.copy')} />
        </Box>
        <pre>{code}</pre>
      </Box>
    </Box>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{ fontSize: TS.label, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75 }}
    >
      {children}
    </Typography>
  )
}

function MethodChip({ method }: { method: 'GET' | 'POST' }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: 11.5,
        px: 1,
        py: 0.25,
        borderRadius: 1,
        bgcolor: method === 'GET' ? 'var(--accent-soft)' : 'var(--amber-soft)',
        color: method === 'GET' ? 'var(--accent-deep)' : 'var(--text)',
      }}
    >
      {method}
    </Box>
  )
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <Box component="section" id={id} sx={{ scrollMarginTop: 24, mt: 7 }}>
      <Typography component="h2" sx={{ fontSize: TS.pageTitle, fontWeight: 800, letterSpacing: '-0.3px', mb: 0.75 }}>
        {title}
      </Typography>
      {lead && <Typography sx={{ color: 'var(--muted)', maxWidth: '68ch', mb: 2.5 }}>{lead}</Typography>}
      {children}
    </Box>
  )
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

function EndpointCard({ route }: { route: DocRoute }) {
  const { t } = useI18n()
  const example = RESPONSE_EXAMPLES[route.id]
  const query = route.params.filter((p) => p.in === 'query')
  const sampleUrl =
    `${API_BASE}${route.path}` +
    (query.some((p) => p.name === 'store') ? '?store=miquimica' : '')
  return (
    <Card id={route.id} sx={{ p: { xs: 2, md: 2.5 }, mt: 2, scrollMarginTop: 24 }}>
      <Stack direction="row" sx={{ gap: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
        <MethodChip method={route.method} />
        <Typography sx={{ fontFamily: MONO, fontWeight: 700, fontSize: 15, overflowWrap: 'anywhere', minWidth: 0 }}>
          {route.path}
        </Typography>
        <Box sx={{ ml: { md: 'auto' }, width: { xs: '100%', md: 'auto' } }}>
          {route.scope ? (
            <Chip size="small" label={`${t('apiDocs.permission')}: ${route.scope}`} sx={{ fontFamily: MONO }} />
          ) : (
            <Chip size="small" label={t('apiDocs.noToken')} />
          )}
        </Box>
      </Stack>
      <Typography sx={{ mt: 1.25, maxWidth: '72ch' }}>{route.summary}</Typography>

      <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>
        {route.idempotent && (
          <Chip size="small" label={t('apiDocs.needsIdempotency')} sx={{ bgcolor: 'var(--amber-soft)' }} />
        )}
      </Stack>

      {route.params.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Eyebrow>{t('apiDocs.params')}</Eyebrow>
          <Box sx={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 2 }}>
            <Table size="small">
              <TableBody>
                {route.params.map((param) => (
                  <TableRow key={`${param.in}-${param.name}`}>
                    <TableCell sx={{ fontFamily: MONO, fontWeight: 700, whiteSpace: 'nowrap' }}>{param.name}</TableCell>
                    <TableCell sx={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {param.in === 'path' ? t('apiDocs.inPath') : t('apiDocs.inQuery')} · {param.kind}
                    </TableCell>
                    <TableCell>{param.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}

      <Box sx={{ mt: 2 }}>
        <CodeBlock title={t('apiDocs.fullUrl')} code={`${route.method} ${sampleUrl}`} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: route.body ? '1fr 1fr' : '1fr' }, gap: 2, mt: 2 }}>
        {route.body != null && <CodeBlock title={t('apiDocs.body')} code={json(route.body)} />}
        {example !== undefined && <CodeBlock title={t('apiDocs.response')} code={json(example)} />}
      </Box>
    </Card>
  )
}

export function ApiDocsPage() {
  const { t } = useI18n()
  const routes = docRoutes(t('apiDocs.tokenSummary'))

  // Llegar con `/api#listOrders` lleva a esa ficha: la página se monta después
  // de que el navegador intentara el salto, así que se repite aquí.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  const nav: { group: string; items: { id: string; label: ReactNode }[] }[] = [
    {
      group: t('apiDocs.nav.start'),
      items: [
        { id: 'inicio', label: t('apiDocs.quick.title') },
        { id: 'conceptos', label: t('apiDocs.concepts.title') },
        { id: 'postman', label: 'Postman' },
      ],
    },
    {
      group: t('apiDocs.nav.routes'),
      items: routes.map((route) => ({
        id: route.id,
        label: (
          <Stack direction="row" sx={{ gap: 1, alignItems: 'center', minWidth: 0 }}>
            <Box component="span" sx={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, width: 34, flexShrink: 0, color: route.method === 'GET' ? 'var(--accent-deep)' : 'var(--muted)' }}>
              {route.method}
            </Box>
            <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere', minWidth: 0 }}>
              {route.path.replace(`/${API_VERSION}`, '')}
            </Box>
          </Stack>
        ),
      })),
    },
    {
      group: t('apiDocs.nav.reference'),
      items: [
        { id: 'errores', label: t('apiDocs.errors.title') },
        { id: 'webhooks', label: t('apiDocs.webhooks.title') },
      ],
    },
  ]

  const statuses = [...new Set(API_ERROR_CODES.map((code) => API_ERROR_STATUS[code]))].sort((a, b) => a - b)

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100dvh', color: 'var(--text)' }}>
      <Box
        component="header"
        sx={{ borderBottom: '1px solid var(--border)', bgcolor: 'var(--card)', px: { xs: 2, md: 4 }, py: 1.5 }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap', maxWidth: 1240, mx: 'auto' }}>
          <BrandLockup size={30} />
          <Chip size="small" label={`API ${API_VERSION}`} sx={{ fontFamily: MONO, fontWeight: 700 }} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" href={OPENAPI_URL} target="_blank" rel="noreferrer" endIcon={<OpenInNewRoundedIcon />}>
            OpenAPI
          </Button>
          <Button size="small" variant="contained" component={Link} to="/app/integrations#api">
            {t('apiDocs.toPanel')}
          </Button>
        </Stack>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '250px minmax(0, 1fr)' },
          gap: { xs: 3, md: 6 },
          maxWidth: 1240,
          mx: 'auto',
          px: { xs: 2, md: 4 },
          py: { xs: 3, md: 5 },
        }}
      >
        <Box
          component="nav"
          aria-label={t('apiDocs.nav.label')}
          sx={{
            position: { md: 'sticky' },
            top: { md: 24 },
            alignSelf: 'start',
            maxHeight: { md: 'calc(100dvh - 48px)' },
            overflowY: { md: 'auto' },
            border: { xs: '1px solid var(--border)', md: 0 },
            borderRadius: 2,
            p: { xs: 1.5, md: 0 },
            bgcolor: { xs: 'var(--card)', md: 'transparent' },
          }}
        >
          {nav.map((group) => (
            <Box key={group.group} sx={{ mb: 2 }}>
              <Eyebrow>{group.group}</Eyebrow>
              {group.items.map((item) => (
                <Box
                  key={item.id}
                  component="a"
                  href={`#${item.id}`}
                  sx={{
                    display: 'block',
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    color: 'var(--text)',
                    textDecoration: 'none',
                    fontSize: TS.body,
                    '&:hover': { bgcolor: 'var(--accent-soft)' },
                  }}
                >
                  {item.label}
                </Box>
              ))}
            </Box>
          ))}
        </Box>

        <Box component="main" sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: { xs: 28, md: 38 }, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 1.15, textWrap: 'balance' }}>
            {t('apiDocs.title')}
          </Typography>
          <Typography sx={{ color: 'var(--muted)', fontSize: TS.bodyStrong + 1.5, maxWidth: '66ch', mt: 1.5 }}>
            {t('apiDocs.subtitle')}
          </Typography>
          <Card sx={{ mt: 2.5, p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: TS.label, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>
              {t('apiDocs.baseUrl')}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: 13.5, overflowWrap: 'anywhere', flex: '1 1 260px', minWidth: 0 }}>
              {API_BASE}
            </Typography>
            <CopyButton text={API_BASE} label={t('apiDocs.copy')} />
          </Card>

          <Section id="inicio" title={t('apiDocs.quick.title')} lead={t('apiDocs.quick.lead')}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 1.5 }}>
              {([1, 2, 3, 4] as const).map((n) => (
                <Card key={n} sx={{ p: 2 }}>
                  <Typography sx={{ fontSize: TS.label, fontWeight: 800, color: 'var(--accent-deep)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('apiDocs.quick.step')} {n}
                  </Typography>
                  <Typography sx={{ fontWeight: 800, mt: 0.5 }}>{t(`apiDocs.quick.s${n}.title` as MessageKey)}</Typography>
                  <Typography sx={{ color: 'var(--muted)', fontSize: TS.body, mt: 0.5 }}>
                    {t(`apiDocs.quick.s${n}.body` as MessageKey)}
                  </Typography>
                </Card>
              ))}
            </Box>
          </Section>

          <Section id="conceptos" title={t('apiDocs.concepts.title')}>
            {(['auth', 'store', 'idempotency', 'paging', 'limits', 'money'] as const).map((key) => (
              <Box key={key} sx={{ mb: 2.5 }}>
                <Typography component="h3" sx={{ fontWeight: 800, fontSize: TS.cardTitle + 1 }}>
                  {t(`apiDocs.concepts.${key}.title` as MessageKey)}
                </Typography>
                <Typography sx={{ maxWidth: '72ch', mt: 0.5 }}>{t(`apiDocs.concepts.${key}.body` as MessageKey)}</Typography>
              </Box>
            ))}
            <Typography component="h3" sx={{ fontWeight: 800, fontSize: TS.cardTitle + 1, mb: 1 }}>
              {t('apiDocs.concepts.scopes.title')}
            </Typography>
            <Box sx={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--card)' }}>
              <Table size="small">
                <TableBody>
                  {API_SCOPES.map((scope) => (
                    <TableRow key={scope}>
                      <TableCell sx={{ fontFamily: MONO, fontWeight: 700, whiteSpace: 'nowrap' }}>{scope}</TableCell>
                      <TableCell>{t(`apiDocs.scope.${scope}` as MessageKey)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Section>

          <Section id="postman" title={t('apiDocs.postman.title')} lead={t('apiDocs.postman.lead')}>
            <Box component="ol" sx={{ pl: 2.5, m: 0, '& li': { mb: 1.25, maxWidth: '72ch' } }}>
              <li>{t('apiDocs.postman.s1')}</li>
              <li>{t('apiDocs.postman.s2')}</li>
              <li>
                {t('apiDocs.postman.s3')}
                <Box sx={{ mt: 1 }}>
                  <CodeBlock code={POSTMAN_TOKEN_SCRIPT} />
                </Box>
              </li>
              <li>{t('apiDocs.postman.s4')}</li>
              <li>{t('apiDocs.postman.s5')}</li>
            </Box>
          </Section>

          <Section id="rutas" title={t('apiDocs.routes.title')} lead={t('apiDocs.routes.lead')}>
            {routes.map((route) => (
              <EndpointCard key={route.id} route={route} />
            ))}
          </Section>

          <Section id="errores" title={t('apiDocs.errors.title')} lead={t('apiDocs.errors.lead')}>
            <CodeBlock
              code={json({ error: { code: 'SCOPE_INSUFICIENTE', message: '…', status: 403, correlation_id: 'ec-…', request_id: 'req-…' } })}
            />
            <Box sx={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--card)', mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>HTTP</TableCell>
                    <TableCell>{t('apiDocs.errors.code')}</TableCell>
                    <TableCell>{t('apiDocs.errors.todo')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {statuses.map((status) => (
                    <TableRow key={status}>
                      <TableCell sx={{ fontFamily: MONO, fontWeight: 700 }}>{status}</TableCell>
                      <TableCell sx={{ fontFamily: MONO, fontSize: 12.5 }}>
                        {API_ERROR_CODES.filter((code) => API_ERROR_STATUS[code] === status).join(', ')}
                      </TableCell>
                      <TableCell>{t(`apiDocs.errors.hint.${status}` as MessageKey)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={{ fontFamily: MONO, fontWeight: 700 }}>422</TableCell>
                    <TableCell sx={{ fontSize: 12.5 }}>{t('apiDocs.errors.batch')}</TableCell>
                    <TableCell>{t('apiDocs.errors.hint.422')}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
          </Section>

          <Section id="webhooks" title={t('apiDocs.webhooks.title')} lead={t('apiDocs.webhooks.lead')}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <CodeBlock title={t('apiDocs.body')} code={json(WEBHOOK_BODY_EXAMPLE)} />
              <CodeBlock
                title={t('apiDocs.webhooks.headers')}
                code={['x-ebim-event-type: order.created', 'x-ebim-event-id: …', 'x-ebim-delivery-id: …', 'x-ebim-signature: t=1763696808,v1=<hex>'].join('\n')}
              />
            </Box>
            <Typography component="h3" sx={{ fontWeight: 800, fontSize: TS.cardTitle + 1, mt: 3 }}>
              {t('apiDocs.webhooks.signature')}
            </Typography>
            <Typography sx={{ maxWidth: '72ch', mt: 0.5, mb: 1.5 }}>{t('apiDocs.webhooks.signatureBody')}</Typography>
            <CodeBlock code={WEBHOOK_SIGNATURE_SNIPPET} />
            <Typography component="h3" sx={{ fontWeight: 800, fontSize: TS.cardTitle + 1, mt: 3, mb: 1 }}>
              {t('apiDocs.webhooks.events')}
            </Typography>
            <Box sx={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--card)' }}>
              <Table size="small">
                <TableBody>
                  {WEBHOOK_EVENT_TYPES.map((eventType) => (
                    <TableRow key={eventType}>
                      <TableCell sx={{ fontFamily: MONO, fontWeight: 700, whiteSpace: 'nowrap' }}>{eventType}</TableCell>
                      <TableCell>{eventLabel(t, eventType)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Typography sx={{ color: 'var(--muted)', maxWidth: '72ch', mt: 1.5 }}>{t('apiDocs.webhooks.wildcard')}</Typography>
          </Section>

          <Typography sx={{ color: 'var(--muted)', fontSize: TS.label, mt: 8, pt: 2, borderTop: '1px solid var(--border)' }}>
            {t('apiDocs.footer')}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
