# Revisión de seguridad de IA — eCommerce by EBIM

> Fase 12 de `EBIM_AI_SEQUENCE` (2026-09-22). Auditoría de lo implementado en las fases 00–11 sobre el
> árbol de trabajo de `dev` (cambios aún sin versionar). Arquitectura: [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md).
> Checklist: [`AI_IMPLEMENTATION_STATE.md`](AI_IMPLEMENTATION_STATE.md). Informe de la secuencia:
> [`AI_IMPLEMENTATION_REPORT.md`](AI_IMPLEMENTATION_REPORT.md).

## 1. Alcance y método

Revisados, archivo a archivo:

| Superficie | Qué se leyó |
|---|---|
| SQL | Las 10 migraciones de IA (`20260921120000_ai_core.sql` … `20260922160000_ai_copilot.sql`) y, como contexto, `20260910100000_ai_metering.sql` y `20260910210000_ai_features.sql`. |
| Borde | Las 18 Edge Functions que llaman al proveedor (`catalog-copy`, `shopping-assistant`, `dashboard-insights`, `copilot` y los 14 `*-assistant`), `_runtime/anthropic.ts`, `_runtime/aiMeter.ts`, `_shared/aiPipeline.ts`, `supabase/config.toml`. |
| Lógica pura | Los 22 módulos `_shared/ai*.ts` y `_shared/observability/redact.ts`. |
| Front | `src/features/ai/**`, `src/features/*/ai/**`, el panel del analista, `ProductAiAssistant`, las páginas que los montan y los diccionarios ES/EN. |

Cuatro revisiones independientes (SQL, borde, prompts/salida, front), cada hallazgo comprobado contra el
código antes de corregirlo. Todo lo corregido lleva test.

## 2. Resultado

**Ningún hallazgo crítico ni alto.** Ninguna ruta permite a un tenant leer datos de otro a través de la IA,
ni a un rol obtener por el Copilot lo que su módulo le niega, ni al modelo ejecutar una escritura. Las
correcciones de esta fase cierran el uso abusivo de la cuota, fugas menores de contacto hacia el
proveedor, una mezcla de sociedades dentro del mismo token y huecos de endurecimiento.

### 2.1 Hallazgos corregidos en esta fase

| # | Sev. | Hallazgo | Corrección | Prueba |
|---|---|---|---|---|
| S1 | Media | `ai_consume` (alcanzable desde el navegador con el JWT) aceptaba `p_units` libre: cualquier rol de una funcionalidad vaciaba la cuota de su sociedad en una llamada, sin llamar al modelo. | Por JWT solo `p_units = 1` (`BAD_UNITS` si no); freno de 30 consumos/minuto por persona (`RATE_LIMITED` → `rate_limit`); purga diaria de `ai_tickets` + índice. `ai_core.sql` §5. | `ai-core-db.test.ts` (3 nuevos), `ai-metering.test.ts` |
| S2 | Media | `ai_record` por JWT sumaba hasta 1 000 000 tokens por campo: con un ticket legítimo se inflaban los contadores de cobro de la propia sociedad. | Topes de la ruta JWT: 200 000 entrada, 16 000 salida, 200 000 caché (el servidor mantiene 1 000 000). | `ai-core-db.test.ts` |
| S3 | Media | D9: `shopping-assistant` (anónimo) solo se frenaba con la cuota del tenant; un bucle la vaciaba. | `ai_consume_for_store` consulta y anota `public_rate_*` (superficie `ai.assistant`, 300/h por tienda, configurable en `store_settings.config.rate_limits`, `0` desactiva). Al saltar degrada a búsqueda sin gastar. | `ai-metering.test.ts` (nuevo) |
| S4 | Media | La respuesta pública de la vitrina llegaba al comprador anónimo solo recortada: un nombre de producto con instrucciones podía hacerla emitir enlaces, teléfonos o precios. | `respuestaVitrinaSegura` (`_shared/ai.ts`): sin contacto, sin dinero/porcentajes, ninguna cifra que no esté en nombre/marca/categoría de un candidato ⇒ `bloqueada` y búsqueda. La frase del comprador se sanea (`sanitizeTextForModel`) antes del proveedor. | `ai-security.test.ts` (9 casos) |
| S5 | Media | `ai_reviews_facts` marcaba `contact_like` pero enviaba el cuerpo entero (correo/teléfono/enlace) al proveedor, contra lo que decía su comentario. | Título y cuerpo con el contacto tapado (`[contacto]`) en muestra y detalle. | `ai-promotions-reviews-facts.test.ts` (1 nuevo + aserción) |
| S6 | Baja | `ai_dashboard_facts` filtraba solo por RLS, que deja ver TODAS las sociedades del token; rol y módulos se validaban solo para la activa ⇒ el resumen podía mezclar otra sociedad de la misma organización. | Filtro explícito `organization_id = org_id() AND company_id = active_company()` en las 14 lecturas. | `ai-dashboard-facts.test.ts` (nuevo, con premisa: la RLS sí deja ver el pedido de la otra sociedad) |
| S7 | Media | La frontera `<datos_no_confiables>` se podía partir con caracteres invisibles (ancho cero, guion blando, overrides bidi) o escribir con entidades HTML (`&lt;/…&gt;`). | `neutralizarFrontera` elimina invisibles y neutraliza la forma con entidades. | `ai-security.test.ts` (8 ataques) |
| S8 | Baja | `validarEsquema` usaba `in` (prototipo): `required` podía satisfacerse con claves heredadas; los candados de marcadores (`aiExplain`, `aiInsights`, `aiCustomers`) aceptaban `{{constructor}}` y el front lo resolvía a una función. | `Object.hasOwn` en validador, candados y renderizadores del front (`aiAnalyst.ts`, `promotionsAi.ts`). | `ai-security.test.ts` |
| S9 | Baja | `redact`/`redactText` (logs del borde) no tapaban `authorization`, `cookie`, `x-api-key`, `jwt` como clave, ni `Bearer …`/JWT/cadenas de conexión dentro del texto. | Claves normalizadas contra la lista de secretos de IA; `redactText` aplica las reglas de secretos. Móvil local con separadores (`987 654 321`) añadido a la redacción para el modelo. | `observability-edge.test.ts` (2 nuevos) |
| S10 | Baja | `catalog-copy` dependía del `verify_jwt` por defecto de la CLI. | Bloque explícito en `config.toml`; el test exige bloque explícito para toda función de IA del backoffice. | `ai-security.test.ts` |
| S11 | Baja | El gate de secretos solo miraba archivos versionados: toda la IA (sin versionar) quedaba fuera; sin patrón para la clave del proveedor. | `secret-scan.mjs` recorre también los archivos nuevos no ignorados; patrón `sk-ant-…` y `AI_API_KEY=` con valor. Encontró un literal con forma de clave viva en un test (partido). | `secret-scan.test.mjs` (3 nuevos) |
| S12 | Baja (UX/seguridad) | Resultados de IA obsoletos al cambiar de tienda/producto: la sugerencia de otro producto podía «Aplicarse» a la ficha abierta. | `ProductAiAssistant key={product.id}`; `InventoryAiSection`/`PlanningAiSection` por tienda; `ExplainPanel` se remonta al cambiar de alcance. | suites de front existentes |
| S13 | Baja | Gating: con error al leer el saldo, roles sin la funcionalidad veían la pestaña y «no contratado». | `useAiFeature` comprueba el rol primero. | suites de front |

