-- =============================================================================
-- El simulador puede por fin comprobar un cupón con tope por cliente.
--
-- ## El fallo, en una frase
--
-- `promotion_simulate` recibía `p_customer_id` y se lo pasaba al motor, pero el
-- correo iba SIEMPRE en `null`. Y el motor, para un cupón con
-- `usage_limit_per_customer`, exige saber quién es el cliente:
--
--     if v_coupon.usage_limit_per_customer is not null then
--       if v_email = '' then
--         v_reason := 'sin_identidad';
--
-- Resultado: un cupón de bienvenida —«uno por persona», que es el caso normal—
-- respondía `sin_identidad` en el simulador SIEMPRE. No solo desde la pantalla:
-- también llamando a la función a mano con un cliente válido. La única forma de
-- comprobar si ese cupón funcionaba era hacer un pedido de verdad, que es justo
-- lo que un simulador existe para evitar.
--
-- Se vio probando `MIQ006` (Bienvenida 10%, tope 1 por cliente) contra el
-- proyecto de demostración.
--
-- ## La corrección
--
-- Si se simula a nombre de un cliente, se busca SU correo y se le pasa al motor.
-- Nada más. El resto de la función queda intacto, línea por línea.
--
-- ## Por qué el correo y no solo el identificador
--
-- Porque el motor cuenta los canjes previos por las dos vías —correo o
-- `customer_id`— y hay un motivo: un cupón se puede haber canjeado como invitado,
-- cuando no existía ficha de cliente y lo único que se guardó fue el correo.
-- Contar solo por identificador dejaría pasar el segundo uso de quien compró la
-- primera vez sin registrarse, que es precisamente lo que un tope por cliente
-- tiene que impedir.
--
-- ## Lo que NO cambia
--
-- Ni la firma, ni los permisos, ni la autorización, ni el bloqueo. Sigue sin
-- bloquear filas: simular no es comprar. Y el cliente sigue siendo OPCIONAL —
-- sin él, un cupón con tope por cliente sigue respondiendo `sin_identidad`, que
-- es la respuesta correcta: no se puede cumplir un tope sin saber de quién.
-- =============================================================================

create or replace function public.promotion_simulate(
  p_store_id     uuid,
  p_items        jsonb,
  p_coupon_codes text[]      default null,
  p_channel_id   uuid        default null,
  p_segment_id   uuid        default null,
  p_customer_id  uuid        default null,
  p_at           timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_channel public.channels%rowtype;
  v_at      timestamptz := coalesce(p_at, now());
  v_quote   jsonb;
  v_email   text;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'TIENDA_NO_ENCONTRADA: la tienda no existe' using errcode = '22023';
  end if;

  if not ebim.can_access(v_store.organization_id, v_store.company_id) then
    raise exception 'SIN_PERMISO: la tienda no pertenece a este usuario' using errcode = '42501';
  end if;

  if p_channel_id is null then
    select * into v_channel
    from public.channels c
    where c.store_id = v_store.id and c.is_default and c.is_active;
  else
    select * into v_channel
    from public.channels c
    where c.id = p_channel_id and c.store_id = v_store.id and c.is_active;
  end if;

  if not found then
    raise exception 'CANAL_NO_DISPONIBLE: no hay canal activo para simular' using errcode = '22023';
  end if;

  if p_segment_id is not null and not exists (
    select 1 from public.customer_segments cs
    where cs.id = p_segment_id
      and cs.organization_id = v_store.organization_id
      and cs.company_id      = v_store.company_id
  ) then
    raise exception 'SEGMENTO_NO_ENCONTRADO: ese segmento no es de esta sociedad' using errcode = '22023';
  end if;

  -- El cliente se comprueba y, de paso, se queda con su correo. Antes solo se
  -- comprobaba: la fila se leía entera y se tiraba el dato que hacía falta.
  if p_customer_id is not null then
    select c.email into v_email
    from public.customers c
    where c.id = p_customer_id
      and c.organization_id = v_store.organization_id
      and c.company_id      = v_store.company_id;

    if not found then
      raise exception 'CLIENTE_NO_ENCONTRADO: ese cliente no es de esta sociedad' using errcode = '22023';
    end if;
  end if;

  -- `p_public := false`: simular el efecto de una campana sobre un producto que
  -- todavia no se publico es exactamente para lo que sirve un simulador.
  v_quote := ebim.build_quote(
    v_store.id, v_channel.id, p_items, p_segment_id, p_customer_id, v_at, false);

  return ebim.apply_promotions(
    v_store.id, v_channel.id, v_quote, p_coupon_codes,
    p_customer_id, p_segment_id, null, v_email, v_at, false);
end;
$fn$;

comment on function
  public.promotion_simulate(uuid, jsonb, text[], uuid, uuid, uuid, timestamptz) is
  'Simulador de campanas del backoffice: el MISMO motor que la vitrina y que el pedido. Con cliente, pasa tambien su correo para que un cupon con tope por cliente se pueda comprobar.';
