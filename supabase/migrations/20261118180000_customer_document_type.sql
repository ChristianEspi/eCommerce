-- =============================================================================
-- Tipo de documento del cliente (2026-11-18).
--
-- `customers.tax_id` guardaba el número sin decir qué era: un RUC, un DNI, un
-- carné de extranjería o un pasaporte. El formulario ahora pregunta el tipo y
-- valida el número según él; la base lo guarda en `tax_id_type`.
--
-- Quien no lo manda (la importación por Excel, una integración) no se rompe:
-- un disparador lo deduce del número —11 dígitos RUC, 8 DNI, 8–12 letras y
-- dígitos carné, el resto pasaporte— cuando falta o cuando cambia el número y
-- nadie tocó el tipo.
-- =============================================================================

alter table public.customers
  add column if not exists tax_id_type text
    constraint customers_tax_id_type_check
    check (tax_id_type in ('ruc', 'dni', 'ce', 'passport'));

comment on column public.customers.tax_id_type is
  'Tipo del documento de tax_id: ruc, dni, ce (carne de extranjeria) o passport. Se deduce del numero si no se manda.';

create or replace function ebim.customer_doc_type_guess(p_value text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when nullif(btrim(p_value), '') is null then null
    when btrim(p_value) ~ '^\d{11}$' then 'ruc'
    when btrim(p_value) ~ '^\d{8}$' then 'dni'
    when btrim(p_value) ~ '^[A-Za-z0-9]{8,12}$' then 'ce'
    else 'passport'
  end
$fn$;

create or replace function ebim.customer_doc_type_fits(p_type text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case p_type
    when 'ruc'      then btrim(p_value) ~ '^\d{11}$'
    when 'dni'      then btrim(p_value) ~ '^\d{8}$'
    when 'ce'       then btrim(p_value) ~ '^[A-Za-z0-9]{8,12}$'
    when 'passport' then btrim(p_value) ~ '^[A-Za-z0-9]{6,15}$'
    else false
  end
$fn$;

create or replace function ebim.customers_fill_doc_type()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if nullif(btrim(coalesce(new.tax_id, '')), '') is null then
    new.tax_id_type := null;
  elsif new.tax_id_type is null
     -- Cambió el número (una importación, por ejemplo) y el tipo de antes ya
     -- no encaja con él: se deduce. Si encaja, se respeta el que había.
     or (tg_op = 'UPDATE'
         and new.tax_id is distinct from old.tax_id
         and new.tax_id_type is not distinct from old.tax_id_type
         and not ebim.customer_doc_type_fits(new.tax_id_type, new.tax_id)) then
    new.tax_id_type := ebim.customer_doc_type_guess(new.tax_id);
  end if;
  return new;
end;
$fn$;

revoke execute on function ebim.customer_doc_type_guess(text) from public, anon;
revoke execute on function ebim.customer_doc_type_fits(text, text) from public, anon;
-- El disparador corre con el permiso de quien guarda: las dos auxiliares (puras,
-- sin datos) tienen que poder ejecutarse por él.
grant execute on function ebim.customer_doc_type_guess(text) to authenticated, service_role;
grant execute on function ebim.customer_doc_type_fits(text, text) to authenticated, service_role;
revoke execute on function ebim.customers_fill_doc_type() from public, anon, authenticated;

drop trigger if exists customers_fill_doc_type on public.customers;
create trigger customers_fill_doc_type
  before insert or update of tax_id, tax_id_type on public.customers
  for each row execute function ebim.customers_fill_doc_type();

-- Los que ya están: se deduce de su número.
update public.customers
   set tax_id_type = ebim.customer_doc_type_guess(tax_id)
 where tax_id_type is null and nullif(btrim(coalesce(tax_id, '')), '') is not null;
