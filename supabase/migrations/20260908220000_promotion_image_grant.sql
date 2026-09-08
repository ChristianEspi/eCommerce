-- =============================================================================
-- La foto de la campana se podia poner y no se podia cambiar.
--
-- `20260902230000_promotion_image.sql` anadio `promotions.image_url` y dejo el
-- GRANT por columna como estaba. El de `20260828130000` enumera una por una las
-- columnas actualizables por `authenticated` —es la mitad que la RLS no cubre,
-- porque una policy filtra filas y nunca columnas— y `image_url` nunca entro en
-- esa lista.
--
-- Consecuencia: cualquier UPDATE sobre una campana existente fallaba con 42501,
-- porque el formulario manda la fila entera. No fallaba al crear (el INSERT
-- tiene grant de tabla) ni al cambiar el estado (esa ruta manda solo `status`),
-- asi que el sintoma era exactamente «edito una campana, pulso Guardar y me dice
-- que mi rol no puede hacer ese cambio» — con un rol de administrador.
--
-- Anadir una columna a una tabla con grant por columna es anadirla tambien al
-- grant. No hay forma de que el linter lo recuerde: queda escrito aqui.
--
-- `kind` NO se anade, y tampoco es un olvido: el tipo de una campana es
-- inmutable despues de crearla —la pantalla ya lo bloquea— porque sus alcances
-- y sus escalas cuelgan de el con una clave ajena compuesta. Lo que se corrige
-- en el cliente es que dejara de mandarlo.
-- =============================================================================

grant update (image_url) on public.promotions to authenticated;

comment on column public.promotions.image_url is
  'Foto de la campana: ruta del bucket de la propia tienda o URL https externa. Misma regla que el logo (ebim.is_store_asset_ref). Actualizable por authenticated desde 20260908220000.';
