-- =============================================================================
-- Configuración volvía a decir «tu rol no puede» a un PROPIETARIO.
--
-- ## El fallo
--
-- `store_settings` dejó de tener GRANT de UPDATE a nivel de tabla en la
-- migración de white-label (`20260828140200`): se cambió por una lista explícita
-- de columnas, y con razón —así el estado de verificación del dominio y su token
-- quedaron fuera del alcance del navegador—.
--
-- Lo que pasó después es que se añadieron dos columnas nuevas y **nadie las
-- metió en esa lista**:
--
--  · `checkout_requires_account` (20260901190000) — la tienda exige sesión;
--  · `require_payment_before_dispatch` (20260908180000) — no se entrega sin cobrar.
--
-- Las dos recibieron su GRANT de SELECT y ninguna el de UPDATE. Y como el
-- formulario de Configuración las envía SIEMPRE —son reglas de negocio del
-- comercio, no campos opcionales—, cada intento de guardar chocaba con un
-- `42501` y la pantalla respondía «Tu rol no puede cambiar la configuración de
-- la tienda».
--
-- El mensaje era cierto en lo literal y engañoso en lo que importa: el problema
-- no era el rol —un `owner` chocaba igual— sino un permiso de columna que nunca
-- se concedió. Alguien podía pasarse una tarde revisando roles sin encontrar
-- nada, porque en los roles no había nada que encontrar.
--
-- ## Por qué no se vio antes
--
-- Porque el resto de la pantalla funciona: leer va bien, y las policies de RLS
-- —que es donde todo el mundo mira— están bien escritas. El agujero estaba en
-- el GRANT por columna, que no aparece en ninguna policy y que las pruebas de
-- aislamiento no miran: comprueban que un tenant no toque a otro, no que el
-- propio pueda guardar lo suyo.
--
-- ## La corrección
--
-- Se añaden las dos columnas a la lista de UPDATE. Nada más: ni una policy
-- nueva, ni un permiso de tabla, y el estado del dominio sigue fuera.
-- =============================================================================

grant update (checkout_requires_account, require_payment_before_dispatch)
  on public.store_settings to authenticated;

comment on column public.store_settings.checkout_requires_account is
  'Si esta activo, el checkout exige una sesion verificada. Lo impone el pipeline en validate_account. Editable por owner/admin.';
