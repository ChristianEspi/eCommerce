# Línea base de seguridad — eCommerce by EBIM

Estado a **2026-08-30** (P16-SaaS). Alcance: **este repositorio**. Lo que depende de
infraestructura, del hub EBIM o de una decisión humana está en §9 con responsable y dependencia,
y **no** se cuenta como cubierto.

## Cómo leer este documento

| Estado | Qué significa exactamente |
|---|---|
| **PASS** | El control existe **y** hay una prueba automática que falla si desaparece. La evidencia es un archivo y un test, no una afirmación. |
| **PARTIAL** | El control existe pero deja un hueco conocido. El hueco está escrito, y la condición de salida también. |
| **GAP** | No existe dentro del alcance del repositorio. Si es de infraestructura, tiene ficha en §9. |

**Nada aquí se declara PASS por lectura de código.** Cuando la única evidencia posible es un
despliegue —cabeceras servidas por el hosting, copias de seguridad, WAF— el estado es GAP o PARTIAL
y el procedimiento de verificación está escrito en §9 para que alguien lo ejecute y firme.

Comandos que producen la evidencia de este documento:

```
npm run test:db            # 1631 pruebas contra Postgres real (PGlite), 51 archivos
npm run test               # 2490 pruebas en total (aplicación + base)
npm run scan:secrets       # gate de secretos y `service_role` (repo + bundle)
npm run build              # genera dist/_headers y la CSP con el hash del script en línea
npm audit                  # cadena de suministro
```

---

## 0 · Resumen

| Área | Estado | Lo que falta, en una línea |
|---|---|---|
| 1 · Multi-tenant | **PASS** | — |
| 2 · Autenticación e IAM | **PARTIAL** | MFA y SSO dependen del hub; `ecommerce` no está dado de alta (§9.1) |
| 3 · Web y aplicación | **PARTIAL** | `style-src` necesita `'unsafe-inline'` por Emotion (§3.1); WAF y bot management son de hosting (§9.3) |
| 4 · Secretos | **PASS** | — |
| 5 · Datos y privacidad | **PARTIAL** | Seis purgas automatizadas, pero `audit_log` y `analytics_events` no tienen; el planificador es de despliegue (§9.4) |
| 6 · Copias y recuperación | **GAP** | Es del proveedor: procedimiento verificable en §9.5 |
| 7 · Cadena de suministro | **PARTIAL** | Dos avisos moderados de `react-router` v6; el arreglo es un salto mayor (§7.2) |
| 8 · Pagos y PCI | **PASS** | — |

**Vulnerabilidades críticas conocidas dentro del alcance del repositorio: ninguna.** La que había
—§3.2, redirector abierto almacenado— se corrigió en esta fase y tiene regresión en tres capas.

**Segundo hallazgo, del intento 2 de la fase (§3.7):** `cart_open` escribía una fila de `carts` por
**visita anónima** —el proveedor del carrito envuelve la vitrina entera— y nada la recogía nunca.
No es escalada ni fuga: es abuso y coste, de la misma clase que el techo de analítica de §3.6, y
además contradecía una invariante que el proyecto ya tenía escrita en dos sitios. Corregido en
cliente y base, con 19 pruebas nuevas. Lo que deja escrito es un método: **la lista de superficies
anónimas se auditó por lo que las funciones hacen, no por la etiqueta que se les había puesto** —
`cart_open` estaba clasificada como «protegida por un token de 256 bits» y esa frase solo describía
la mitad amable de su contrato.

---

## 1 · Multi-tenant — PASS

### 1.1 RLS activada, forzada y sin puerta de entrada — PASS

Toda tabla de `public` tiene `ENABLE` **y** `FORCE ROW LEVEL SECURITY`, al menos una policy, y
ninguna policy es permisiva para `PUBLIC`. No se comprueba leyendo el SQL: se consulta `pg_class` y
`pg_policy` sobre la base con las migraciones aplicadas.

- Evidencia: `supabase/tests/schema-invariants.test.ts` → «todas las tablas de public tienen RLS
  activada y forzada», «ninguna tabla queda sin policy», «ninguna policy es permisiva para PUBLIC».
- Además, cada migración que crea una tabla activa RLS **en el mismo archivo**: una tabla nueva no
  puede llegar a producción con la policy en un archivo posterior.

### 1.2 Jerarquía y aislamiento efectivo — PASS

`organization_id` + `company_id` NOT NULL e indexados en toda tabla de negocio; sin variantes de
nombre (`tenant_id`, `org_id`…). Las tres exenciones (`app_capabilities`, `currencies`,
`integration_providers`) son nominales y el test comprueba que de verdad son catálogos globales de
solo lectura.

El aislamiento **efectivo** —no solo declarado— se prueba tenant contra tenant en
`supabase/tests/rls-tenant-isolation.test.ts` y en el bloque de aislamiento de cada dominio
(`analytics`, `payments`, `webhooks`, `returns`, `fulfillment`, `enterprise-api`…).

### 1.3 Claves ajenas tenant-safe — PASS *(corregido en P16)*

De las 218 claves ajenas que apuntan a una tabla con tenant, **nueve** no llevaban ninguna columna
de alcance. Ninguna era explotable hoy —esas nueve tablas hijas no tienen GRANT de escritura para
`anon` ni `authenticated`, y solo las escriben funciones `SECURITY DEFINER`—, pero cerraban el paso
a un fallo futuro **por revisión de código** en vez de **por construcción**.

`20260830100100_tenant_safe_foreign_keys.sql` añade la clave candidata
`(id, organization_id, company_id)` a `api_clients`, `integration_outbox`, `payments` y
`webhook_deliveries`, y sustituye las nueve por su versión compuesta:

| Hija | Padre | Antes | Ahora |
|---|---|---|---|
| `api_access_tokens` · `api_idempotency` · `api_requests` | `api_clients` | `api_client_id` | `+ organization_id, company_id` |
| `carts` | `carts` (fusión) | `merged_into` | `+ organization_id, company_id` |
| `integration_messages` · `webhook_deliveries` | `integration_outbox` | `outbox_id` | `+ organization_id, company_id` |
| `order_tokens` | `orders` | `order_id` | `+ organization_id, company_id` |
| `reconciliation_records` | `payments` | `payment_id` | `+ organization_id, company_id` |
| `webhook_deliveries` | `webhook_deliveries` (reproducción) | `replay_of` | `+ organization_id, company_id` |

`MATCH SIMPLE` —el de por defecto— es justo lo que hace falta en las tres columnas opcionales
(`merged_into`, `replay_of`, `payment_id`): con la referencia a `NULL` la restricción no se evalúa,
que es el caso que debe seguir permitido.

