-- =============================================================================
-- Facturación · ver el PDF del comprobante DENTRO de la web (2026-11-20)
--
-- Nubefact sirve el PDF con `X-Frame-Options: SAMEORIGIN` y sin CORS: no se
-- puede incrustar ni leer desde el navegador. Lo trae la Edge Function
-- `invoice-pdf` con la sesión de quien lo pide, y esta función decide si puede:
--
--   · personal de la sociedad que ya lee comprobantes (owner, admin, orders:
--     la misma regla que `invoices_select_member`);
--   · el comprador del pedido (`order_buyers`) o un miembro ACTIVO de su
--     cuenta B2B — las reglas de `my_order_invoice`.
--
-- Mismo mensaje si no existe o no es suyo. Solo devuelve enlaces del emisor
-- (nubefact.com o un revendedor *.pse.pe) por https: la Edge Function no puede
-- convertirse en un proxy hacia cualquier URL que alguien guarde en la fila.
-- =============================================================================

create or replace function public.invoice_pdf_source(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := ebim.user_id();
  v_inv  public.invoices%rowtype;
  v_ok   boolean;
  v_doc  text;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select * into v_inv from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante' using errcode = '22023';
  end if;

  v_ok :=
    (ebim.can_access(v_inv.organization_id, v_inv.company_id)
       and ebim.has_role(v_inv.organization_id, v_inv.company_id, array['owner','admin','orders']::public.app_role[]))
    or exists (select 1 from public.order_buyers b where b.order_id = v_inv.order_id and b.user_id = v_user)
    or exists (select 1
                 from public.orders o
                 join public.business_accounts a on a.id = o.business_account_id and a.is_active
                 join public.business_account_users u
                   on u.business_account_id = a.id and u.user_id = v_user and u.status = 'active'
                where o.id = v_inv.order_id);
  if not v_ok then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante' using errcode = '22023';
  end if;

  if v_inv.pdf_url is null
     or v_inv.pdf_url !~ '^https://(www\.)?nubefact\.com/[A-Za-z0-9/_.-]+\.pdf$'
        and v_inv.pdf_url !~ '^https://[a-z0-9-]+\.pse\.pe/[A-Za-z0-9/_.-]+\.pdf$' then
    raise exception 'PDF_NO_DISPONIBLE: el comprobante aun no tiene PDF' using errcode = '22023';
  end if;

  v_doc := coalesce(v_inv.document_type, case when v_inv.series like 'F%' then 'invoice' else 'receipt' end);
  return jsonb_build_object(
    'pdf_url',  v_inv.pdf_url,
    'filename', v_inv.series || '-' || coalesce(v_inv.number, 'borrador') || '.pdf',
    'title',    v_inv.series || '-' || coalesce(v_inv.number, ''),
    'document_type', v_doc);
end;
$fn$;

revoke execute on function public.invoice_pdf_source(uuid) from public, anon;
grant  execute on function public.invoice_pdf_source(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- «Mi cuenta»: el comprobante del pedido ahora lleva su id, para abrir su PDF en
-- el visor (invoice-pdf vuelve a comprobar que es suyo). Misma regla de acceso.
-- ---------------------------------------------------------------------------
create or replace function public.my_order_invoice(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_order public.orders%rowtype;
  v_inv   public.invoices%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = p_order_id
     and (
       exists (select 1 from public.order_buyers b where b.order_id = o.id and b.user_id = v_user)
       or exists (select 1
                    from public.business_accounts a
                    join public.business_account_users u
                      on u.business_account_id = a.id and u.user_id = v_user and u.status = 'active'
                   where a.id = o.business_account_id and a.is_active)
     );
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido tuyo con ese id' using errcode = '22023';
  end if;

  select i.* into v_inv
    from public.invoices i
   where i.order_id = v_order.id
     and coalesce(i.document_type, '') <> 'credit_note'
   order by (i.status in ('cancelled', 'rejected')), i.created_at desc
   limit 1;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',            v_inv.id,
    'document_type', coalesce(v_inv.document_type, case when v_inv.series like 'F%' then 'invoice' else 'receipt' end),
    'series',        v_inv.series,
    'number',        v_inv.number,
    'status',        v_inv.status::text,
    'issued_at',     v_inv.issued_at,
    'currency',      v_inv.currency,
    'gross_total',   v_inv.gross_total::text,
    'pdf_url',       case when v_inv.pdf_url ~ '^https://' then v_inv.pdf_url end);
end;
$fn$;

revoke execute on function public.my_order_invoice(uuid) from public, anon;
grant  execute on function public.my_order_invoice(uuid) to authenticated;
