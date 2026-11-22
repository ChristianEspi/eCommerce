-- =============================================================================
-- Asistente de compra conversacional (2026-11-22) · freno por comprador
-- =============================================================================
--
-- `shopping-chat` conversa con un comprador CON SESIÓN y lee sus pedidos y su
-- crédito. La cuota de IA es de la tienda (`ai_consume_for_store`, como el
-- resto de la vitrina); esto es el techo por persona, para que un comprador no
-- agote la de todos: 60 mensajes por hora y tienda.
--
-- Mismo patrón que `ai_intake_check` (20261119120000): exige sesión, resuelve
-- la tienda activa por slug y cuenta en `public_rate_events` con un resumen del
-- usuario (el formato de la superficie no admite el uuid).
--
-- No crea tablas: no hay datos de negocio nuevos.
-- =============================================================================

create or replace function public.ai_chat_check(p_store_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := ebim.user_id();
  v_store   public.stores%rowtype;
  v_surface text;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'SIN_SESION');
  end if;

  select * into v_store from public.stores s
   where lower(s.slug) = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'TIENDA_NO_DISPONIBLE');
  end if;

  v_surface := 'ai.chat.' || left(md5(v_uid::text), 24);
  if ebim.public_rate_exceeded(v_store.id, v_surface, 60) then
    return jsonb_build_object('allowed', false, 'reason', 'RATE_LIMITED');
  end if;
  perform ebim.public_rate_record(v_store.id, v_surface, 1, 60);

  return jsonb_build_object('allowed', true);
end;
$fn$;

revoke execute on function public.ai_chat_check(text) from public, anon;
grant  execute on function public.ai_chat_check(text) to authenticated;

comment on function public.ai_chat_check(text) is
  'Freno por comprador del asistente conversacional (60/h por sesión y tienda). Exige sesión. No consume cuota de IA: eso lo hace ai_consume_for_store.';