- Evidencia: `supabase/tests/security-baseline.test.ts` → la regla estructural sobre TODAS las FK
  («lleva alcance, o su tabla lo lleva en otra FK»), las nueve por nombre, y la prueba de conducta:
  un `order_tokens` que declara otra organización es rechazado por la base.

### 1.4 El tenant no lo declara el navegador — PASS

- En la base: ninguna función de recurso de la API de socio acepta un parámetro de tenant
  (comprobado leyendo `pg_proc` en `enterprise-api.test.ts`); las funciones públicas derivan la
  tienda del **slug** contra `ebim.active_store_by_slug`, que solo devuelve tiendas activas.
- En el borde: `assertNoTenantInPayload` **rechaza con 400** —no ignora— nueve nombres de campo de
  tenant en el cuerpo (`supabase/functions/_shared/auth.ts`), y `tenantContext` exige que
  `active_company` esté dentro de `companies[]` del JWT.
- En el navegador: no hay ni un `organization_id` en una consulta del frontend; el aislamiento lo
  hace la RLS con los claims.

### 1.5 Policies públicas con mínimo privilegio — PASS

`anon` **no tiene ni un GRANT de escritura**, ni de tabla ni de columna. Lo que lee lo lee por
GRANT **por columna** (la RLS filtra filas, nunca columnas) y a través de vistas `security_invoker`.
La cifra de existencias nunca sale: `anon` lee `products.in_stock` —columna generada— y jamás
`products.stock`.

- Evidencia: `security-baseline.test.ts` → «`anon` no tiene ni un GRANT de escritura»;
  `storefront-public.test.ts` para el modelo de lectura.

### 1.6 La superficie anónima es una lista cerrada — PASS *(nuevo en P16)*

`anon` puede ejecutar exactamente **23** funciones de `public`, cada una clasificada y justificada
en el propio test. Una vigesimocuarta pone la suite roja.

| Clase | Cuántas | Qué las protege |
|---|---|---|
| `publicado` | 12 | solo leen lo que la tienda ya publica (incluidas relaciones de producto y reseñas moderadas); la autoridad es la RLS |
| `secreto` | 8 | exigen un token de 256 bits (pedido, carrito, devolución), un código de 96 (tarjeta regalo) o el secreto de baja de 244 bits de un recordatorio de carrito |
| `techo` | 2 | escriben o revelan, y llevan límite de tasa desde P16 (§3.6) |
| `recogido` | 1 | escribe sin poder llevar techo —sería negar la venta— y por eso lo que escribe se recoge (§3.7) |

> **Corrección de esta fase.** `cart_open` estaba clasificada como `secreto`
> («token de carrito de 256 bits»), y eso solo es cierto cuando el invitado **ya
> tiene** token. Cuando llega sin él —la primera visita— la función no lee:
> **crea** la fila y le entrega el token. Es la única de las dieciocho que
> escribe sin presentar nada, y llamarla protegida por un secreto describía la
> mitad amable de su contrato. La cuarta clase existe para no volver a
> redondear eso, y el test exige que lo clasificado así tenga de verdad quién lo
> recoja.

> **Añadida en el cierre (ítem 8).** `cart_recovery_unsubscribe` — la baja de un clic de
> los recordatorios de carrito abandonado. Exige el secreto que solo viaja en el correo (dos uuid v4,
> guardado como sha256), responde un booleano y solo puede dar de baja al destinatario de ese correo
> en esa tienda. `anon` a propósito: quien pulsa el enlace puede no tener sesión en ese navegador.

> **Añadida en P18.** `current_buyer` — devuelve `ebim.user_id()` y nada más.
> Con la clave anónima responde `null`, así que no enseña un dato de nadie: solo
> le dice a quien pregunta si la base **le** reconoce a él. Es `security invoker`
> a propósito —definer aquí sería una función que responde por otro— y existe
> porque el orquestador del checkout no puede verificar por su cuenta la firma
> del token que le llega: leer el `sub` de un JWT no prueba nada, y una tienda
> que exige cuenta para comprar necesita una respuesta que no se pueda falsificar.

> **Añadidas en el cierre (relaciones y reseñas).** `product_relations_for_slug`
> devuelve los ids de los relacionados publicados y visibles en el canal público
> de la tienda, en el orden que fija el comercio; `product_reviews_for_slug`
> devuelve reseñas ya moderadas y su resumen (cuántas, media como texto, reparto
> por estrellas), de un producto publicado. Ninguna enseña precio, usuario,
> correo ni tenant. Escribir una reseña exige sesión (`submit_product_review`,
> fuera de esta lista) y moderarla, rol de catálogo (`moderate_product_review`).

Además: ninguna función de `ebim` **alcanzable** por `anon` es volátil —es decir, ninguna escribe—.
Las funciones de disparador quedan fuera del recuento y el test **demuestra por qué**: Postgres se
niega a invocarlas fuera de un disparador, así que el `EXECUTE` que arrastran del
`GRANT ... TO PUBLIC` por defecto no es superficie alcanzable.

---

## 2 · Autenticación e IAM — PARTIAL

### 2.1 Sesión — PASS *(con la limitación de §2.5)*

Supabase Auth con `persistSession` + `autoRefreshToken` y `storageKey` propio
(`src/shared/lib/supabase.ts`). El token viaja en `Authorization: Bearer`, **nunca en una cookie**:
no hay un solo `document.cookie` ni un `credentials: 'include'` en el repositorio.

El storefront usa un **cliente distinto** con `persistSession: false`: la vitrina es anónima aunque
el visitante tenga sesión de backoffice abierta. No es cosmético — las policies públicas son
`to anon`, y sin esa separación un usuario del tenant vería cero productos, o peor, habría que dar
esas policies a `authenticated` y entonces el tenant A leería columnas internas del catálogo de B.

### 2.2 CSRF — PASS *(no aplica, y por qué)*

CSRF explota que el navegador adjunta la credencial **sola**. Aquí la credencial es una cabecera
`Authorization` que el código pone a mano: una petición entre sitios no la lleva. No hay cookies de
sesión, así que no hay nada que proteger con un token anti-CSRF.

La condición de salida está escrita: **el día que exista una cookie de sesión**, este apartado pasa
a GAP y hacen falta `SameSite=Lax|Strict`, `Secure`, `HttpOnly` y un token por formulario. Lo que
protege de que eso pase por accidente son las cabeceras del borde (`§3.3`) y la ausencia de
`Set-Cookie` en todo el árbol.

### 2.3 RBAC en el servidor — PASS

El rol se comprueba en la **base**, que es la autoridad: `ebim.has_role(org, company, roles[])`
dentro de cada policy de escritura y dentro de cada comando `SECURITY DEFINER`.
`supabase/functions/_shared/roles.ts` es un **espejo** para devolver un 403 con mensaje útil sin ir
a la base, y un test compara la matriz contra los roles que aparecen en las migraciones. La UI
oculta; la base decide.

