-- ===========================================================================
-- Bandeja de aprobaciones del comprador B2B + volver a comprar (cierre, item 2 y 6b)
--
-- Tres redefiniciones ADITIVAS sobre funciones que ya existian. Ninguna firma
-- cambia, ningun GRANT se amplia, ninguna regla de autorizacion se relaja:
--
--  1. `order_approval_decide` pasa a ser IDEMPOTENTE ante la MISMA decision.
--     El doble clic del aprobador, o el reintento del navegador tras un corte
--     de red, llegaban como `APROBACION_NO_APLICA` aunque la firma ya estuviera
--     puesta: la pantalla decia «no se pudo» sobre algo que si se hizo.
--  2. `my_business_order_detail` devuelve el contexto de aprobacion y, por
--     linea, `product_id`/`variant_id`, que es lo que necesita «volver a
--     comprar» para mandar QUE y CUANTO al carrito.
--  3. `my_business_orders` anade la orden de compra y, SOLO a quien puede
--     decidir, el correo de quien compro: el aprobador firma sabiendo quien
--     pide; el resto de la cuenta no necesita la agenda de sus compañeros.
--
-- Cuerpos copiados de su ultima definicion (110400 y 150000) y cambiado solo
-- lo que se anota en cada bloque.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- public.order_approval_decide — idempotente ante la misma decision
--
-- Base: 20260828110400_order_commands.sql. Cambios, y solo estos:
--
--  · Un pedido YA decidido con el MISMO resultado que se pide (aprobar sobre
--    `approved`, rechazar sobre `rejected`) devuelve lo que ya habia: sin
--    `update`, sin reescribir `approval_decided_at/by/email`, sin volver a
--    publicar el hecho y sin tocar la linea de tiempo. Es un reintento, no una
--    segunda firma.
--  · La decision CONTRARIA (aprobar un rechazado o al reves) y el pedido que
--    nunca necesito firma (`not_required`) siguen levantando
--    `APROBACION_NO_APLICA`, igual que antes. Una firma no se da la vuelta por
--    reintento.
--  · El reintento pasa por TODAS las autorizaciones antes de responder. Si no,
--    la rama idempotente seria un oraculo: cualquiera con sesion averiguaria el
--    estado de firma de un pedido ajeno llamando con su uuid.
--  · El retorno gana `already_decided` (booleano). Las claves de siempre no
--    cambian: quien ya leia `approval_status` sigue leyendolo.
-- ---------------------------------------------------------------------------
create or replace function public.order_approval_decide(
  p_order_id uuid,
  p_approve  boolean,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order   public.orders%rowtype;
  v_after   public.orders%rowtype;
  v_role    public.business_role;
  v_reason  text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
  v_to      public.order_approval_status;
  v_replay  boolean;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese identificador'
      using errcode = '22023';
  end if;

  v_to := case when coalesce(p_approve, false) then 'approved' else 'rejected' end;

  -- Reintento = el pedido ya tiene EXACTAMENTE la decision que se pide. El
  -- `for update` de arriba serializa dos clics simultaneos: el segundo espera
  -- al primero, lee la fila ya decidida y entra por aqui.
  v_replay := v_order.approval_status = v_to;

  if v_order.approval_status <> 'pending' and not v_replay then
    raise exception 'APROBACION_NO_APLICA: el pedido % no espera autorizacion', v_order.order_number
      using errcode = '22023';
  end if;

  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el super admin de suite no autoriza compras de un tenant'
      using errcode = '42501';
  end if;

  -- El vinculo con la cuenta lo resuelve el SERVIDOR sobre `ebim.user_id()`;
  -- ningun id de cuenta entra por parametro (regla de P05).
  v_role := case
    when v_order.business_account_id is null then null
    else ebim.business_role_of(v_order.business_account_id)
  end;

  -- `coalesce` sobre el texto y no `v_role in (...)` a secas: sin vinculo con
  -- la cuenta `v_role` es NULL, `NULL in (...)` es NULL y `not NULL` es NULL,
  -- asi que la condicion entera se evaluaria a NULL y el `if` NO saltaria. Es
  -- la forma en que la logica ternaria de SQL convierte un guard en un adorno.
  if not (coalesce(v_role::text, '') in ('admin', 'approver'))
     and not ebim.has_role(
           v_order.organization_id, v_order.company_id,
           array['owner','admin','orders']::public.app_role[])
  then
    raise exception 'SIN_PERMISO: hace falta ser aprobador de la cuenta o personal de pedidos'
      using errcode = '42501';
  end if;

  -- Rechazar sin decir por que deja al comprador sin nada que corregir. Se
  -- exige tambien en el reintento: el contrato de entrada no cambia segun lo
  -- que ya haya en disco.
  if not coalesce(p_approve, false) and v_reason is null then
    raise exception 'MOTIVO_REQUERIDO: rechazar una compra exige un motivo'
      using errcode = '22023';
  end if;

  if v_replay then
    -- Nada se escribe y nada se publica: la firma original, con su autor y su
    -- hora, es la unica que existe.
    return jsonb_build_object(
      'order_id',        v_order.id,
      'order_number',    v_order.order_number,
      'approval_status', v_order.approval_status,
      'status',          v_order.status,
      'decided_at',      v_order.approval_decided_at,
      'already_decided', true);
  end if;

  perform set_config('ebim.order_event_reason', coalesce(v_reason, ''), true);
  perform set_config('ebim.order_event_source',
    case when v_role is null then 'backoffice' else 'storefront' end, true);

  if v_to = 'approved' then
    update public.orders
       set approval_status = 'approved',
           approval_decided_at = now(),
           approval_decided_by = ebim.user_id(),
           approval_decided_email = left(ebim.email(), 320),
           approval_reason = v_reason
     where id = v_order.id;
  else
    -- Rechazo y cancelacion en la MISMA sentencia: el trigger de ejes deja
    -- pasar `cancelled` aunque la aprobacion siga pendiente, y asi no existe el
    -- instante en el que el pedido esta rechazado pero todavia vivo.
    update public.orders
       set approval_status = 'rejected',
           approval_decided_at = now(),
           approval_decided_by = ebim.user_id(),
           approval_decided_email = left(ebim.email(), 320),
           approval_reason = v_reason,
           status = 'cancelled'
     where id = v_order.id;
  end if;

  select * into v_after from public.orders o where o.id = v_order.id;

  perform ebim.publish_event(
    v_after.organization_id, v_after.company_id, v_after.store_id,
    'order.approval_decided', 'order', v_after.id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id',            v_after.id,
      'order_number',        v_after.order_number,
      'approval_status',     v_after.approval_status,
      'business_account_id', v_after.business_account_id,
      'decided_by',          v_after.approval_decided_by,
      'reason',              v_reason,
      'status',              v_after.status,
      'grand_total',         v_after.grand_total::text,
      'currency',            v_after.currency,
      'customer_email',      v_after.customer_email)),
    'order.approval_decided:' || v_after.id::text);

  return jsonb_build_object(
    'order_id',        v_after.id,
    'order_number',    v_after.order_number,
    'approval_status', v_after.approval_status,
    'status',          v_after.status,
    'decided_at',      v_after.approval_decided_at,
    'already_decided', false);
