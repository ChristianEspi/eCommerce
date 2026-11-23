-- =============================================================================
-- Aviso al backoffice cuando un cliente pide cotización (2026-11-22)
-- =============================================================================
--
-- `request_quote` (vitrina: «Pedir cotización» y «Pedir mejor precio» de
-- «Mejora esta cotización») publica `quote.requested`, pero el reparto de avisos
-- no lo atendía: la solicitud quedaba en borrador sin que nadie se enterara.
--
-- Este disparador, aparte del reparto general para no reescribirlo, avisa en la
-- campana a owner/admin/pedidos y al vendedor asignado a la solicitud si tiene acceso. Lleva el
-- número de la solicitud y la cuenta; el enlace abre Cotizaciones filtrado por
-- ese número. Idempotente por evento y destinatario (`dedupe`).
-- =============================================================================

create or replace function ebim.notify_quote_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_quote   public.quotes%rowtype;
  v_cuenta  text;
  v_params  jsonb;
  v_link    text;
  v_user    uuid;
begin
  if new.event_type <> 'quote.requested' then
    return new;
  end if;

  select * into v_quote from public.quotes q where q.id = new.aggregate_id;
  if not found then
    return new;
  end if;

  select a.name into v_cuenta from public.business_accounts a where a.id = v_quote.business_account_id;

  v_params := jsonb_strip_nulls(jsonb_build_object(
    'quote_number', v_quote.quote_number,
    'account_name', v_cuenta,
    'improve',      coalesce(v_quote.notes, '') ilike 'Mejora esta cotización%'));
  v_link := '/app/quotes?q=' || v_quote.quote_number;

  for v_user in
    select s.user_id
      from ebim.notification_staff(v_quote.organization_id, v_quote.company_id,
                                   array['owner', 'admin', 'orders']::public.app_role[]) s
    union
    select r.user_id from public.sales_reps r
     where r.id = v_quote.sales_rep_id and r.user_id is not null
  loop
    perform ebim.notify_user(
      v_quote.organization_id, v_quote.company_id, v_quote.store_id, v_user,
      'backoffice', 'quote.requested', v_params, v_link, new.id,
      'quote.requested:' || v_quote.id::text || ':' || v_user::text);
  end loop;

  return new;
end;
$fn$;

revoke execute on function ebim.notify_quote_requested() from public, anon, authenticated;

drop trigger if exists domain_events_quote_requested_notify on public.domain_events;
create trigger domain_events_quote_requested_notify
  after insert on public.domain_events
  for each row
  when (new.event_type = 'quote.requested')
  execute function ebim.notify_quote_requested();
