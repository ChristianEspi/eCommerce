-- =============================================================================
-- «Mis cupones» también para el consumidor (2026-11-18)
--
-- `my_coupons` nació para el portal B2B: une con `business_account_users`, así
-- que a quien compra para sí mismo le devolvía SIEMPRE una lista vacía. La
-- pestaña no existía en su cuenta y, si hubiera existido, mentiría («no tienes
-- cupones») mientras el checkout le aceptaba `MIQ002`.
--
-- Ahora la función responde a los dos:
--
--  · con cuenta de empresa activa → exactamente lo de antes (misma consulta);
--  · sin ella (consumidor) → los cupones cuya campaña le alcanzaría en el
--    checkout: sin audiencia, audiencia `all` o el canal por defecto de la
--    tienda —el mismo con el que se le cotiza—. Nunca los de un segmento,
--    cliente o cuenta, que no son suyos.
--
-- Los usos que le quedan se cuentan por su CORREO de sesión, igual que el motor
-- de promociones decide `agotado_para_ti` para quien no tiene cliente.
--
-- Sigue sin ser un catálogo: un cupón es una llave y solo se enseñan las que
-- abren para esta persona. Firma, permisos y forma de la respuesta, iguales.
-- =============================================================================
create or replace function public.my_coupons(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rows    jsonb;
  v_email   text := lower(coalesce(ebim.email(), ''));
  v_channel uuid;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  -- ---- Comprador de empresa: sin cambios -------------------------------
  if exists (
    select 1
      from public.business_account_users u
      join public.business_accounts a on a.id = u.business_account_id and a.is_active
     where u.user_id = ebim.user_id() and u.status = 'active'
  ) then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.valid_to nulls last, t.code), '[]'::jsonb)
      into v_rows
    from (
      select distinct on (p.id)
             c.code,
             p.name                as promotion_name,
             p.description         as promotion_description,
             p.kind::text          as kind,
             p.value_percent::text as value_percent,
             p.value_amount::text  as value_amount,
             p.min_subtotal::text  as min_subtotal,
             c.valid_to,
             case
               when c.usage_limit_per_customer is null then null
               else greatest(
                 c.usage_limit_per_customer - (
                   select count(*) from public.promotion_redemptions r
                    where r.coupon_id = c.id
                      and (r.business_account_id = a.id
                           or r.customer_id = a.customer_id)
                 ), 0)
             end                   as remaining_uses
        from public.coupons c
        join public.promotions p on p.id = c.promotion_id
        join public.business_account_users u
          on u.user_id = ebim.user_id() and u.status = 'active'
        join public.business_accounts a
          on a.id = u.business_account_id and a.is_active
        left join public.promotion_audiences aud on aud.promotion_id = p.id
       where c.store_id = p_store_id
         and c.is_active
         and p.status = 'active'
         and (c.valid_from is null or c.valid_from <= now())
         and (c.valid_to   is null or c.valid_to   >= now())
         and (p.valid_from is null or p.valid_from <= now())
         and (p.valid_to   is null or p.valid_to   >= now())
         and (c.usage_limit is null or c.usage_count < c.usage_limit)
         and (
           not exists (select 1 from public.promotion_audiences x where x.promotion_id = p.id)
           or aud.audience_kind = 'all'
           or (aud.audience_kind = 'business_account' and aud.business_account_id = a.id)
           or (aud.audience_kind = 'customer' and aud.customer_id = a.customer_id)
         )
       order by p.id, c.valid_to nulls last, c.code
    ) t;
    return v_rows;
  end if;

  -- ---- Consumidor -------------------------------------------------------
  select ch.id into v_channel
    from public.channels ch
   where ch.store_id = p_store_id and ch.is_default and ch.is_active;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.valid_to nulls last, t.code), '[]'::jsonb)
    into v_rows
  from (
    select distinct on (p.id)
           c.code,
           p.name                as promotion_name,
           p.description         as promotion_description,
           p.kind::text          as kind,
           p.value_percent::text as value_percent,
           p.value_amount::text  as value_amount,
           p.min_subtotal::text  as min_subtotal,
           c.valid_to,
           case
             when c.usage_limit_per_customer is null then null
             when v_email = '' then null
             else greatest(
               c.usage_limit_per_customer - (
                 select count(*) from public.promotion_redemptions r
                  where r.coupon_id = c.id
                    and lower(r.customer_email) = v_email
               ), 0)
           end                   as remaining_uses
      from public.coupons c
      join public.promotions p on p.id = c.promotion_id
     where c.store_id = p_store_id
       and c.is_active
       and p.status = 'active'
       and (c.valid_from is null or c.valid_from <= now())
       and (c.valid_to   is null or c.valid_to   >= now())
       and (p.valid_from is null or p.valid_from <= now())
       and (p.valid_to   is null or p.valid_to   >= now())
       and (c.usage_limit is null or c.usage_count < c.usage_limit)
       and (
         not exists (select 1 from public.promotion_audiences x where x.promotion_id = p.id)
         or exists (
           select 1 from public.promotion_audiences x
            where x.promotion_id = p.id
              and (x.audience_kind = 'all'
                   or (x.audience_kind = 'channel' and v_channel is not null and x.channel_id = v_channel))
         )
       )
     order by p.id, c.valid_to nulls last, c.code
  ) t;
  return v_rows;
end;
$fn$;

revoke execute on function public.my_coupons(uuid) from public, anon;
grant  execute on function public.my_coupons(uuid) to authenticated;

comment on function public.my_coupons(uuid) is
  'Cupones que ESTE comprador puede usar: de su cuenta de empresa o, si compra para sí, los abiertos a todos y a su canal. No enumera los cupones de la tienda: un cupón es una llave.';
