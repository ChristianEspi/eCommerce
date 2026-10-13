# ADR 002 — Capacidades, entitlements y flags técnicos

- **Estado:** aceptada
- **Fecha:** 2026-08-27
- **Fase:** P02-SaaS (productización)
- **Contexto previo:** [`ADR 001`](001-domain-boundaries.md) §4 y §«alternativas descartadas»,
  [`SAAS_ROADMAP.md`](../SAAS_ROADMAP.md) §2 y **§5.1**, [`SAAS_BASELINE.md`](../SAAS_BASELINE.md) §5.3 (R1)
- **Contrato EBIM:** §0.2 (personalización = configuración), §5 (Platform Context API), §6 (addons),
  §7 (qué vive dónde), §4.3 (marca blanca = addon premium), §13 (doble enforcement)

---

## Contexto

El pliego pide vender el mismo producto con planes y módulos distintos, y el contrato EBIM pone dos
condiciones que no se negocian:

1. **El catálogo de addons y su activación por sociedad viven en el hub** (§5, §6). Ninguna app
   define el suyo. Lo que cada app guarda es una *cache* de esa respuesta (§7).
2. **La personalización es configuración, no código** (§0.2, AA0004 del pliego). Un módulo se
   enciende cambiando datos, no desplegando.

Y hay un tercer hecho, verificado por lectura directa en P00 y recogido en `SAAS_ROADMAP` §5.1:
**`ecommerce` no está dado de alta en la suite.** No aparece en el contrato v1.15, ni en
`PROTOCOLO.md`, ni en `BANDEJA.md`, ni en el crew roster. No existe `platform.apps.ecommerce` ni un
`catalog_items` con códigos `ecommerce_*`. El alta la hace el operador a través de GMAO, que es el
owner del contrato; **este repositorio no puede hacerla** (la carpeta de lineamientos es de solo
lectura).

El roadmap avisaba de que ese bloqueo podía «parar P02 en seco». No lo hizo, pero condiciona la
forma de la solución, y esa condición está documentada abajo en «Lo que queda bloqueado».

Además, P01 dejó una deuda de vocabulario explícita: `Capability` ya estaba tomada por los permisos
de rol (`shared/lib/roles.ts`), y el ADR 001 asignó a P02 la decisión de cómo se llama el tercer eje.

## Decisión

### 1. Tres ejes, tres nombres, tres dueños

Lo que había era una palabra —`Capability`— para dos preguntas distintas, y una tercera pregunta que
no se hacía en ninguna parte. Ahora:

| Eje | Pregunta | Quién decide | Dónde vive | Nombre |
|---|---|---|---|---|
| **Permiso** | ¿este ROL puede hacerlo? | esta app | `shared/lib/roles.ts`, `ebim.has_role` | `Permission` |
| **Entitlement** | ¿la cuenta CONTRATÓ el módulo? | el **hub** | cache en `tenant_entitlements` | `EntitlementCode` |
| **Flag técnico** | ¿está encendido? | el administrador del tenant | `tenant_feature_flags` | `FeatureFlags` |

`Capability` pasa a ser la **unidad técnica que se gatea** —un módulo del producto— y el de los
roles se renombra a `Permission`, que es lo que siempre fue. El renombrado tocó cinco archivos y sus
tests; ninguno cambió de comportamiento.

Los tres se componen y ninguno sustituye a otro: un `admin` sin el addon no puede, y un tenant con
el addon pero con rol `viewer`, tampoco.

### 2. El registro de capacidades es TÉCNICO y es de esta app; el catálogo comercial es del hub

`src/domain/capabilities.ts` y la tabla `public.app_capabilities` declaran **qué sabe hacer
eCommerce**: dieciséis módulos, cada uno con su frontera de `boundaries.ts`, su estado real
(`implemented` / `partial` / `declared`) y qué deja de poder hacer el tenant si no lo tiene.

Eso **no** es un catálogo comercial y la diferencia es la que separa esta decisión del anti-patrón
que el contrato prohíbe:

| Vive aquí (técnico) | Vive en el hub (comercial) |
|---|---|
| que el producto sepa llevar multi-almacén | cuánto cuesta el multi-almacén |
| qué se apaga si falta el addon | en qué plan viene incluido |
| el código de addon que lo concede | el nombre de venta, la descripción, la vigencia |
| — | qué addons tiene cada sociedad *(se lee y se cachea)* |

Es el mismo patrón que `integration_providers` (P12): que exista un conector de ERP es una capacidad
del **producto**; que una sociedad lo tenga es un dato de **tenant** y vive en otra tabla.