Caso que lo demuestra: `orders.export` no es «ver el listado en un archivo», es una extracción
masiva de correos, teléfonos y documentos fiscales — y por eso un `viewer` puede leer un pedido y
no puede exportarlos.

### 2.4 Rutas privilegiadas separadas y acceso de soporte auditado — PASS

- `storefront` y `admin` son áreas distintas con rutas, layouts y guards propios (CLAUDE.md §
  «Storefront público vs backoffice»).
- Super admin **único** de suite (`dcalagua@ebim.pe`) y `assertNotSuiteOperator`: una cuenta
  `@ebim.pe` **no puede operar datos de negocio de un tenant** aunque venga forzada en el cuerpo.
- `bootstrap-tenant` exige `x-ebim-provisioning-key` de ≥32 caracteres en **cabecera** —nunca en la
  URL, que acaba en logs y en `Referer`— comparada en **tiempo constante**.
- Toda operación privilegiada deja rastro en `audit_log`, que es **append-only para todos, incluido
  `service_role`**: el UPDATE y el DELETE los rechaza un trigger y `service_role` ni siquiera tiene
  el GRANT. Evidencia: `supabase/tests/audit-log.test.ts` (26 pruebas).

### 2.5 MFA y SSO — PARTIAL → dependencia externa (§9.1)

Ni MFA ni SSO están activos. **No es una omisión de código**: la identidad de la suite la emite el
hub EBIM (contrato §2) y `ecommerce` todavía no está dado de alta en él, así que la identidad
efectiva de DEV/QAS es Supabase Auth con el hook `ebim.demo_access_token_hook`. La app ya está
escrita para el modo definitivo —`decodeClaims`/`tenantContext` leen exactamente los claims del
contrato (`sub`, `email`, `org_id`, `companies[]`, `active_company`, `apps[]`)— y
`platform-context` existe y está probado contra un hub simulado.

Cambiar el mecanismo de identidad es **breaking** por contrato: propuesta al buzón antes de
codificar. Ficha en §9.1.

---

## 3 · Web y aplicación — PARTIAL

### 3.1 CSP y cabeceras — PASS en el artefacto, PARTIAL en `style-src`

`npm run build` genera **dos** cosas a la vez, desde el mismo módulo puro
(`src/shared/security/headers.ts`, plugin `ebim-security-headers` en `vite.config.ts`):

1. `dist/_headers` — el formato que leen igual Netlify y Cloudflare Pages, con las ocho cabeceras.
2. Un `<meta http-equiv="Content-Security-Policy">` **dentro del `index.html`**, colocado justo
   detrás de `<meta charset>` y delante del primer script.

Las dos, y no una: la cabecera es la buena —es la única que aplica `frame-ancestors` y la única que
cubre respuestas que no son el documento—, pero un `_headers` **depende del hosting**. Con la
etiqueta dentro del artefacto, la protección de `script-src` viaja con él aunque mañana el
despliegue se mueva a un bucket que no lea `_headers`.

La política se **genera** porque depende de dos cosas que cambian por despliegue: el origen del
proyecto Supabase (sin él en `connect-src` la aplicación se queda sin backend) y el `sha256` del
script anti-flash del `index.html` (si cambia esa función y el resumen se queda viejo, el usuario ve
el tema equivocado en cada carga). Escrita a mano, sería la de otro despliegue.

```
default-src 'none'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: <supabase>;
connect-src 'self' <supabase> wss://<supabase>; manifest-src 'self'; worker-src 'self' blob:;
frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'; upgrade-insecure-requests
```

Decisiones que no son de estilo:

- **`default-src 'none'`, no `'self'`.** Con `'self'`, cualquier tipo de recurso que se olvide de
  declarar queda permitido, y la lista de tipos crece con cada versión del estándar.
- **`base-uri 'self'`** es la que casi nadie pone y la que convierte un XSS de DOM en reescritura de
  **todas** las rutas relativas del documento.
- **`img-src` no abre `https:` entero**: las imágenes viven en el Storage del proyecto con ruta por
  tenant, que es lo que manda el contrato. Si un tenant necesitara un logo externo, ampliarlo es un
  cambio consciente en `headers.ts` y se ve en la revisión.
- **Sin `VITE_SUPABASE_URL` no se emite política.** Publicar una CSP que deja la aplicación sin
  backend es peor que no publicarla; el build lo avisa.

Otras cabeceras: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (**sin `preload`**:
es una decisión de dominio irreversible durante semanas y no la toma un build), `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` (la ruta lleva el slug de
la tienda y, en `/order/`, el token del pedido), `Permissions-Policy` con nueve funciones negadas,
`Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`.

> **PARTIAL — `style-src 'unsafe-inline'`.** Emotion, el motor de estilos de MUI, inyecta reglas en
> `<style>` en tiempo de ejecución. Sin `'unsafe-inline'` la aplicación se queda **sin ni un
> estilo**. Las dos salidas reales son un *nonce* por respuesta (exige un servidor que renderice el
> HTML; esto es una SPA de ficheros estáticos) o cambiar de motor de estilos. Se declara en vez de
> escribir una política que aparente ser más estricta de lo que es. El riesgo que deja abierto es
> **CSS, no ejecución**: `script-src` no lleva `'unsafe-inline'` ni `'unsafe-eval'`, y hay un test
> que comprueba que `style-src` es la única directiva con un `unsafe` dentro.

- Evidencia: `src/shared/security/headers.test.ts` (27 pruebas), incluidas «hay exactamente UN
  script en línea en `index.html`» —el plugin resume lo que encuentre, así que un segundo script
  quedaría autorizado en silencio— y «`frame-ancestors` va en la cabecera y NO en la etiqueta»,
  porque el navegador la ignora en un `<meta>` y publicarla ahí anunciaría una protección que no
  existe.
- **Que el hosting sirva `_headers` no se puede probar aquí**: procedimiento de verificación en §9.2.

### 3.2 XSS y saneamiento — PASS *(vulnerabilidad corregida en P16)*

**Hallazgo, confirmado y corregido: redirector abierto ALMACENADO por barra invertida.**

En el analizador de URL de WHATWG, para los esquemas especiales la **barra invertida es una barra**.
Medido:

```js
new URL('/\evil.com', 'https://tienda.com').href   // → https://evil.com/
```

`ebim.is_safe_href` (P11) aceptaba como «ruta interna» cualquier cadena que empezara por `/` y no
por `//`. `/\evil.com` cumple las dos condiciones y **sale del dominio**. Con eso, cualquiera con
permiso para escribir contenido del CMS —`content_blocks.cta_href` o el `href` de un nodo de texto
enriquecido— dejaba publicado en la vitrina un botón que lleva al comprador a un sitio de terceros
con la marca del comercio todavía en la barra de direcciones. Es phishing con la reputación del
tenant, y no hacía falta React Router para llegar: un `<a href>` normal lo resuelve igual, porque lo
resuelve el navegador.