end;
$fn$;

revoke execute on function public.order_approval_decide(uuid, boolean, text)
  from public, anon;
grant execute on function public.order_approval_decide(uuid, boolean, text)
  to authenticated, service_role;

comment on function public.order_approval_decide(uuid, boolean, text) is
  'Decide una compra B2B pendiente. Autoriza al aprobador de la cuenta (vinculo resuelto por el servidor) o al personal de pedidos. Idempotente ante la MISMA decision (already_decided); la contraria y los pedidos not_required levantan APROBACION_NO_APLICA.';

-- ---------------------------------------------------------------------------
-- public.my_business_orders — la cola del aprobador, con lo que firma
--
-- Base: 20260828110400_order_commands.sql. Cambios, y solo estos:
--
--  · `purchase_order_number`: la orden de compra es lo primero que un aprobador
--    cruza contra su presupuesto.
--  · `buyer_email`: SOLO para `admin`/`approver` (los que pueden decidir). Un
--    comprador o un lector de la cuenta ve NULL: no necesita el correo de sus
--    compañeros para seguir sus propios pedidos.
-- ---------------------------------------------------------------------------
create or replace function public.my_business_orders(
  p_only_pending boolean default false,
  p_limit        integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rows jsonb;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.placed_at desc), '[]'::jsonb)
    into v_rows
  from (
    select o.id                 as order_id,
           o.order_number,
           o.status,
           o.payment_status,
           o.fulfillment_status,
           o.approval_status,
           o.currency,
           o.grand_total::text  as grand_total,
           o.placed_at,
           a.name               as account_name,
           u.role::text         as my_role,
           -- Solo quien puede decidir ve el boton; el resto lee la cola.
           (u.role in ('admin', 'approver')) as can_decide,
           o.purchase_order_number,
           case when u.role in ('admin', 'approver') then o.customer_email end as buyer_email
    from public.orders o
    join public.business_accounts a on a.id = o.business_account_id
    join public.business_account_users u
      on u.business_account_id = a.id
     and u.user_id = ebim.user_id()
     and u.status  = 'active'
    where a.is_active
      and (not coalesce(p_only_pending, false) or o.approval_status = 'pending')
    order by o.placed_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) t;

  return v_rows;
