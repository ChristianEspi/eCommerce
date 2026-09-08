# DEMO_PROGRESS — sprint de demo (miércoles)

Prioridad del paquete: **FLOW > DATA > AI > UI**. Los cuatro cerrados.

| Workstream | Estado | Commit |
|---|---|---|
| FLOW (checkout + OMS) | **DONE** | `59edfea` |
| DATA (dataset y preflight) | **DONE** | `054ecbd` |
| AI (Shopping Assistant) | **DONE** | `9761f4c` |
| UI (pulido del storefront) | **DONE** | `40b6b62` |
| INTEGRACIÓN | **DONE** | — |
| GATES FINALES | **DONE** — todos en verde | — |

Guion de demo, arranque y problemas conocidos: **`DEMO_WEDNESDAY_README.md`**.

---

## Qué se encontró, y qué había que no hacía falta tocar

La regla del encargo era no duplicar lo que ya existe. Buena parte del trabajo
fue **descartar**:

| Se sospechaba que faltaba | Realidad |
|---|---|
| Administración de pedidos | Ya existía: `order_transition`, aprobación, timeline y cuatro estados. **66 tests en verde.** No se tocó |
| Resolver productos por lista de ids | `fetchPublicProductsByIds` ya existía y respeta el orden. Reutilizada por el asistente |
| Superficie pública de medios de pago | La vista `public_payment_methods` ya existía con GRANT a `anon` |
| Búsqueda para la IA | `catalog_search_for_slug` ya existía. No se creó ningún índice vectorial |
| Dataset de demo | Ya era rico: 570 productos pintables, 4 listas con 1682 precios |

**El único hueco real del FLOW era que el storefront no capturaba el medio de
pago.** Cero coincidencias de `payment_method` en `src/features/storefront/`,
con el borde aceptándolo desde P09.

---

## FLOW · decisiones que conviene no deshacer

1. **Los medios se leen con el cliente ANÓNIMO de la vitrina, no con la
   sesión.** La policy de `anon` sobre `payment_methods` es `is_active AND
   tienda activa`; la de `authenticated` es `ebim.can_access(...)`, que es
   pertenencia al **backoffice**. Un comprador B2B con sesión no es miembro del
   backoffice de quien le vende: preguntar con su sesión devolvería **cero
   medios justo después de iniciar sesión**.

2. **Preselección solo con un único medio.** Con dos o más se deja en blanco:
   «pagar con lo que salía puesto» es una reclamación, no una venta.

3. **Sin medios configurados el checkout sigue vendiendo** y ni la clave viaja.

## AI · por qué no puede inventar

El orden es la garantía: **primero se busca, después se explica**. La función
devuelve texto e **identificadores**; los filtra contra la lista de candidatos
antes de responder, así que un uuid inventado se cae en el borde. La vitrina
resuelve cada producto contra el catálogo. Los filtros —tope de precio, con
stock— se derivan con reglas deterministas y no con el modelo: un filtro entra
en la consulta SQL, y los datos no se le piden a algo que puede equivocarse.

Sin clave, con el proveedor caído o con respuesta ilegible: `mode: 'search'` y
los resultados del buscador. La tienda nunca depende de que la IA funcione.

---

## Golden path ejecutado de verdad

No con dobles: contra la función de borde desplegada, creando el pedido real
**`EC-20260908-00015`**. Ocho comprobaciones en verde, incluida la que cierra el
criterio P0 del encargo: **el medio de pago queda trazado** (`payment_intents`
con estado `open` y método `transferencia`). También verificado que reenviar la
misma compra devuelve el mismo pedido con `replay=true`.

La transición administrativa se probó y **fue rechazada como debe**
(`SIN_PERMISO: hace falta rol de pedidos sobre este tenant`): la autorización
funciona, y ejecutarla exige sesión de backoffice. Detalle y evidencia en
`DEMO_WEDNESDAY_README.md`.

Dato para el guion: la máquina de estados admite `pending → paid | cancelled`.
**No existe «confirmado»**; pulsar ese CTA daría un error de transición.

## Lo que quedó sin validar

Sin navegador en este entorno: **móvil y escritorio**, **consola y red**, e **IA
con proveedor** (no hay clave; solo está validado el fallback). No se dan por
buenos.

## Gates finales (salida real)

`typecheck` ✅ · `lint` ✅ · `vitest run` ✅ **154 archivos / 2922 tests** ·
`vitest run supabase/tests` ✅ **68 archivos / 1813 tests** · `secret-scan` ✅ ·
`build` ✅. No hay E2E en el repositorio; no se inventó ninguno.

## Freeze

Golden path validado y gates en verde: **features congeladas**. A partir de
aquí, solo correcciones que afecten a la demo.

## Despliegue

`shopping-assistant` **desplegada** (versión 2) por orden del operador y probada
contra el catálogo real. Se declara con `verify_jwt = true` en `config.toml`, al
revés que `create-order`: la vitrina siempre adjunta la clave publicable, así que
exigir un JWT no le cuesta nada al comprador y sí a quien pase sin ella. Importa
más aquí que en el resto porque **es el único borde del repositorio donde una
petición suelta puede gastar cuota de un proveedor de IA**.

### Un fallo que solo apareció al probarla desplegada

La primera versión devolvía **cero productos siempre**. La causa no era la
búsqueda: era que `interpretar()` extraía el filtro y **no quitaba la frase que
lo había producido**. El índice de texto exige que casen todos los términos, así
que «vitaminas con stock» le pedía al catálogo un producto llamado literalmente
así. Cero resultados, y el fallo invisible: la búsqueda funcionaba
perfectamente sobre una pregunta imposible.

Corregido en dos frentes: cada filtro se lleva su frase al salir, y si la
consulta limpia no devuelve nada se reintenta con la palabra más larga —de
«pastillas para el dolor de cabeza» rescata «pastillas», peor recomendación que
la ideal y muchísimo mejor que un panel vacío—.

Los tests unitarios no lo habrían cogido: prueban el contrato de datos, y esto
era el encaje real con el índice de texto del catálogo.

## Lo que queda en manos del operador

1. Reescritura de SPA en Amplify — recargar con F5 da 404 en QAS.
2. `EBIM_AI_API_KEY` en los secretos de Supabase si se quiere IA real en vez de
   modo búsqueda.