### 2.2 Verificado y limpio

- **Tenant:** toda función del backoffice hace `requireTenantContext(request)` + `assertNotSuiteOperator`,
  lee con `userClient` (JWT del usuario, RLS) y mide con `medidorDeUsuario`; ninguna acepta
  `organization_id`/`company_id` en el cuerpo (`rejectUnknownFields` con lista cerrada). La vitrina resuelve
  la sociedad en SQL desde el slug de una tienda activa (`assertNoTenantInPayload`). Probado de forma
  estructural para las 18 funciones (`ai-security.test.ts`) y en Postgres real por dataset (A≠B en los 10
  `*-facts.test.ts`, `ai-copilot-facts.test.ts`, `ai-metering.test.ts`).
- **SQL:** los únicos `SECURITY DEFINER` son los de medición (`ai_consume*`, `ai_record*`, `ai_feedback`,
  `ai_entitlement_for`), todos con `search_path = ''` y autorización dentro; los `*_for*` revocados a
  `public, anon, authenticated`. Todo dataset de hechos es `SECURITY INVOKER` + `STABLE`, sin `EXECUTE`
  para `anon`, con guard de rol/módulo/tienda y topes de filas. Sin SQL dinámico; `ILIKE` con comodines
  escapados. `ai_tickets` con RLS forzada y sin acceso de usuario.
- **Permisos vía Copilot:** cada herramienta hereda roles y módulo de su funcionalidad (paridad TS↔SQL
  probada); la base rechaza a quien no tiene permiso aunque llame la función directamente; herramienta
  denegada ⇒ solo su estado, y el candado de marcadores bloquea citar lo no recibido.
- **Escrituras:** ninguna salida del modelo dispara una escritura. Los borradores se copian o rellenan
  el formulario; guardar/publicar/enviar es un acto humano posterior. `quote_create_from_draft` re-precia
  en el servidor y exige «revisado». La única escritura en un clic es «Aplicar» categoría/atributo del PIM,
  etiquetada como tal (`aiPim.savesNow`).
- **Structured output:** 26 esquemas de salida, todos objetos cerrados (`additionalProperties:false`);
  validación en el transporte + revisión de dominio + zod en el front (`parseAiResult`). Una salida
  inválida da `data:null` + `motivo:'esquema'`, traza registrada, sin revisar ni actuar (probado).
- **Errores:** el transporte reduce el error del SDK a un `AiErrorKind`; el borde devuelve códigos
  genéricos; sin trazas de pila ni mensajes del proveedor al cliente.
- **Logs:** ninguna función ni módulo de IA escribe en consola; el Copilot registra solo
  `{tool, status, ms}`; las trazas en base pasan por `ebim.redact_text(…, 500)`.