`plan` se guarda y se **enseña** en diagnóstico, pero ninguna función lo lee para decidir. Mapear
plan → módulos aquí sería replicar el catálogo del hub y la copia iría siempre por detrás de la
facturación. Una prueba de arquitectura falla si aparece un `plan === '…'` o una constante `PLANS`.

**Cinco capacidades son baseline** —`catalog`, `storefront`, `checkout`, `orders`,
`analytics.basic`— y no se venden aparte: son lo que el producto hace hoy. **Once son vendibles** y
exigen entitlement. Un CHECK de la base (`app_capabilities_baseline_xor_code`) impide que una fila
sea las dos cosas, porque entonces la resolución sería ambigua.

### 3. La regla de composición, escrita una vez y comprobada tres veces

```
capacidad efectiva = baseline
                  OR ( app_active
                       AND entitlement activo
                       AND flag ≠ false )
```

Tres consecuencias que son decisiones, no detalles:

- **`app_active: false` retira lo comercial, no la operación** (D-14 regla 2, 2026-09-29; ver
  «Enmienda D-14» abajo). Lo vendible se apaga aunque el addon siga contratado; lo baseline
  —catálogo, vitrina, checkout, pedidos, analítica básica— sigue. *Texto original (superado):* «no
  deja ni lo baseline: es un tenant que no es cliente de eCommerce».
- **Un flag JAMÁS concede.** `flags['payments'] = true` sin el addon no enciende nada. Si pudiera,
  la pantalla de ajustes del propio cliente sería un sistema de facturación en la sombra. Es la
  propiedad que hace que los dos conceptos puedan convivir sin que uno se coma al otro.
- **Un flag no apaga lo baseline.** Un interruptor capaz de dejar la tienda sin catálogo desde los
  ajustes del tenant es un botón de caída, no una opción.

La regla existe en tres copias porque tiene tres consumidores con tecnologías distintas
—`resolveCapabilities` en TypeScript, `ebim.company_is_entitled` en SQL y el registro sembrado que
las policies leen—. Lo que impide que se separen no es la disciplina: es
`supabase/tests/capabilities.test.ts`, que corre **siete escenarios** sobre Postgres real y compara
la lista que devuelve la base contra la que devuelve TypeScript, capacidad por capacidad.

### 4. La seguridad está en las policies. El gating de la UI es cortesía

`ebim.has_capability(org, company, capability)` = `can_access` **y** `company_is_entitled`. Se usa
dentro de las policies, así que apagar un módulo significa algo aunque el atacante hable PostgREST
directo desde la consola del navegador con su propio token.

Hoy hay **dos superficies vendibles reales** y las dos están cerradas en la base:

| Superficie | Capacidad | Qué pasa sin ella |
|---|---|---|
| `store_settings.white_label` | `content.white_label` | el `UPDATE` con `white_label = true` viola la policy (42501) |
| `tenant_integrations` (INSERT/UPDATE) | `integrations.enterprise` | habilitar un conector viola la policy |

Se eligieron porque son reales y no inventadas: la marca blanca la declara **addon premium el propio
contrato §4.3**, y habilitar un conector de ERP o de pasarela es literalmente el módulo de
integraciones enterprise. Construir una superficie de mentira para tener algo que gatear habría
producido una prueba que no prueba nada.

Dos matices que se decidieron a propósito:

- **Editar el resto del branding sigue funcionando sin el addon.** El `using` de la policy no pide
  la capacidad; solo el `with check` sobre `white_label = true`. Si la pidiera, un tenant al que se
  le retira el addon no podría ni cambiar el nombre de su tienda.
- **El catálogo de conectores se sigue leyendo sin el addon.** Saber que el conector existe es justo
  lo que hace que alguien lo contrate.

### 5. Retirar un addon apaga el EFECTO, no solo el botón

`public.sync_platform_context` no hace upserts sueltos: **reemplaza el conjunto entero** en una
transacción, así que un addon que el hub deja de devolver se desactiva. Es la mitad que se olvida
cuando se sincroniza fila a fila, y produce el tenant que sigue usando lo que ya no paga.

Y va un paso más allá para la única capacidad con efecto persistido en otra tabla: al retirarse
`content.white_label`, la misma transacción pone `store_settings.white_label = false`. Sin eso, una
cuenta que deja de pagar conserva la vitrina sin la firma de la suite para siempre, porque la policy
solo impide *encenderlo*. En sentido contrario no se toca: recuperar el addon no vuelve a encender
la marca blanca sola, porque encenderla es una decisión del tenant.

Los entitlements retirados se **desactivan, no se borran**: quien da soporte necesita ver que ese
módulo estuvo activo hasta ayer.