La misma condición estaba copiada **palabra por palabra en tres sitios** —el CHECK de Postgres,
`src/domain/content.ts` y el borde del storefront— y las tres compartían el fallo. Corregido en las
tres, y las tres de cliente pasan ahora por un único módulo:

| Capa | Qué se hizo |
|---|---|
| Base (autoridad) | `20260830100000_href_safety_hardening.sql`: sin barra invertida, sin caracteres de control, y **remediación de lo ya guardado** — redefinir la función no revalida las filas existentes, así que sin la limpieza una fila envenenada seguiría publicándose y además sería imposible de editar |
| Dominio | `src/domain/href.ts`: `isSafeHref`, `isInternalPath`, `isSafeExternalUrl`, `internalPathOr`. Vive en `domain/` porque «qué es un enlace seguro» es conocimiento de dominio, y porque el test de arquitectura exige que `domain/` sea puro |
| DOM | `ContentBlocks` (el `internal = startsWith('/')` decidía «esto es interno» sobre una cadena que no lo era), `RichText`, `OrderDrawer` (`external_url` de un sistema de terceros) y `LoginPage` (destino de la vuelta tras el login) |

Los caracteres de control entran en el mismo arreglo: se **eliminan** al analizar la URL, así que
`java<TAB>script:alert(1)` es `javascript:alert(1)` para el navegador y no lo era para la lista negra.

- Evidencia: `src/domain/href.test.ts` (42 pruebas, incluidas cuatro que **demuestran el ataque**
  con el propio `URL` del navegador) y `supabase/tests/security-baseline.test.ts` → la función, el
  CHECK de `content_blocks` y el documento enriquecido.

El resto de la superficie de XSS estaba y sigue bien:

- **El contenido enriquecido no es HTML.** Es un array plano de cuatro tipos de nodo con vocabulario
  cerrado de claves: una clave desconocida no se ignora, invalida el nodo. No hay cadena que escapar
  mal porque no hay cadena que interpretar.
- **`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` y `document.write` no aparecen en ningún
  archivo de producción de `src/`** (`src/architecture.test.ts`).
- `accent_color` está acotado por CHECK a `^#[0-9A-Fa-f]{6}$`: no hay inyección de CSS por branding.
- `media_url` de un bloque está acotado a una referencia del bucket del propio tenant
  (`ebim.is_store_asset_ref`).

### 3.3 Cabeceras del borde — PASS *(nuevo en P16)*

Las respuestas de las Edge Functions llevan `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store` y una CSP de
`default-src 'none'; frame-ancestors 'none'; sandbox`.

`nosniff` no es ceremonia: estas funciones devuelven dentro del JSON datos que escribe un tercero
—el nombre de un producto, el error de una pasarela—, así que la adivinación de tipo es el camino de
un XSS reflejado. Y `no-store` porque casi todas esas respuestas son de **un** tenant y **una**
sesión: un intermediario que las guarde puede servírselas a otro.

- Evidencia: `supabase/tests/edge-security-headers.test.ts` (22 pruebas). Dos cosas que no se
  rompen solas gracias a él: que las cabeceras van también en el **preflight** y en la respuesta de
  **error** —la que suele quedarse sin ellas—, y la comprobación estructural de que **ninguna** de
  las once funciones del borde construye sus cabeceras sin pasar por el módulo compartido.
- `storefront-seo` usa la variante `cacheable`: el sitemap trae su propio `Cache-Control` y no puede
  heredar `no-store`.

### 3.4 CORS — PASS

`Access-Control-Allow-Origin: *` solo para el storefront público (lectura y checkout anónimo, sin
`Authorization`). Las funciones de backoffice llevan lista blanca por variable de entorno
(`EBIM_ADMIN_ORIGINS`): un `*` con `Authorization` es una invitación a que cualquier página lea la
sesión del usuario. `Vary: Origin` siempre.

### 3.5 Storage — PASS

Los buckets **no** son públicos (`public = false`). «Lectura pública» significa que `anon` puede
leer *ciertas rutas* por policy: imagen de producto publicado de tienda activa, o branding de tienda
activa. Un bucket público daría lectura a cualquier ruta, incluida la de un borrador o la de otro
tenant. Ruta por tenant (`{org_id}/{company_id}/…`) validada por `ebim.can_write_store_object`.

### 3.6 Límites de tasa y abuso — PARTIAL

Lo que hay dentro del repositorio, y por qué está donde está:

| Superficie | Techo | Qué pasa al pasarse |
|---|---|---|
| `create_order` (checkout anónimo) | 5 / correo / hora · 20 / tienda / hora (P10) | **Rechaza.** Un pedido basura descuenta existencias y consume el contador de número de pedido |
| `track_events_for_slug` (analítica anónima) | 600 llamadas / tienda / hora (P16) | **Descarta**: `recorded: 0`, sin excepción |
| `promotion_quote_for_slug` (cotización con cupón) | 100 **sondeos fallidos** / tienda / hora (P16) | **Degrada**: cotiza igual, sin cupones |
| `cart_open` (carrito de invitado) | **sin techo, a propósito** — retención acotada (§3.7) | Nada: se recoge lo que quedó vacío |
| API de socio (`/v1`) | por credencial, atómico en la base (P14) | Rechaza con `429` |

Las dos nuevas cierran huecos reales: la analítica **escribe** hasta 20 filas por llamada sin sesión
y sin límite de llamadas —amplificación de almacenamiento contra la factura del comercio, y sus
indicadores envenenados—, y la cotización es un **oráculo de cupones**: un código lo teclea una
persona (`^[a-z0-9][a-z0-9_-]{0,40}$`, mínimo 3 caracteres), no tiene entropía, y la respuesta
distingue `no_existe` de `aplicable`, que es justo lo que necesita un bucle.

**La decisión que gobierna el diseño: degradar, no negar.** El contador es por TIENDA porque es la
única dimensión que la base conoce de forma fiable —no hay IP, y el identificador de sesión lo elige
el cliente—. Un contador compartido tiene un coste evidente: quien abusa gasta el presupuesto de los
demás. Por eso ninguna de las dos lanza. Un límite que tumba el checkout de una tienda entera porque
alguien lanzó un bucle es peor que el abuso que evita.

Y el de cupones cuenta **fallos**, no usos: una campaña con diez mil canjes legítimos no gasta ni
una unidad del contador.

Detalle que importa y conviene dejar escrito: la etapa 4 del checkout usa **la misma** función para
previsualizar el descuento, así que un código mal tecleado en el checkout también gasta contador
—es un fallo de verdad—. Lo que **no** ocurre es que el techo deje a nadie sin su descuento:
`create_order` no pasa por esta función, llama a `ebim.apply_promotions` con los códigos y los
cerrojos puestos, y es su resultado el que se cobra. El techo apaga el oráculo, no la venta.

