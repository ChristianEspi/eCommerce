-- ---------------------------------------------------------------------------
-- 2026-11-21 · La carga de catálogo por API respondía 500.
--
-- `api_requests.route` exigía segmentos sin `:` y la ruta del lote es
-- `/v1/catalog/products:batch` (estilo «método personalizado» de Google AIP-136).
-- El registro de la petición —`api_rate_limit_hit`, lo primero que hace el
-- gateway tras validar el token— chocaba con el CHECK y el socio recibía
-- ERROR_INTERNO sin que la petición quedara siquiera registrada. Las lecturas
-- funcionaban porque ninguna lleva `:`.
--
-- Se admite `:` dentro de un segmento. Un test registra TODAS las rutas de
-- `API_ROUTES` para que una ruta nueva no vuelva a chocar en silencio.
-- ---------------------------------------------------------------------------
alter table public.api_requests drop constraint if exists api_requests_route_fmt;
alter table public.api_requests
  add constraint api_requests_route_fmt check (route ~ '^/v[0-9]{1,3}(/[A-Za-z0-9_{}.:-]+)*$');