### 6. Nadie se concede un módulo a sí mismo

`tenant_entitlements` y `tenant_platform_context` son **de solo lectura** para el backoffice, con
dos capas que no son la misma repetida:

- no hay `GRANT` de INSERT/UPDATE/DELETE para `authenticated`, y
- no hay una sola policy de escritura.

Aunque alguien concediera el GRANT por error, la RLS seguiría denegando. La escritura pasa por
`sync_platform_context`, con `REVOKE EXECUTE` a `public`/`anon`/`authenticated` (lección
esupplier-030) y `GRANT` solo a `service_role`.

Lo único de las cuatro tablas que pertenece al tenant son los **flags**, y ahí sí escribe
`owner`/`admin`. Es coherente: el flag es suyo y solo puede restar.

### 7. El hub se lee desde el borde, y la app lee la cache

```
navegador ──RPC effective_capabilities()──► Postgres (cache, bajo RLS)
                                               ▲
operador ──x-ebim-provisioning-key──┐          │ sync_platform_context (service_role)
usuario  ──JWT { action:'refresh' }─┴─► Edge Function `platform-context` ──GET──► hub (§5)
```

El navegador **nunca** habla con el hub: la credencial servicio-a-servicio vive solo en la Edge
Function. La lectura de cada pantalla va contra la cache local bajo RLS, que es exactamente lo que
el §7 asigna a cada app («Lectura de addons/config (cache del context)») y evita una llamada de red
al hub por cada navegación.

El parser de la respuesta del hub (`_shared/platform-context.ts`) es TypeScript puro, sin `fetch` ni
`Deno`, para que lo compile el `tsc` del repo y lo cubran los tests: es la única forma de comprobar
sin desplegar que una respuesta rara del hub no acaba escribiendo entitlements inventados. Acepta
**la forma del contrato §5 y solo esa**; lo que no encaja falla con `HUB_RESPUESTA_INVALIDA` en vez
de adivinar, porque adivinar mal aquí significa apagarle módulos a un cliente que sí los pagó. Y
rechaza una respuesta cuya `organization.id` no sea la del token: una URL mal configurada o una
caché intermedia darían a un tenant los módulos de otro, y sería muy difícil de ver después.

### 8. Diagnóstico: la pregunta «¿por qué este cliente no ve el módulo?» sin abrir la base

`/app/diagnostics`, solo para `tenant.manage`. Enseña el origen de la configuración, la organización
y sociedad activas, la tienda, el producto y su versión, el host del proyecto, el plan (informativo),
la última sincronización, y la tabla de los dieciséis módulos con tres estados distinguibles:
**activo**, **apagado por interruptor** y **no contratado**.

Tres decisiones de esa pantalla:

- **El origen se dice en voz alta**, con tres valores: `hub`, `provisioning` y `sin-contexto`.
  «Nunca hablamos con el hub» y «el hub dice que no lo tienes» son incidencias distintas, y solo una
  se arregla vendiendo algo. Hoy la respuesta normal es `sin-contexto`.
- **Los códigos de addon que el hub manda y esta versión no conoce se enseñan**, no se descartan.
  Es la señal de que el catálogo va por delante del binario desplegado, y es lo primero que hay que
  mirar cuando un cliente jura haber comprado algo que no aparece.
- **Ni una credencial.** Se pinta el host del proyecto —que ya viaja en cada petición del
  navegador— y nunca la clave, ni siquiera la publicable. Un test comprueba que en el DOM no aparece
  `sb_publishable`, `service_role`, un JWT ni un `Bearer`.

### 9. El gate de la UI tiene cuatro estados, y el tercero es el que importa

`CapabilityGate`: cargando → esqueleto; **error → error de verdad, con reintento**; sin capacidad →
«este módulo no está en tu plan»; con capacidad → el módulo.

El estado de error existe separado porque un 403 de la base al leer capacidades **no** es «no lo
tienes». Degradarlo a «no contratado» es exactamente cómo un problema de autorización del servidor
se vuelve invisible durante semanas: el usuario ve una pantalla plausible y nadie abre una
incidencia. Hay un test que monta un 42501 y exige que salga un `role="alert"` y no el candado.

El estado «no contratado» es `role="status"` y no `role="alert"`: aquí no falló nada. Y es distinto
de `UnauthorizedState`, porque «tu rol no llega» se arregla cambiando un rol y «tu empresa no lo
tiene» no; pintarlos igual manda al administrador a revisar permisos media hora por algo que no es
un permiso.