Las otras dieciséis funciones anónimas se dejan **a propósito** sin techo, y esto es una decisión,
no un olvido: `order_by_token` y `returns_by_token` van con 256 bits de entropía y
`gift_card_balance_for_slug` con 96. Adivinarlos no es un ataque, es una imposibilidad aritmética;
ponerles un contador compartido solo crearía una forma nueva de dejar sin servicio a un comprador
legítimo. Trece de esas dieciséis solo leen catálogo ya publicado o exigen un secreto para escribir
(`cart_replace_lines`, `cart_abandon`, `cart_price_drift` van todas por `ebim.cart_authorize`). La
que **no** encajaba en esa frase es `cart_open`, y tiene apartado propio: §3.7.

- Evidencia: `supabase/tests/security-baseline.test.ts` (bloques de techo) y
  `supabase/tests/checkout-rate-limit.test.ts`.
- > **PARTIAL.** Falta lo que no puede vivir en Postgres: límite por IP, WAF, gestión de bots y
  > protección volumétrica. Son de hosting/CDN. Ficha en §9.3.

### 3.7 El carrito de invitado — PASS *(hallazgo corregido en P16, intento 2)*

**Hallazgo, medido: escritura anónima sin recogida, en la ruta más caliente de la vitrina.**

`public.cart_open(slug, null)` está concedida a `anon` y, sin token, **no lee: inserta**. Y
`ebim.expire_due_carts` solo cambia el **estado**. Medido sobre Postgres real antes de arreglarlo:

```
40 llamadas anónimas sin token ......... 40 filas en `carts`
tras caducarlas y volver a llamar ...... 1 active + 40 abandoned   (ninguna se fue)
```

No hacía falta un atacante. `CartProvider` envuelve el **layout entero** de la vitrina, así que
llamaba a `cart_open` al montar **cualquier** página: una fila por visita anónima, y una por cada
paso de un rastreador siguiendo el sitemap que publicó P15. Crecimiento permanente contra la factura
y el índice del comercio.

Y contradecía de frente lo que el propio proyecto tiene escrito en dos sitios —la cabecera de la
migración de P07 y `serverCart.ts`—: «nadie crea una fila por visita; la fila nace al iniciar sesión
o al empezar a comprar». La intención estaba documentada; el código no la cumplía.

**Corregido en las dos capas, y las dos hacen falta:**

| Capa | Qué se hizo |
|---|---|
| Cliente | `CartProvider` solo reconcilia cuando hay algo que reconciliar: **sesión**, **token guardado** o **líneas locales**. Sin ninguna de las tres, la llamada devolvía un carrito vacío que el propio `setCart` ya descartaba — se pagaba una fila permanente por una respuesta que no se usaba. Quien añade su primera línea entra en el tercer caso y la fila nace **entonces** |
| Base (autoridad) | `20260830100300_guest_cart_retention.sql`: `ebim.sweep_empty_guest_carts` recoge, **acotada por llamada**, el carrito de invitado que quedó vacío; `cart_open` la ejecuta después de caducar y antes de crear. Más `public.purge_empty_guest_carts` para el planificador (§9.4) |

El arreglo del cliente no basta y por eso no va solo: `cart_open` es una función **pública**
concedida a `anon`, así que su límite no puede depender de que el único llamador se porte bien.

**Por qué se RECOGE y no se pone techo.** Un techo por tienda —el mecanismo de §3.6— sería aquí la
decisión equivocada, y conviene dejar escrito por qué. Ese contador es por tienda porque la base no
ve la IP, así que quien abusa gasta el presupuesto de todos. En la analítica eso cuesta medición y
por eso allí se degrada; aquí el carrito es **la puerta de cada venta**, y negarlo convertiría un
ataque contra el almacenamiento en un ataque contra las ventas — estrictamente peor. Lo que sí puede
hacer Postgres es que el daño sea **transitorio en vez de permanente**, y que el mismo tráfico que
crea las filas pague por recogerlas. El límite volumétrico real es por IP y vive en el WAF: §9.3.

**Qué NO se recoge nunca**, porque una limpieza mal acotada es pérdida de datos disfrazada de
higiene: un carrito con líneas (es material de recuperación y de analítica del comercio), uno con
dueño, uno activo, uno que llegó a la caja, y el destino de una fusión. Las cinco están compradas
una por una.

- Evidencia: `supabase/tests/guest-cart-retention.test.ts` (16 pruebas, incluida la que **mide el
  hecho** —la llamada sin token crea fila— y la que compra la propiedad que importa: 30 llamadas en
  bucle dejan de acumularse) y `src/features/storefront/checkout-ui.test.tsx` → «cuándo se abre el
  carrito de servidor» (3 pruebas: sin nada que reconciliar **no** se abre; la primera línea sí; con
  token guardado también).

---

## 4 · Secretos — PASS

### 4.1 Nada de `service_role` en el frontend

`assertNoServiceKey` corre **antes** de crear cualquier cliente Supabase y lanza si alguna variable
`import.meta.env` tiene nombre de clave de servidor o valor con pinta de serlo
(`src/shared/lib/env.ts`). El frontend solo usa `VITE_SUPABASE_URL` y la clave publicable.

### 4.2 Ningún secreto versionado

`.env` está en `.gitignore` y **no aparece en el historial de git**. `.env.example` solo trae
plantillas y comentarios.

### 4.3 El gate — `npm run scan:secrets` *(nuevo en P16)*

El encargo pide *ejecutar* la búsqueda. Ejecutarla a mano una vez y escribir «limpio» en un
documento no vale: al día siguiente el documento sigue diciéndolo y el repositorio ya no lo está.
`scripts/secret-scan.mjs` **sale con código 1** y revisa tres cosas:

1. Los archivos **versionados** (`git ls-files`) contra siete patrones de credencial.
2. El **bundle construido** (`dist/`) — la comprobación que de verdad importa y la única que no se
   puede razonar leyendo el código.
3. Que ningún `.env` esté bajo control de versiones.

Dos decisiones que lo hacen usable:

- **En el bundle no se busca la palabra `service_role`.** Buscarla da tres falsos positivos
  garantizados —el guard `assertNoServiceKey` viaja en el bundle porque *es* el guard, y
  `supabase-js` lleva los prefijos dentro para validarlos— y un gate que empieza con tres falsos
  positivos se desactiva en la primera semana. Se busca una credencial con **valor**: `sb_secret_`
  con cuerpo de clave, o un JWT que al **decodificarlo** declare `role: service_role`. Una clave
  legacy *anon* en el bundle es correcta y no puede hacer fallar esto.