end;
$fn$;

revoke execute on function public.my_business_orders(boolean, integer)
  from public, anon;
grant execute on function public.my_business_orders(boolean, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.my_business_order_detail — con contexto de aprobacion y productos
--
-- Base: 20260913150000_purchase_order_number.sql. Cambios, y solo estos:
--
--  · `approval_status`, `approval_decided_at`, `approval_decided_email`,
--    `approval_reason`: el detalle dice si el pedido espera firma y, si ya la
--    tiene, de quien y por que.
--  · `can_decide`: MISMA regla que `my_business_orders` (rol `admin` o
--    `approver` en la cuenta del pedido), resuelta por el servidor con
--    `ebim.business_role_of`. El navegador no la calcula.
--  · Por linea, `product_id` y `variant_id`: sin ellos «volver a comprar» no
--    tiene que mandar al carrito. Son ids del catalogo de la MISMA tienda del
--    pedido y el carrito los vuelve a leer del catalogo publico.
-- ---------------------------------------------------------------------------
create or replace function public.my_business_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
  v_role  public.business_role;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select o.* into v_order
  from public.orders o
  join public.business_accounts a on a.id = o.business_account_id and a.is_active
  join public.business_account_users u
    on u.business_account_id = a.id
   and u.user_id = ebim.user_id()
   and u.status  = 'active'
  where o.id = p_order_id;

  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido tuyo con ese id'
      using errcode = '22023';
  end if;

  -- El mismo vinculo que acaba de encontrar la consulta de arriba, leido por la
  -- funcion que usa `order_approval_decide`: el boton y el candado no pueden
  -- discrepar.
  v_role := ebim.business_role_of(v_order.business_account_id);

  -- `name` y `sku` son la FOTO del producto en el momento del pedido, no una
  -- lectura de `products`: si el comercio renombra el articulo manana, el
  -- pedido tiene que seguir diciendo lo que se compro.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id',    i.product_id,
           'variant_id',    i.variant_id,
           'name',          i.name,
           'sku',           i.sku,
           'variant_label', i.variant_label,
           'quantity',      i.quantity,
           'unit_price',    i.unit_price::text,
           'total',         i.line_total::text
         ) order by i.created_at), '[]'::jsonb)
    into v_items
  from public.order_items i
  where i.order_id = v_order.id;

  return jsonb_build_object(
    'order_id',       v_order.id,
    'order_number',   v_order.order_number,
    'status',         v_order.status,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'placed_at',      v_order.placed_at,
    'currency',       v_order.currency,
    'subtotal',       v_order.subtotal::text,
    'discount_total', v_order.discount_total::text,
    'tax_total',      v_order.tax_total::text,
    'shipping_total', v_order.shipping_total::text,
    'grand_total',    v_order.grand_total::text,
    -- N05: la orden de compra con la que se firmó.
    'purchase_order_number', v_order.purchase_order_number,
    -- Cierre, item 2: el contexto de la firma.
    'approval_status',        v_order.approval_status,
    'approval_decided_at',    v_order.approval_decided_at,
    'approval_decided_email', v_order.approval_decided_email,
    'approval_reason',        v_order.approval_reason,
    'can_decide',             coalesce(v_role::text, '') in ('admin', 'approver'),
    'items',          v_items
  );
end;
$fn$;

revoke execute on function public.my_business_order_detail(uuid) from public, anon;
grant  execute on function public.my_business_order_detail(uuid) to authenticated;
