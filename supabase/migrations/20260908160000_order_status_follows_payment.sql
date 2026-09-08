-- =============================================================================
-- P19-SaaS · El ciclo comercial deja de ignorar el cobro
--
-- ## Lo que se veia
--
-- Un pedido pagado con tarjeta en la vitrina quedaba asi:
--
--     ESTADO      PAGO       ENTREGA
--     Pendiente   Cobrado    Sin despachar
--
-- y el operador preguntaba, con razon, si estaba cobrado o no. Lo estaba: la
-- columna ESTADO es el ciclo comercial, no el dinero. Pero el ciclo nace en
-- `pending` y **solo se mueve a mano**, asi que se quedaba ahi para siempre.
-- En la tienda de demostracion: siete de treinta pedidos cobrados seguian
-- listados bajo la pestana «Pendiente».
--
-- ## Por que en el trigger y no en el checkout
--
-- Porque el cobro entra por mas de un sitio —la pasarela, el backoffice, un
-- proceso— y todos acaban escribiendo `payment_status` en esta fila.
-- `ebim.sync_order_axes` ya era el sitio donde los ejes se ponen de acuerdo:
-- solo le faltaba el sentido contrario.
--
-- Arreglarlo en el pipeline de checkout habria dejado fuera al cobro registrado
-- desde el backoffice, que es exactamente el caso de una transferencia.
-- =============================================================================

CREATE OR REPLACE FUNCTION ebim.sync_order_axes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    -- Un pedido que nace `paid` (alta desde el backoffice o desde un ERP) tiene
    -- que nacer con el dinero donde toca.
    if new.payment_status = 'pending' then
      new.payment_status := case new.status
        when 'paid'      then 'paid'::public.payment_status
        when 'fulfilled' then 'paid'::public.payment_status
        when 'refunded'  then 'refunded'::public.payment_status
        else new.payment_status
      end;
    end if;
    if new.fulfillment_status = 'unfulfilled' then
      new.fulfillment_status := case new.status
        when 'fulfilled' then 'fulfilled'::public.fulfillment_status
        when 'cancelled' then 'cancelled'::public.fulfillment_status
        else new.fulfillment_status
      end;
    end if;
  elsif new.status is distinct from old.status then
    if new.payment_status is not distinct from old.payment_status then
      new.payment_status := case new.status
        -- `paid` solo adelanta desde donde todavia no hay dinero cobrado.
        when 'paid' then
          case when old.payment_status in ('pending', 'authorized')
               then 'paid'::public.payment_status else old.payment_status end
        when 'fulfilled' then
          case when old.payment_status in ('pending', 'authorized')
               then 'paid'::public.payment_status else old.payment_status end
        when 'refunded' then 'refunded'::public.payment_status
        -- Cancelar un pedido YA cobrado no anula nada: deja el dinero donde
        -- esta y espera una devolucion, que es una decision aparte.
        when 'cancelled' then
          case when old.payment_status in ('pending', 'authorized')
               then 'voided'::public.payment_status else old.payment_status end
        else old.payment_status
      end;
    end if;

    if new.fulfillment_status is not distinct from old.fulfillment_status then
      new.fulfillment_status := case new.status
        when 'fulfilled' then 'fulfilled'::public.fulfillment_status
        when 'cancelled' then
          case when old.fulfillment_status = 'unfulfilled'
               then 'cancelled'::public.fulfillment_status else old.fulfillment_status end
        when 'refunded' then
          case when old.fulfillment_status in ('fulfilled', 'partially_fulfilled')
               then 'returned'::public.fulfillment_status else old.fulfillment_status end
        else old.fulfillment_status
      end;
    end if;
  elsif new.payment_status is distinct from old.payment_status then
    -- ---- El ciclo comercial sigue al dinero -------------------------------
    --
    -- Hasta aqui la propagacion era de UN solo sentido: `status` empujaba a los
    -- otros dos ejes y nadie empujaba a `status`. Como el ciclo comercial solo
    -- se mueve a mano y nadie lo mueve, un pedido cobrado con tarjeta se
    -- quedaba en «pendiente» para siempre: siete de treinta en la tienda de
    -- demostracion, cobrados, listados bajo la pestana de lo que falta por
    -- cobrar.
    --
    -- Esto NO junta los ejes: `payment_status` sigue siendo quien manda sobre el
    -- dinero y `fulfillment_status` sobre la mercancia. Lo que se cierra es un
    -- retraso que ningun humano cierra, y solo en el unico caso donde el ciclo
    -- es demostrablemente viejo: hay dinero cobrado y el ciclo sigue sin
    -- empezar.
    --
    -- Tres condiciones, y las tres importan:
    --
    --  · `= 'paid'` y no cualquier avance. `authorized` es dinero retenido y sin
    --    cobrar; llamar «pagado» a un pedido por eso adelanta un hecho que
    --    todavia puede no ocurrir.
    --  · `status = 'pending'` y nada mas. Solo se cubre el tramo que falta; un
    --    pedido ya `fulfilled` o `cancelled` no retrocede ni se toca.
    --  · `approval_status <> 'pending'`. Es lo que evita romper el cobro de una
    --    compra B2B que espera firma: `ebim.assert_order_axes` rechaza mover el
    --    ciclo de un pedido pendiente de aprobacion, y como `payment_sync_order`
    --    se traga la excepcion y devuelve `false`, el pago se habria perdido en
    --    silencio. Hoy esa combinacion no puede darse —la misma funcion tambien
    --    frena el pago— pero depender de eso seria atarse a que la otra regla no
    --    cambie nunca.
    --
    -- La transicion `pending -> paid` es legal en la maquina comercial, asi que
    -- `ebim.assert_order_transition` no la rechazaria; no llega a mirarla porque
    -- solo se dispara cuando la sentencia nombra `status`, y quien cobra escribe
    -- `payment_status` a secas. Por la misma razon el cambio no aparece en
    -- `order_status_events` (el registro antiguo, solo de estado) y si en
    -- `order_events`, que es la linea de tiempo que se ve en pantalla y la que
    -- responde «que le paso a este pedido».
    if new.payment_status = 'paid'
       and new.status = 'pending'
       and new.approval_status <> 'pending'
    then
      new.status := 'paid'::public.order_status;
    end if;
  end if;

  -- Las marcas de tiempo. Se estampan la PRIMERA vez que el hecho ocurre y no
  -- se reescriben: `paid_at` es cuando se cobro, no cuando se toco la fila.
  if new.payment_status in ('paid', 'partially_refunded', 'refunded') and new.paid_at is null then
    new.paid_at := now();
  end if;
  if new.fulfillment_status in ('fulfilled', 'partially_fulfilled') and new.fulfilled_at is null then
    new.fulfilled_at := now();
  end if;
  if (new.status = 'cancelled' or new.fulfillment_status = 'cancelled')
     and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;

  return new;
end;
$function$
;