- **El hallazgo no imprime el valor.** Un escáner que enseña el secreto en el log de CI acaba de
  publicarlo otra vez.

Las excepciones son **nominales, por ruta y con motivo escrito** (cuatro archivos), nunca por patrón:
«ignora los `.test.ts`» convertiría la lista en una puerta trasera. Un archivo entra en la lista solo
si la coincidencia **es** la defensa contra el hallazgo o su prueba: el guard `assertNoServiceKey`
(`src/shared/lib/env.ts`) y su test, el propio escáner —los patrones *son* el fichero— y
`scripts/secret-scan.test.mjs`, que planta una credencial falsa de cada clase precisamente para ver
saltar el patrón que le toca.

- Evidencia: `scripts/secret-scan.test.mjs` (13 pruebas) que comprueba lo que casi nunca se
  comprueba de un escáner: **que encuentra**. Se planta cada clase de credencial y se ve saltar el
  patrón que le toca. Ese test ya sirvió para algo: destapó que la expresión regular del detector de
  JWT tenía un carácter de retroceso literal en vez de `\b` y por tanto **no encontraba nada**.
- Resultado de hoy: `dist/` 123 archivos, repo 614 archivos, **sin hallazgos**.

### 4.4 `secret_ref` en vez del secreto — PASS

Ni un secreto de integración vive en la base. `tenant_integrations.secret_ref` y
`webhook_endpoints.secret_ref` guardan el **nombre de la variable** (`^[A-Z][A-Z0-9_]{2,80}$`); el
valor lo resuelve el borde desde el vault de la plataforma.

**Cierre · D2 — el nombre se resuelve en el espacio de la sociedad.** `webhook_endpoints.secret_ref`
lo escribe el administrador del tenant; resuelto tal cual, podía nombrar cualquier variable del
despliegue (`SUPABASE_SERVICE_ROLE_KEY`, `EBIM_WORKER_KEY`, el secreto de otra sociedad) y el
trabajador firmaba con ella hacia la URL elegida por ese tenant. Desde este cierre el trabajador
busca `EBIM_WH_<company_id hex en mayúsculas>_<secret_ref>`, con la sociedad tomada de la fila del
outbox (`webhookSecretEnvName` en `supabase/functions/_shared/webhooks/dispatcher.ts`). Operación:
los secretos de webhook se aprovisionan con ese nombre. Evidencia: `api-gateway.test.ts` «el secreto
se busca SOLO en el espacio de la sociedad del mensaje» y «dos sociedades con el mismo secret_ref
resuelven variables distintas». `tenant_integrations.secret_ref` no lo resuelve hoy ningún código
(las pasarelas usan `EBIM_PAYMENT_WEBHOOK_SECRET_<CODE>` por conector): el día que se use, debe pasar
por el mismo encierro.

El secreto de un cliente de la API se guarda en **sha256**, se devuelve **una vez** y su hash no se
puede leer **ni escribir** desde el backoffice: el GRANT es por columna en los dos sentidos. Y
`api_authenticate` recibe el **hash** del token, no el token, para que el secreto de portador no
entre en el registro de sentencias de Postgres.

### 4.5 Redacción de logs — PASS

`ebim.jsonb_is_pii_free` y `ebim.jsonb_is_card_safe` son CHECK en la base —un CHECK no se puede
desplegar a medias—, y `supabase/functions/_shared/observability/redact.ts` es la primera capa para
el destino al que el CHECK no llega: **la salida estándar**, que acaba en el recolector de logs del
proveedor, fuera de esta base y de sus policies. Las dos listas de claves son copia declarada del
SQL y un test falla si se separan.

`looksLikePan` usa forma + longitud + Luhn: sin el tercer filtro, una marca de tiempo en
milisegundos (13 dígitos) se redactaría y alguien acabaría quitando la guarda entera.

---

## 5 · Datos y privacidad — PARTIAL

### 5.1 Clasificación mínima de PII

Inventario leído del catálogo, no de memoria. Cuatro niveles:

| Nivel | Dónde vive | Quién lo alcanza |
|---|---|---|
| **C3 · Identificativo directo del comprador** — `orders.customer_email/name/phone`, `shipping_address`, `billing_address`, `customers.email/phone/tax_id/legal_name`, `customer_contacts`, `customer_addresses.phone`, `return_requests.customer_email`, `refunds.requested_email`, `fulfillments.contact_*`, `promotion_redemptions.customer_email`, `gift_cards.issued_to_email`, `checkout_attempts.customer_email` | Miembro del tenant con rol; el comprador anónimo solo lo suyo y con token de 256 bits |
| **C2 · Identificativo del operador** — `*.actor_email`, `author_email`, `decided_email`, `uploaded_email`, `tenant_members.email`, `tenants.admin_email`, `audit_log.actor_email` | `owner`/`admin` del tenant. En `audit_log`, además, el correo se **redacta** |
| **C1 · Dato de contacto PUBLICADO por el comercio** — `store_settings.support_email/contact_phone/contact_address`, y su reflejo en `public_stores` | Público a propósito: es la ficha de contacto de la tienda |
| **C0 · Sin PII por construcción** — `analytics_events` | La tabla **no tiene columna de correo, nombre ni cliente**; el identificador de visita se guarda **hasheado**, y un CHECK rechaza un correo o un secreto en el payload aunque lo escriba `service_role` |

`checkout_attempts` **no guarda IP** a propósito: el servidor no la recibe de forma fiable y sería un
dato personal más que custodiar sin necesidad. Lo mismo en `public_rate_events` (P16), que además no
guarda el código probado — guardarlo convertiría la defensa contra la enumeración en una lista de
códigos probados.

### 5.2 Retención y borrado — PARTIAL

Automatizado en la base (seis funciones, todas `service_role` y ninguna alcanzable desde el
navegador):

| Función | Retención por defecto |
|---|---|
| `purge_checkout_attempts` | 24 h |
| `purge_public_rate_events` | 24 h |
| `purge_api_requests` | 48 h |
| `purge_api_idempotency` | 48 h |
| `purge_api_tokens` | 7 días |
| `purge_empty_guest_carts` (P16, intento 2) | 24 h — y además hay recogida oportunista sin planificador (§3.7) |

**Lo que no está automatizado, y se dice:** `audit_log` y `analytics_events` son append-only por
diseño y **no tienen purga**. La consecuencia se asumió al escribirlas (P13) y sigue asumida: la
retención de esas dos y el borrado a petición del titular (derecho de supresión) son una decisión de
política de datos con implicación legal, no un `delete` que se escribe en una fase técnica.
Ficha en §9.4 junto con el planificador que ejecute las cinco purgas.

### 5.3 La base no está expuesta — PASS *(dentro del alcance)*