Las rutas del backoffice ya gatean por su capacidad baseline. Esconder la entrada del menú no basta
—una URL se escribe a mano y se comparte por correo—, así que entrar directo a `/app/products` sin
el módulo enseña el estado explicado en vez de un listado vacío que parecería un fallo.
**Configuración y Diagnóstico no se gatean**: son la salida de un tenant sin nada contratado y el
sitio donde se ve por qué.

### 10. Fallar cerrado para lo vendible, abierto para lo baseline

Una fila ausente en `tenant_platform_context` significa «nunca se sincronizó» y se lee como *app
activa, sin entitlements*: el tenant conserva lo baseline y no obtiene ni un módulo vendible.

Cerrar también lo baseline sería más puro y peor: dejaría sin catálogo a **todos** los tenants ya
dados de alta el día que esta migración se aplique, con un síntoma («la tienda desapareció») mucho
más difícil de diagnosticar que el que evitaría. La asimetría está acotada —no regala ni un módulo
de pago— y es visible: el diagnóstico lo declara como `sin-contexto`.

En el borde el criterio es el **contrario**: si el hub responde y no dice `app_active`, se lee como
`false`. Ahí sí hablamos con el hub, así que un silencio es una respuesta incompleta, no un permiso.

## Alternativas descartadas

**Esperar al alta de `ecommerce` en el hub.** Era la lectura literal de `SAAS_ROADMAP` §5.1 y habría
dejado la fase en FAIL con cero código, bloqueando además a P03–P14, que gatean contra esto. Lo que
el bloqueo impide de verdad es *conocer los códigos de addon definitivos*; no impide construir el
registro técnico, la resolución, el enforcement ni el proxy. La parte que depende del hub es una
columna (`app_capabilities.entitlement_code`) y una constante (`ENTITLEMENT_PREFIX`).

**Una tabla local de planes con sus módulos.** Es el anti-patrón explícito. La copia local iría
siempre por detrás de la facturación, y el día que comercial cambie qué entra en cada plan habría
que desplegar.

**Un solo concepto «feature» para entitlements y flags.** Habría ahorrado una tabla y habría
convertido la pantalla de ajustes del tenant en una caja registradora: si el mismo interruptor que
apaga puede encender, no hay nada que impida usar un módulo sin contratarlo. La asimetría —los flags
solo restan— es lo que permite que convivan.

**Resolver capacidades solo en el cliente.** Rápido y falso: el gating visual no es seguridad, y sin
`ebim.has_capability` en las policies apagar un módulo sería una sugerencia.

**Llamar al hub en cada carga de pantalla.** Habría atado el arranque del backoffice a la latencia y
a la disponibilidad del hub. La cache local bajo RLS es además lo que el contrato §7 asigna a cada
app.

**Gatear una superficie inventada para poder enseñar el enforcement.** Un módulo de mentira habría
dado un test que no prueba nada. Se gateó lo que ya existía y es realmente vendible.

**Renombrar `Capability` de los roles a otra cosa que no fuera `Permission`.** Es lo que son:
`tenant.manage`, `store.manage`, `catalog.write`, `orders.write` son permisos. El nombre estaba
ocupado por accidente, no por diseño.

## Consecuencias

**A favor.** Un módulo se activa y se desactiva por configuración autorizada, sin tocar código y sin
desplegar, y la seguridad no depende de la UI: hay dos superficies reales cerradas en las policies y
tests que lo demuestran denegando. Las fases P03–P14 tienen contra qué gatear su módulo desde el
primer día. Soporte puede responder «por qué no lo ve» sin acceso a la base. El vocabulario de los
tres ejes queda cerrado, que era deuda declarada de P01.

**En contra.** Cuatro tablas y una Edge Function más que mantener. La regla de composición vive en
tres sitios —aunque atada por un test contra Postgres real—. Y el camino de aprovisionamiento por
clave del operador es deuda con fecha de caducidad: existe solo mientras el hub no responda.

**Lo que esto NO resuelve.** El hub sigue sin conocer esta app, así que el camino `hub` está escrito
y probado en su parte pura pero **nunca se ha ejercitado contra un hub real**. Y las once
capacidades vendibles son en su mayoría `declared`: gatean algo que todavía no existe. Eso es
correcto —el gating tiene que existir antes que el módulo, no después— pero significa que la primera
validación de verdad de este diseño llega con P03.

## Lo que queda bloqueado (no resoluble desde este repositorio)

1. **Alta de `ecommerce` en la suite** (`SAAS_ROADMAP` §5.1). La hace el operador vía GMAO.
2. **Catálogo de addons de eCommerce en el hub.** Hasta que exista, los códigos
   `ecommerce.<capacidad>` son los que esta app *espera*, no los que el hub *confirma*. Cuando se
   defina y no coincida, lo que cambia es `app_capabilities.entitlement_code` y `ENTITLEMENT_PREFIX`
   — ni una línea de gating.
