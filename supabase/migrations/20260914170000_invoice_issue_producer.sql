-- =============================================================================
-- Cierre · D1 — el productor de `invoice.issue`
--
-- ## Lo que habia, y lo que faltaba
--
-- Estaba todo menos quien lo usara:
--
--   · el transporte (`integration_outbox` + `integration_enqueue`, 150000/150100
--     y 170000): idempotencia, reintento con espera, cola muerta, disyuntor,
--     bitacora de intentos y monitor (`integration_monitor`,
--     `integration_health`, `integration_retry`);
--   · el catalogo declara `invoice.issue` en el proveedor de facturacion, y
--     `src/domain/ports/invoicing.ts` escribe el contrato del adaptador;
--   · el documento (`invoices`, `invoice_items`, `invoice_events`, 20260902210000)
--     con sus guardas fiscales.
--
-- Y nada encolaba `invoice.issue`. Esta migracion es ese productor, sobre la
-- MISMA cola y el MISMO worker: ni segunda cola ni segundo trabajador.
--
-- ## El punto del ciclo de vida: la SOLICITUD de emision de un comprobante
--
-- Se descartaron dos candidatos, y el por que es la decision:
--
--   · «Pedido cobrado» (`orders.status = 'paid'`). No es una regla universal:
--     una venta B2B a credito se factura al despachar o al cierre del periodo,
--     una de vitrina al cobrar, y la serie fiscal y el documento del cliente son
--     configuracion del tenant que hoy no existe. Crear comprobantes fiscales a
--     partir de un estado del pedido seria decidir por el tenant con una
--     constante del codigo, que es justo lo que el contrato prohibe.
--
--   · «Alta de la fila en `invoices`» (trigger after insert). La cabecera y las
--     lineas se escriben en sentencias distintas —y por PostgREST, en
--     transacciones distintas—, asi que al insertar la cabecera el documento
--     todavia no esta completo. Emitir ahi mandaria a la autoridad un
--     comprobante sin lineas, y un comprobante emitido no se retira: se anula
--     con una nota.
--
-- El punto elegido es el COMANDO explicito «emitir este comprobante»
-- (`public.invoice_request_issue`), igual que `payment_refund_request` encola
-- `payment.refund` dentro de su propia transaccion (20260828120100): en este
-- catalogo las operaciones del outbox son ORDENES (`order.create`,
-- `payment.refund`) y las produce el comando que las decide, no un trigger que
-- las adivina. El comando exige que el documento este completo —estado
-- `pending`, al menos una linea y lineas que cuadran con la cabecera— y lo
-- congela en el payload.
--
-- El nucleo (`ebim.invoice_issue_enqueue`) es de servidor: lo usa el comando del
-- backoffice y lo puede usar un proceso con `service_role` (un ERP que da de
-- alta comprobantes) sin pasar por un JWT de usuario.
--
-- ## Idempotencia: UN mensaje por comprobante
--
-- Clave `invoice.issue:<invoice_id>`, unica por sociedad en el outbox
-- (`integration_outbox_unique`). Pedir la emision dos veces, reintentar la
-- llamada o repetirla despues de configurar el proveedor devuelve el MISMO
-- mensaje (`replay = true`) y no encola otro. Reintentar un mensaje fallido es
-- `integration_retry`, que ya existe y conserva los intentos gastados.
--
-- ## Tenant sin proveedor fiscal: no falla, queda a la vista
--
-- `integration_enqueue` levanta `INTEGRACION_NO_ACTIVA` si la sociedad no tiene
-- el conector activo. Aqui eso NO se propaga: la solicitud queda registrada en
-- `invoice_issue_requests` con estado `pending_configuration` y un codigo
-- estable (`FACTURADOR_NO_CONFIGURADO`, o `FACTURADOR_AMBIGUO` si hay mas de
-- uno activo y no hay forma honesta de elegir), se anota en `invoice_events`,
-- y abre un incidente `integration_failed` de severidad `warning` en
-- `ops_events` (el tablero de operacion que ya existe). Cuando el tenant
-- configure su proveedor, volver a pedir la emision encola el mensaje y cierra
-- el incidente. No se implementa ningun proveedor fiscal concreto: no hay
-- contrato ni credenciales; el adaptador sigue siendo `InvoicingProvider`.
--
-- ## Tenant binding
--
-- `organization_id`/`company_id` salen de la FILA del comprobante, nunca de un
-- parametro: el comando solo recibe el id. Quien no tiene acceso a esa sociedad
-- recibe «no encontrado», no «sin permiso», para no confirmar que el id existe.
--
-- ## Payload canonico, version 1
--
-- Formato de cable en snake_case, importes como TEXTO (regla del repositorio
-- desde P02) y `schema_version` para que el adaptador sepa que lee. La forma la
-- declara tambien `INVOICE_ISSUE_PAYLOAD_KEYS` en `src/domain/ports/invoicing.ts`
-- y un test comprueba que las dos coinciden.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. invoice_issue_requests — la solicitud de emision, una por comprobante
--
-- El estado de ENTREGA no se copia aqui: vive en `integration_outbox` y se une
-- por la clave de idempotencia. Lo que esta tabla guarda es lo que el outbox no
-- puede representar —«se pidio y no hay a quien mandarlo»— y quien lo pidio.
-- ---------------------------------------------------------------------------
create table public.invoice_issue_requests (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  invoice_id      uuid        not null,
  state           text        not null,
  blocked_code    text,
  provider_code   text        references public.integration_providers (code) on delete restrict,
  idempotency_key text        not null,
  schema_version  smallint    not null,
  request_count   integer     not null default 1,
  requested_by    uuid,
  first_requested_at timestamptz not null default now(),
  last_requested_at  timestamptz not null default now(),
  enqueued_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invoice_issue_requests_state
    check (state in ('enqueued', 'pending_configuration')),
  -- Encolada lleva proveedor y fecha; bloqueada lleva el motivo. Una fila que
  -- dice «encolada» sin proveedor, o «bloqueada» sin motivo, miente.
  constraint invoice_issue_requests_shape check (
    (state = 'enqueued' and provider_code is not null and enqueued_at is not null
       and blocked_code is null)
    or (state = 'pending_configuration' and blocked_code is not null)
  ),
  constraint invoice_issue_requests_blocked_fmt
    check (blocked_code is null or blocked_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  constraint invoice_issue_requests_idem_len
    check (char_length(idempotency_key) between 8 and 200),
  constraint invoice_issue_requests_version check (schema_version >= 1),
  constraint invoice_issue_requests_count check (request_count >= 1),
  constraint invoice_issue_requests_once unique (organization_id, company_id, invoice_id),
  constraint invoice_issue_requests_invoice_fk
    foreign key (invoice_id, organization_id, company_id)
    references public.invoices (id, organization_id, company_id) on delete cascade
);

create index invoice_issue_requests_tenant_idx
  on public.invoice_issue_requests (organization_id, company_id);
create index invoice_issue_requests_blocked_idx
  on public.invoice_issue_requests (organization_id, company_id, last_requested_at desc)
  where state = 'pending_configuration';

create trigger invoice_issue_requests_updated_at
  before update on public.invoice_issue_requests
  for each row execute function ebim.set_updated_at();

alter table public.invoice_issue_requests enable row level security;
alter table public.invoice_issue_requests force  row level security;

-- Solo lectura desde el cliente. La escribe el comando: un estado que el
-- navegador pudiera reescribir no seria un estado, seria una sugerencia.
revoke all on public.invoice_issue_requests from public, anon, authenticated;
grant select on public.invoice_issue_requests to authenticated;
grant all on public.invoice_issue_requests to service_role;

-- Mismo publico que el comprobante (`invoices_select_member`).
create policy invoice_issue_requests_select_member on public.invoice_issue_requests
  for select to authenticated
  using (
    ebim.can_access(organization_id, company_id)
    and ebim.has_role(organization_id, company_id,
                      array['owner','admin','orders']::public.app_role[])
  );

-- ---------------------------------------------------------------------------
-- 2. ebim.invoice_issue_enqueue — el nucleo. Servidor.
--
-- Nunca recibe el tenant: lo lee de la fila del comprobante.
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_issue_enqueue(
  p_invoice_id   uuid,
  p_requested_by uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_version   constant smallint := 1;
  v_inv       public.invoices%rowtype;
  v_req       public.invoice_issue_requests%rowtype;
  v_key       text;
  v_lines     jsonb;
  v_count     integer;
  v_net       numeric;
  v_tax       numeric;
  v_providers text[];
  v_blocked   text;
  v_outbox    uuid;
  v_status    text;
  v_payload   jsonb;
begin
  -- Bloqueo de la fila: dos solicitudes simultaneas del mismo comprobante se
  -- serializan aqui y la segunda ve lo que hizo la primera.
  select * into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante'
      using errcode = '22023';
  end if;

  v_key := 'invoice.issue:' || v_inv.id::text;

  select * into v_req
    from public.invoice_issue_requests r
   where r.organization_id = v_inv.organization_id
     and r.company_id      = v_inv.company_id
     and r.invoice_id      = v_inv.id;

  -- Ya encolada: la repeticion devuelve el mismo mensaje, en cualquier estado
  -- del comprobante. Es la propiedad que deja reintentar sin pensarlo.
  if found and v_req.state = 'enqueued' then
    update public.invoice_issue_requests
       set request_count = request_count + 1, last_requested_at = now()
     where id = v_req.id;

    select o.id, o.status::text into v_outbox, v_status
      from public.integration_outbox o
     where o.organization_id = v_inv.organization_id
       and o.company_id      = v_inv.company_id
       and o.idempotency_key = v_key;

    return jsonb_build_object(
      'invoice_id',     v_inv.id,
      'state',          'enqueued',
      'provider_code',  v_req.provider_code,
      'outbox_id',      v_outbox,
      'outbox_status',  v_status,
      'schema_version', v_req.schema_version,
      'replay',         true);
  end if;

  -- Solo se emite lo que esta pendiente de emitir. Un comprobante emitido,
  -- aceptado, rechazado o anulado ya tuvo su emision o ya no la tendra.
  if v_inv.status <> 'pending' then
    raise exception 'COMPROBANTE_NO_EMITIBLE: el comprobante esta en estado %', v_inv.status
      using errcode = '22023';
  end if;

  -- El documento tiene que estar COMPLETO: lo que sale no se retira.
  select count(*),
         coalesce(sum(it.net_amount), 0),
         coalesce(sum(it.tax_amount), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'position',    it.position,
           'description', it.description,
           'quantity',    it.quantity::text,
           'unit_price',  it.unit_price::text,
           'net_amount',  it.net_amount::text,
           'tax_rate',    it.tax_rate::text,
           'tax_amount',  it.tax_amount::text)
           order by it.position, it.created_at, it.id), '[]'::jsonb)
    into v_count, v_net, v_tax, v_lines
    from public.invoice_items it
   where it.organization_id = v_inv.organization_id
     and it.company_id      = v_inv.company_id
     and it.invoice_id      = v_inv.id;

  if v_count = 0 then
    raise exception 'COMPROBANTE_SIN_LINEAS: un comprobante sin lineas no se emite'
      using errcode = '22023';
  end if;
  if v_net <> v_inv.net_total or v_tax <> v_inv.tax_total then
    raise exception 'COMPROBANTE_DESCUADRADO: las lineas no suman los totales de la cabecera'
      using errcode = '22023';
  end if;

  -- El proveedor fiscal es DATO del tenant: el conector activo de familia
  -- `invoicing` que declara `invoice.issue`. Ningun codigo de proveedor aqui.
  select coalesce(array_agg(ti.provider_code order by ti.provider_code), '{}'::text[])
    into v_providers
    from public.tenant_integrations ti
    join public.integration_providers p on p.code = ti.provider_code
   where ti.organization_id = v_inv.organization_id
     and ti.company_id      = v_inv.company_id
     and ti.is_active
     and p.is_active
     and p.kind = 'invoicing'
     and 'invoice.issue' = any (p.capabilities);

  v_blocked := case cardinality(v_providers)
                 when 0 then 'FACTURADOR_NO_CONFIGURADO'
                 when 1 then null
                 else 'FACTURADOR_AMBIGUO'
               end;

  if v_blocked is not null then
    insert into public.invoice_issue_requests as r (
      organization_id, company_id, invoice_id, state, blocked_code,
      idempotency_key, schema_version, requested_by
    ) values (
      v_inv.organization_id, v_inv.company_id, v_inv.id, 'pending_configuration', v_blocked,
      v_key, c_version, p_requested_by
    )
    on conflict (organization_id, company_id, invoice_id) do update
      set blocked_code      = excluded.blocked_code,
          request_count     = r.request_count + 1,
          last_requested_at = now()
    returning * into v_req;

    insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
    values (v_inv.organization_id, v_inv.company_id, v_inv.id, 'pending', v_blocked);

    -- Incidente de operacion, uno por comprobante: pedirlo otra vez sube el
    -- contador del mismo incidente en vez de abrir otro.
    perform ebim.record_ops_event(
      p_organization_id => v_inv.organization_id,
      p_company_id      => v_inv.company_id,
      p_store_id        => v_inv.store_id,
      p_kind            => 'integration_failed',
      p_code            => v_blocked,
      p_dedupe_key      => v_key,
      p_severity        => 'warning',
      p_message         => case v_blocked
                             when 'FACTURADOR_AMBIGUO'
                               then 'Hay mas de un proveedor fiscal activo; no se elige uno a ciegas'
                             else 'La sociedad no tiene un proveedor fiscal activo'
                           end,
      p_operation       => 'invoice.issue',
      p_entity_type     => 'invoice',
      p_entity_id       => v_inv.id,
      p_context         => jsonb_build_object('providers', cardinality(v_providers)));

    return jsonb_build_object(
      'invoice_id',     v_inv.id,
      'state',          'pending_configuration',
      'blocked_code',   v_blocked,
      'provider_code',  null,
      'outbox_id',      null,
      'outbox_status',  null,
      'schema_version', c_version,
      'replay',         v_req.request_count > 1);
  end if;

  v_payload := jsonb_build_object(
    'schema_version',  c_version,
    'operation',       'invoice.issue',
    'idempotency_key', v_key,
    'organization_id', v_inv.organization_id,
    'company_id',      v_inv.company_id,
    'store_id',        v_inv.store_id,
    'invoice_id',      v_inv.id,
    'order_id',        v_inv.order_id,
    'series',          v_inv.series,
    'issued_at',       to_char(v_inv.issued_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'currency',        v_inv.currency,
    'customer',        jsonb_build_object('name',   v_inv.customer_name,
                                          'tax_id', v_inv.customer_tax_id),
    'totals',          jsonb_build_object('net',   v_inv.net_total::text,
                                          'tax',   v_inv.tax_total::text,
                                          'gross', v_inv.gross_total::text),
    'lines',           v_lines);

  -- La cola de siempre. Idempotente por la clave: si otro camino ya lo encolo,
  -- devuelve ese mensaje.
  v_outbox := public.integration_enqueue(
    v_inv.organization_id, v_inv.company_id, v_providers[1],
    'invoice.issue', v_payload, v_key);

  insert into public.invoice_issue_requests as r (
    organization_id, company_id, invoice_id, state, provider_code,
    idempotency_key, schema_version, requested_by, enqueued_at
  ) values (
    v_inv.organization_id, v_inv.company_id, v_inv.id, 'enqueued', v_providers[1],
    v_key, c_version, p_requested_by, now()
  )
  on conflict (organization_id, company_id, invoice_id) do update
    set state             = 'enqueued',
        blocked_code      = null,
        provider_code     = excluded.provider_code,
        enqueued_at       = now(),
        request_count     = r.request_count + 1,
        last_requested_at = now()
  returning * into v_req;

  -- El comprobante apunta quien lo va a emitir. `provider_code` es columna del
  -- documento desde 20260902210000 y el guard permite tocarlo en `pending`.
  update public.invoices
     set provider_code = v_providers[1]
   where id = v_inv.id
     and provider_code is distinct from v_providers[1];

  insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
  values (v_inv.organization_id, v_inv.company_id, v_inv.id, 'pending',
          'EMISION_ENCOLADA:' || v_providers[1]);

  -- Si hubo un incidente por falta de proveedor, se cierra: ya no aplica.
  update public.ops_events e
     set resolved_at     = now(),
         resolved_by     = p_requested_by,
         resolution_note = 'Emision encolada tras configurar el proveedor fiscal'
   where e.organization_id = v_inv.organization_id
     and e.company_id      = v_inv.company_id
     and e.dedupe_key      = v_key
     and e.resolved_at is null;

  select o.status::text into v_status from public.integration_outbox o where o.id = v_outbox;

  return jsonb_build_object(
    'invoice_id',     v_inv.id,
    'state',          'enqueued',
    'provider_code',  v_providers[1],
    'outbox_id',      v_outbox,
    'outbox_status',  v_status,
    'schema_version', c_version,
    'replay',         false);
end;
$fn$;

revoke execute on function ebim.invoice_issue_enqueue(uuid, uuid)
  from public, anon, authenticated;
grant execute on function ebim.invoice_issue_enqueue(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. public.invoice_request_issue — el comando del backoffice
-- ---------------------------------------------------------------------------
create or replace function public.invoice_request_issue(p_invoice_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_inv    public.invoices%rowtype;
  v_result jsonb;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id;

  -- Sin acceso a la sociedad del comprobante es «no existe»: decir «sin
  -- permiso» confirmaria que ese id es un comprobante de otro tenant.
  if not found or not ebim.can_access(v_inv.organization_id, v_inv.company_id) then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante'
      using errcode = '22023';
  end if;

  -- El mismo publico que puede escribir el comprobante (`invoices_write_admin`).
  if not ebim.has_role(v_inv.organization_id, v_inv.company_id,
                       array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: emitir un comprobante es cosa del propietario o un administrador'
      using errcode = '42501';
  end if;
  if not ebim.has_capability(v_inv.organization_id, v_inv.company_id, 'invoicing') then
    raise exception 'MODULO_NO_CONTRATADO: la facturacion no esta activa para esta sociedad'
      using errcode = '42501';
  end if;

  v_result := ebim.invoice_issue_enqueue(v_inv.id, ebim.user_id());

  perform ebim.audit(
    p_organization_id => v_inv.organization_id,
    p_company_id      => v_inv.company_id,
    p_action          => 'invoice.issue_requested',
    p_entity_type     => 'invoice',
    p_entity_id       => v_inv.id,
    p_entity_label    => v_inv.series,
    p_store_id        => v_inv.store_id,
    p_metadata        => jsonb_build_object(
                           'state',         v_result ->> 'state',
                           'blocked_code',  v_result ->> 'blocked_code',
                           'provider_code', v_result ->> 'provider_code',
                           'replay',        (v_result ->> 'replay')::boolean));

  return v_result;
end;
$fn$;

revoke execute on function public.invoice_request_issue(uuid) from public, anon;
grant execute on function public.invoice_request_issue(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. invoice_issue_status — lo que la pantalla lee
--
-- `security_invoker`: no amplia ni un permiso. Une el comprobante, su
-- solicitud y el mensaje del outbox por la clave de idempotencia, y deriva UN
-- estado legible: not_requested · pending_configuration · pending · in_flight ·
-- succeeded · failed · dead.
-- ---------------------------------------------------------------------------
create or replace view public.invoice_issue_status
with (security_invoker = on) as
select
  i.id                     as invoice_id,
  i.organization_id,
  i.company_id,
  i.status::text           as invoice_status,
  coalesce(o.status::text, r.state, 'not_requested') as issue_state,
  r.blocked_code,
  coalesce(r.provider_code, o.provider_code) as provider_code,
  r.schema_version,
  r.request_count,
  r.first_requested_at,
  r.last_requested_at,
  r.enqueued_at,
  o.id                     as outbox_id,
  o.attempts,
  o.max_attempts,
  o.next_retry_at,
  o.completed_at,
  ebim.redact_text(o.last_error, 300) as last_error
from public.invoices i
left join public.invoice_issue_requests r
  on r.organization_id = i.organization_id
 and r.company_id      = i.company_id
 and r.invoice_id      = i.id
left join public.integration_outbox o
  on o.organization_id = i.organization_id
 and o.company_id      = i.company_id
 and o.idempotency_key = 'invoice.issue:' || i.id::text;

revoke all on public.invoice_issue_status from public, anon;
grant select on public.invoice_issue_status to authenticated, service_role;

comment on table public.invoice_issue_requests is
  'Solicitud de emision de un comprobante (una por comprobante). Guarda lo que el outbox no puede: «se pidio y la sociedad no tiene proveedor fiscal». La entrega vive en integration_outbox.';
comment on function ebim.invoice_issue_enqueue(uuid, uuid) is
  'Productor de invoice.issue sobre integration_outbox. Tenant de la fila, clave invoice.issue:<id>, payload v1. Sin proveedor fiscal no falla: queda pending_configuration y abre un incidente warning.';
comment on function public.invoice_request_issue(uuid) is
  'Comando del backoffice para emitir un comprobante completo. Owner/admin con la capacidad invoicing; el tenant sale del comprobante, nunca de un parametro.';
comment on view public.invoice_issue_status is
  'Estado de emision por comprobante: not_requested, pending_configuration o el estado del mensaje en el outbox. security_invoker.';