Ningún componente del repositorio abre el puerto de Postgres: el navegador habla con PostgREST y con
Edge Functions, siempre con clave publicable, y la RLS decide. `service_role` solo existe en Edge
Functions. Que el puerto 5432 del proyecto esté además cerrado en el panel del proveedor es
configuración de infraestructura: §9.6.

---

## 6 · Copias de seguridad y recuperación — GAP

No hay nada verificable dentro del repositorio. Las copias son del proveedor gestionado y el
procedimiento de restauración exige ejecutarlo. Ficha completa en §9.5. **No se declara PASS por
suponer que el proveedor las hace.**

Lo que sí aporta el repositorio: `supabase/migrations` es **reproducible** —dos bases vírgenes dan
exactamente el mismo esquema, comparado por huella en `schema-invariants.test.ts`—, así que la parte
«reconstruir el esquema» de un plan de recuperación está probada. Lo que falta es el dato.

---

## 7 · Cadena de suministro — PARTIAL

### 7.1 Situación

`npm audit`: **0 críticas, 0 altas, 2 moderadas**. Ambas del mismo paquete.

### 7.2 Los dos avisos de `react-router@6.30.6` — analizados uno a uno

| Aviso | Aplicabilidad aquí | Acción |
|---|---|---|
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) — inyección de constructor en `deserializeErrors()` durante la hidratación SSR | **No aplica.** Es una SPA con `createBrowserRouter`; no hay `createStaticHandler`, ni `StaticRouterProvider`, ni `renderToString`, ni `@remix-run/server-runtime` en el árbol. El código vulnerable no se ejecuta nunca | Ninguna |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) — redirección abierta por barra invertida en `<Link>` y `useNavigate` | **Sí aplicaba**, y era la mitad de cliente del hallazgo de §3.2 | **Mitigado en el repositorio**, y en la capa correcta: ningún destino llega a `<Link to>` ni a `<Navigate to>` sin pasar por `isInternalPath`, y la base ya no admite guardar la cadena. La mitigación **no depende de la versión de la librería**, porque el fallo tampoco: un `<a href>` normal lo resolvía igual |

**No se ejecuta el salto mayor.** El arreglo del aviso es `react-router-dom@7`, que es un cambio
mayor con rupturas de API; el encargo de esta fase dice explícitamente que no se hagan
actualizaciones mayores automáticas sin revisar las rupturas, y hacerlo aquí metería un refactor del
enrutador entero en una fase de seguridad. Queda como trabajo propio con su ficha en §9.7 — y
con la mitigación ya puesta, deja de ser urgente.

### 7.3 SAST/DAST y CI — GAP declarado

No hay `.github/` en el repositorio: **este proyecto no tiene CI**. Los gates existen y son
ejecutables; lo que falta es quién los ejecuta en cada cambio. La canalización mínima lista para
copiar está en §9.8, con los seis comandos ya escritos y probados.

---

## 8 · Pagos y PCI — PASS

**Alcance PCI minimizado por delegación.** El dominio de cobro no toca datos de tarjeta: el
contrato del proveedor (`src/domain/ports/payment.ts`, `_shared/payments/provider.ts`) mueve
identificadores del proveedor, referencias e importes. Ni PAN, ni CVV, ni token de tarjeta.

No es una convención de revisión: `ebim.jsonb_is_card_safe` es un **CHECK** que rechaza 22 claves
prohibidas y cualquier valor con forma de PAN (forma + longitud + Luhn), y lo hace aunque quien
escriba sea `service_role`.

El resto de la superficie de cobro, ya cubierta desde P09/P14 y con sus tests:

- Firma HMAC-SHA256 sobre el **cuerpo crudo**, antes de parsear —`JSON.parse` + `JSON.stringify`
  reordena claves y la firma legítima no validaría— y comparada en **tiempo constante**: un `===`
  sobre hexadecimal filtra por cuánto tarda en fallar cuántos caracteres acertó quien prueba, y en
  un webhook que mueve dinero eso es un oráculo.
- El webhook **no declara el tenant**: sale de la fila encontrada por la referencia del proveedor.
- «Aviso desconocido» y «firma inválida» dan **exactamente la misma respuesta**: distinguirlas
  enseña a quien prueba a encontrar referencias reales.
- Los webhooks salientes llevan el **instante dentro de la firma**: sin él, una firma válida lo es
  para siempre y una captura vieja se puede reproducir contra el cliente.
- Un destino de webhook solo puede ser `https` y **público**: siete formas de dirección privada
  rechazadas por CHECK (anti-SSRF).
- El cuerpo de la respuesta del destino **no se guarda**: lo escribe un tercero y acabaría trayendo
  datos de terceros dentro.

Evidencia: `payments.test.ts`, `payments-provider.test.ts`, `webhooks.test.ts`,
`integration-monitor.test.ts`.

### 8.1 Permisos del Integration Monitor — PASS *(revisado en P16)*

Repasado en esta fase, sin cambios necesarios:

- `integration_monitor` y `webhook_monitor` son vistas **`security_invoker`**: no amplían ni un
  permiso. Quien no puede leer la cola, no la ve por mirarla desde la vista.
- Los tres comandos —`integration_message_detail`, `integration_retry`,
  `integration_circuit_reset`— exigen `owner`/`admin` **dentro** de la función, sobre el tenant de la
  **fila**, y los dos que actúan exigen además un motivo antes de tocar nada.
- La cola **no tiene GRANT de escritura** para `authenticated`: el monitor mira, no edita.
- El detalle sale con doble redacción, sin la cadena de consulta de la URL, y deja testigo en
  `audit_log`.
- `integration_health` no acepta parámetro de tenant.

---

## 9 · Controles externos — declarados, con responsable y dependencia

Ninguno de estos se puede cerrar dentro del repositorio. Se declaran con **requisito** y
**procedimiento verificable**, no con una simulación que aparente cubrirlos.

### 9.1 · Identidad de suite: SSO y MFA
- **Requisito.** Third-Party Auth contra el JWKS del hub (modo A) o handoff `/sso?token=` (modo B),
  con MFA gestionado por el hub. Claims exactos del contrato §2.
- **Dependencia bloqueante.** `ecommerce` no está dado de alta en la suite (`SAAS_ROADMAP` §5.1).
- **Responsable.** Hub EBIM (owner del contrato) + operador de la plataforma.
- **Verificación.** Iniciar sesión desde el hub, decodificar el JWT recibido y comprobar que trae
  `sub`, `email`, `org_id`, `companies[]`, `active_company`, `apps[]`; que `platform-context` deja de
  responder `HUB_NO_CONFIGURADO`; y que un usuario con MFA obligatorio no obtiene sesión sin el
  segundo factor. Los tests de `platform-context.test.ts` ya cubren el lado de esta app.