- **Secretos:** `EBIM_AI_API_KEY` solo se lee en `_runtime/anthropic.ts` con `Deno.env.get`; nunca se
  registra. `src/` no importa el SDK, el transporte ni la clave; ninguna `VITE_*` lleva nombre de clave de
  IA. `scan:secrets` sobre versionado + nuevos + `dist/` (271 archivos del bundle): sin hallazgos;
  `grep` de `sk-ant|EBIM_AI_API_KEY|api.anthropic.com|anthropic-version` en `dist/`: vacío. Las únicas
  apariciones de `service_role` en `src/` son el guard `assertNoServiceKey`, comentarios y un test que
  comprueba que el diagnóstico no lo muestra.
- **UX:** ES/EN con 4967 claves en cada idioma y sin diferencias; sin literales visibles en los
  componentes de IA; sin colores fijos (tokens del tema, acento del tenant); cajones a pantalla completa
  en móvil; ningún modelo se llama al montar (solo por acción explícita).

## 3. Pruebas obligatorias de la fase

| Prueba | Dónde | Estado |
|---|---|---|
| Tenant A no consulta datos de Tenant B a través de IA | `ai-*-facts.test.ts` (Postgres real, uno por dataset), `ai-copilot-facts.test.ts` (A≠B en productos/ventas/tienda), `ai-metering.test.ts` (la vitrina no descuenta de otra sociedad), **nuevo** `ai-dashboard-facts.test.ts` «dos sociedades en el token» | ✅ |
| Usuario sin permiso no obtiene información vía Copilot | `ai-copilot-facts.test.ts` (sales_rep solo cliente, viewer sin ventas ni productos, módulo no contratado, la base rechaza la llamada directa), `ai-copilot.test.ts` («sales_rep que pregunta por ventas no ejecuta nada») | ✅ |
| Contenido malicioso almacenado no se convierte en instrucciones | `ai-promotions-content-reviews.test.ts`, `ai-ops-integrations.test.ts`, `ai-copilot.test.ts`, **nuevo** `ai-security.test.ts` (cierre de frontera con invisibles/entidades/bidi) | ✅ |
| Respuesta LLM inválida no rompe la UI ni ejecuta acciones | **nuevo** `ai-security.test.ts` (26 esquemas × 6 formas inválidas + clave inventada `execute`; pipeline ⇒ `data:null` sin revisar), `ai-core-front.test.tsx` (zod: forma inválida, sobre ilegible, motivo inventado no lanzan), suites de front por módulo | ✅ |

## 4. Riesgos residuales (aceptados o pendientes)

| # | Sev. | Riesgo | Por qué no se corrige ahora / mitigación |
|---|---|---|---|
| R1 | Media | `ai_consume`/`ai_record` siguen siendo invocables por `authenticated` desde PostgREST: un rol con la funcionalidad puede gastar cuota (≤30/min) sin llamar al modelo y dejar trazas con texto propio (acotadas). Solo afecta a su propia sociedad. | La solución estructural (el borde valida el JWT y llama a `*_for` con `service_role`) cambia el modelo de confianza de las 17 funciones; se deja para cuando se desplieguen. |
| R2 | Baja | Texto libre del backoffice (preguntas, notas de pedidos/visitas, cuerpos de reseñas) viaja al proveedor sin sanear PII (el modelo no la devuelve: candado de contacto en la salida). | Sanear con las reglas de redacción rompería búsquedas legítimas (RUC, SKU). Opción futura: saneado selectivo por campo. |
| R3 | Baja | CORS del backoffice cae a `*` si `EBIM_ADMIN_ORIGINS` no está configurado. | Autenticación por cabecera `Bearer` (sin cookies): sin CSRF. Configurar la variable al desplegar (checklist de despliegue). |
| R4 | Baja | Sin tope de tamaño del cuerpo antes de `request.json()` (compartido por todo el borde). | Límite de la plataforma; campos acotados tras el parseo. Cambiar `serveJson` afecta también a la API de ingesta. |
| R5 | Baja | `orders-assistant` (búsqueda) y `quotes-assistant` (borrador) devuelven 500 si falla la segunda consulta SQL tras gastar la unidad. | Improbable; cambiar la forma de la respuesta rompe el contrato zod del front. |
| R6 | Baja | Un campo que supera `maxLength` descarta una respuesta ya pagada (`esquema`). Timeout reintentado una vez en funciones de 25–30 s (peor caso ≈60 s y doble pago). | Preferido: nunca pintar texto fuera de contrato. Medir con el proveedor real antes de relajar. |
| R7 | Baja | `ai_usage_by_feature()` visible para cualquier miembro (gasto por funcionalidad, no datos de negocio). | Migración ya versionada/aplicada (fase anterior a la secuencia); decidir con producto. |
| R8 | Info | Nada de esto está desplegado: 10 migraciones sin aplicar en QAS y 18 Edge Functions de IA (16 nuevas + `catalog-copy` y `shopping-assistant` modificadas) sin desplegar. Las correcciones SQL de esta fase se hicieron **dentro** de esas migraciones (aún no aplicadas en ningún entorno). | Desplegar juntas, en orden. |