3. **URL y credencial del Platform Context API** (`EBIM_HUB_CONTEXT_URL`, `EBIM_HUB_SERVICE_KEY`).
   Sin ellas `platform-context` responde `HUB_NO_CONFIGURADO`, que es el estado esperado hoy.
4. **Retirada del camino de aprovisionamiento** una vez el hub responda: `source: 'provisioning'` no
   debería existir en régimen normal.

Ninguno impide que la fase cumpla su Definition of Done, porque el camino de aprovisionamiento
—autorizado con la misma clave en cabecera que `bootstrap-tenant`, contrato §2.6— permite activar y
desactivar un módulo por configuración desde hoy.

## Verificación

`npm run typecheck`, `npm run lint`, `npm run test` (**702 tests / 49 archivos**), `npm run test:db`
(**360 / 18**) y `npm run build`, todos verdes. Antes de la fase: 611/44 y 308/16.

Los 91 tests nuevos: 17 de dominio (registro y composición), 20 de UI (gate, navegación,
diagnóstico), 16 del parser del hub, 2 de arquitectura (uuid literal y plan comercial en código) y
36 contra Postgres real (aislamiento, denegación en las dos superficies, paridad SQL↔TypeScript en
siete escenarios, sincronización). **Ningún test existente se borró ni se debilitó**; tres se
ajustaron: `schema-invariants` suma `app_capabilities` a la lista
nominal de catálogos globales —que tiene su propia prueba de que la exención es legítima—,
`routes.test` incorpora la ruta de diagnóstico, y `SettingsPage.test` monta el provider nuevo.

Bundle de entrada 764,32 kB (227,62 kB gzip) frente a 744,91 kB (221,15 kB): +19,4 kB, casi todo del
registro de capacidades y de la tabla del diagnóstico, que es una ruta con carga diferida.

## Enmienda D-14 regla 2 (2026-09-29)

Decisión humana D-14 (aprobada para DEV/LOCAL): **`appActive=false` deshabilita las capacidades y
entitlements comerciales del SaaS; no bloquea por sí sola la aplicación operativa.**

- SQL: `20261003100000_app_active_commercial_only.sql` redefine `ebim.company_is_entitled` como
  `baseline OR (app_active AND (entitlement OR fallback legado) AND flag ≠ false)`. `has_capability`,
  `assert_capability`, `effective_capabilities` y las policies la heredan sin cambios.
- TypeScript: `resolveCapabilities` conserva lo baseline con `appActive: false` (la paridad
  SQL↔TypeScript de `supabase/tests/capabilities.test.ts` cubre el escenario «app no contratada»).
- Lo que NO cambia: `ebim.active_price_lists` sigue exigiendo `app_active` (gatea `pricing.lists` y
  `trade.quotes`, que son vendibles); `platform_entitlements.known_codes` excluye lo baseline, así
  que `record_shadow_diffs` no ve diferencias nuevas; los flags siguen sin apagar lo baseline.
- Tests reescritos (no borrados): `src/domain/capabilities.test.ts` («retira lo vendible y conserva
  lo baseline»), `supabase/tests/capabilities.test.ts` (describe `app_active: false retira lo
  comercial…`) y `supabase/tests/platform-entitlements-db.test.ts` («appActive=false retira lo
  comercial y NO la operación»).
- **Contradicción conocida con el contrato fijado**: el README y `fixtures/06-app-inactive.json` de
  `supabase/tests/fixtures/entitlements-v1/` (FIX-ENT-v1, con checksum) dicen «appActive=false → el
  SaaS bloquea el acceso operativo», y `reference-receiver.ts#isEntitled` niega lo baseline sin
  `appActive`. No se editan (están fijados por checksum y son del emisor): la regla vigente para
  eCommerce es la de D-14. Los tests de contrato solo comparan respuestas HTTP PUT/GET, que no
  cambian. El dueño del contrato debe alinear ese texto en la próxima versión del fixture.
- **El apagado operativo** que D-14 dejó como política aparte ya existe: `lifecycle.v1`
  (`docs/platform-provisioning/LIFECYCLE.md`, migración `20261013100000_tenant_lifecycle.sql`).
  `SUSPENDED` bloquea en la base toda escritura del tenant (`TENANT_SUSPENDED`, SQLSTATE `PT423`) y
  deja la lectura y el login; `appActive` sigue sin bloquear nada operativo.