### 9.2 · Que el hosting sirva las cabeceras
- **Requisito.** El despliegue publica `dist/_headers` (Netlify/Cloudflare Pages) o traduce esa
  tabla a la configuración equivalente (`add_header` en nginx, `headers` en `vercel.json`,
  `staticwebapp.config.json` en Azure).
- **Responsable.** Operador de despliegue.
- **Verificación.**
  ```
  curl -sI https://<dominio>/ | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy'
  ```
  Las ocho tienen que aparecer, y la CSP tiene que ser **idéntica** a la línea de `dist/_headers` del
  artefacto desplegado. Si el hosting no las sirve, la etiqueta `<meta>` del `index.html` mantiene
  `script-src` pero **no** `frame-ancestors`: el sitio sería enmarcable.

### 9.3 · WAF, límite por IP y gestión de bots
- **Requisito.** Límite por IP delante de `/functions/v1/*` y de la vitrina, reglas de bots y
  protección volumétrica. Postgres no ve la IP: este control **no puede** vivir en la base, y el
  techo por tienda de §3.6 no lo sustituye.
- **Responsable.** Operador de CDN/hosting.
- **Verificación.** Lanzar 200 peticiones en un minuto contra `/functions/v1/checkout` desde una IP
  y comprobar `429` del borde antes de llegar a la función; comprobar que una IP legítima distinta
  no queda afectada.

### 9.4 · Planificador de purgas y política de retención
- **Requisito.** (a) Un planificador (`pg_cron` o un job del despliegue) que ejecute las seis
  `purge_*` a diario. `purge_empty_guest_carts` es la menos urgente de las seis: su superficie ya se
  recoge sola desde `cart_open` (§3.7), que es precisamente lo que la hace no depender de esto.
  (b) Una política escrita de retención y de borrado a petición del titular para `audit_log` y
  `analytics_events`, que hoy no tienen purga por diseño.
- **Responsable.** Operador de la plataforma + responsable de datos (decisión legal, no técnica).
- **Verificación.** Insertar una fila con `created_at` antigua en `checkout_attempts`, esperar a la
  ventana del planificador y comprobar que desapareció. Para (b), el entregable es el documento
  firmado, no código.
- **Nota.** Es el mismo pendiente de despliegue que el planificador de `integration-worker`, abierto
  desde P14.

### 9.5 · Copias de seguridad y restauración
- **Requisito.** PITR habilitado en el proyecto Supabase, retención declarada, y una **prueba de
  restauración** documentada.
- **Responsable.** Operador de la plataforma.
- **Procedimiento verificable** (esto es lo que hay que ejecutar y firmar):
  1. Anotar la retención configurada y el punto de recuperación más antiguo disponible.
  2. Restaurar a un proyecto **nuevo** en un instante `T`.
  3. Sobre el restaurado, ejecutar la huella de esquema de `schema-invariants.test.ts` y comprobar
     que coincide con la de las migraciones.
  4. Comprobar que una fila de `orders` escrita antes de `T` está y una escrita después no.
  5. Comprobar que **la RLS sigue activa y forzada** en el restaurado — una restauración que pierda
     `FORCE ROW LEVEL SECURITY` es una fuga entre tenants disfrazada de recuperación exitosa.
  6. Anotar el RTO y el RPO medidos, no los prometidos.
- **Hasta que los pasos 1-6 estén ejecutados y firmados, esta área es GAP.**

### 9.6 · La base no expuesta a internet
- **Requisito.** Puerto de Postgres cerrado o restringido por lista de direcciones; acceso solo por
  PostgREST/Edge Functions.
- **Responsable.** Operador de la plataforma.
- **Verificación.** `nc -vz db.<ref>.supabase.co 5432` desde fuera de la red permitida: tiene que
  fallar. Repetir para el puerto del *pooler*.

### 9.7 · `react-router` v6 → v7
- **Requisito.** Revisar las rupturas de API de la v7 y actualizar, o fijar la v6 con la mitigación
  de §3.2 documentada como aceptación de riesgo.
- **Responsable.** Equipo de eCommerce, fase propia.
- **Verificación.** `npm audit` sin avisos, y la suite de enrutado en verde. **No urgente**: el único
  aviso aplicable ya está mitigado en la capa correcta, y el otro no aplica a una SPA.

### 9.8 · CI con los gates
- **Requisito.** Una canalización que ejecute, en cada cambio y bloqueando la fusión:
  ```
  npm ci
  npm run typecheck
  npm run lint
  npm run test
  npm run test:db
  npm run build
  npm run bundle:report
  npm run scan:secrets
  npm audit --audit-level=high
  ```
- **Responsable.** Operador del repositorio.
- **Nota de método.** `npm run test` y `npm run test:db` **no se pueden paralelizar en la misma
  máquina**: cada archivo de base aplica las 93 migraciones sobre PGlite y el `hookTimeout` se agota,
  marcando los casos como saltados y no como fallados. Ejecutarlos en pasos separados.
- **SAST/DAST.** Con la canalización montada, `npm audit` cubre dependencias y el escáner de
  secretos cubre credenciales. Un SAST de análisis de flujo (CodeQL o equivalente) y un DAST contra
  el entorno de QAS quedan como trabajo del operador: exigen un entorno desplegado, que esta fase no
  tiene.

---

## 10 · Lo que se ejecutó para escribir esto

| Comprobación | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 problemas |
| `npm run test` | PASS |
| `npm run test:db` | PASS |
| `npm run build` | PASS, `dist/_headers` y CSP generados |
| `npm run scan:secrets` | **Sin hallazgos** — 600 archivos versionados, 123 del bundle |
| `npm audit` | 2 moderadas (§7.2), 0 altas, 0 críticas |
| Inventario de superficie anónima (`pg_proc`) | 18 funciones, todas clasificadas — una **reclasificada** en el intento 2 (§3.7) |
| Inventario de claves ajenas (`pg_constraint`) | 218 hacia tablas con tenant; 0 sin ancla |
| Inventario de PII (`information_schema`) | 40 tablas y vistas, clasificadas en §5.1 |

---

## 11 · Veredicto

**PASS dentro del alcance del repositorio.** No quedan vulnerabilidades críticas conocidas. Las dos
debilidades reales que encontró la fase están corregidas con regresión automática: el redirector
abierto almacenado de §3.2 (tres capas) y la escritura anónima sin recogida de §3.7 (cliente y
base). Los controles que no se pueden cerrar aquí están en §9 con
responsable, dependencia y un procedimiento que alguien puede ejecutar y firmar; **ninguno se ha
simulado ni se ha dado por bueno**.

Lo que impide llamar a este sistema «listo para enterprise» sin matices no es código de este
repositorio: es §9.1 (identidad de suite), §9.5 (restauración probada) y §9.8 (CI que ejecute los
gates). Los tres tienen dueño fuera del equipo de eCommerce.
