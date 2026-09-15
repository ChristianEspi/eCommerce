# Prompt para la sesión de GMAO: alta de la app eCommerce en el hub EBIM

> Copia todo lo que está debajo de la línea y pégalo en una sesión de Claude abierta en
> `d:\PROYECTOS_ANGULAR\GMAO\GMAO`, rama `dev`.

---

## Contexto

Trabajas en el repo de **GMAO**, que además es el **hub de identidad y plataforma de la suite EBIM**
(schema `platform`, proyecto Supabase `xikbhkfeaosasdltartg`). Lee antes el `CLAUDE.md` de este repo y
`EBIM-CONTRATO-PLATAFORMA.md` / `EBIM-DISENO-HUB-IDENTIDAD.md` de la carpeta de plataforma.

Hay una app nueva en la suite: **eCommerce by EBIM**, un SaaS multitenant de tienda B2B/B2C con
proyecto Supabase propio (DEV: `ehxlxbhtlmfgneiagdcj`). Ya usa `organization_id` / `company_id` uuid,
RLS por claims y un proxy `platform-context` propio, pero **nunca se dio de alta en el hub**: no está en
`platform.apps`, no tiene catálogo de addons y ninguna organización la tiene activada.

Objetivo de esta sesión: **dar de alta la app `ecommerce` en el hub, su catálogo de addons, y la
organización demo MiQuímica con sus uuids actuales**, y dejar verificado qué devuelve `platform-context`
para esa organización.

## Reglas de esta tarea

- Commits **locales** en `dev`. **No push, no deploy, no escribir en la base remota** sin orden
  explícita del operador en esta sesión. Si hace falta aplicar algo al proyecto vivo, prepáralo, enséñalo
  y pregunta antes.
- Cambios de esquema o datos del hub **solo con migración nueva e idempotente**
  (`on conflict ... do nothing/do update`). No edites migraciones ya aplicadas.
- **No cambies la interfaz** de `platform-context`, `sso-issue` ni `platform-register`: eExpense,
  eSupplier y otras apps ya dependen de ella. eCommerce se adapta al hub, no al revés.
- **Ningún secreto** (`EBIM_SERVICE_SECRET`, `EBIM_SSO_SECRET`, service_role) en archivos, commits,
  buzón ni en la respuesta. Si hace falta referirse a uno, por su nombre.
- No inventes precios, planes ni códigos que no estén aquí. Si el modelo del hub exige un dato que no te
  doy, **para y pregunta**.
- `dcalagua@ebim.pe` nunca como actor de negocio de un tenant.

## Paso 1 — Reconocimiento (solo lectura) y reporte

Antes de escribir nada, averigua y **repórtame** con evidencia (archivo:línea o consulta de solo lectura):

1. Definición real de `platform.apps`, `platform.workspace_apps`, `platform.catalog_items` y de la tabla de
   addons activos por sociedad (`company_addons` u otra): columnas, claves, CHECKs y valores de estado
   admitidos. Cómo están registradas hoy `gmao`, `eexpense`, `esupplier` (y `echange`/`wms` si existen):
   copia sus filas como referencia de formato.
2. Dónde se crean esas filas: ¿hay migración en el repo o se cargaron directo en la base? Si no hay
   migración, dilo.
3. Firma y cuerpo de `platform.hub_upsert_org`, `hub_upsert_company`, `hub_activate_app`, `hub_set_addon`,
   `hub_get_catalog` y **`platform.org_context`**. En particular: **la forma exacta del JSON que devuelve
   `org_context`** (claves de primer nivel y de cada elemento) y si incluye algo que diga si una app
   concreta está activa para la organización.
4. Si `hub_upsert_org` deduplica por `slug` o `tax_id`: ¿existe ya alguna organización con slug
   `miquimica` o con los uuids de la tabla del paso 3?
5. Formato admitido para el código de addon: ¿acepta puntos (`ecommerce.pricing.lists`) o el catálogo usa
   otra convención (`echange_reporting`)?

## Paso 2 — Registrar la app y su catálogo (migración nueva)

Crea **una migración nueva e idempotente** que:

### 2.1 Registre la app en `platform.apps`

| campo | valor |
|---|---|
| code | `ecommerce` |
| name | `eCommerce` |
| icon / accent | sigue el formato de las otras apps; si hay que elegir, color de marca EBIM `#5AA97F` |
| base_url | `null` por ahora (el operador la pone luego en *Pagos → Apps de la plataforma*) |
| status | el mismo que tienen las apps en uso |

### 2.2 Cargue su catálogo de addons en `platform.catalog_items`

`app_code = 'ecommerce'`. Son **24 addons vendibles**. Precio: **no inventar** — déjalo nulo o como el
catálogo marque "por definir", y avisa para que el operador lo fije.

Las **6 capacidades incluidas** (`catalog`, `storefront`, `checkout`, `orders`, `customers`,
`analytics.basic`) **no se venden**: no las cargues como addon. Si el modelo del hub necesita una fila de
"módulo base" para poder contratar la app (como hizo eChange con `echange_core`), crea una sola,
`ecommerce.core`, marcada como incluida, y dilo.

| código | nombre | categoría sugerida | qué habilita |
|---|---|---|---|
| `ecommerce.catalog.advanced` | Catálogo avanzado | Catálogo | Variantes, atributos, unidades de venta y kits sobre un producto maestro |
| `ecommerce.pricing.lists` | Listas de precios | Comercial | Precios por canal, segmento, cliente, cantidad, moneda y vigencia |
| `ecommerce.customers.b2b` | Cuentas de empresa | Comercial | Cuentas con varios usuarios, sucursales, roles y límites de aprobación |
| `ecommerce.inventory.multiwarehouse` | Inventario multialmacén | Operación | Existencias por almacén, movimientos, reservas y ATP |
| `ecommerce.payments` | Cobros en línea | Operación | Autorización, captura, devolución y conciliación |
| `ecommerce.promotions` | Promociones | Marketing | Campañas, cupones y tarjetas regalo |
| `ecommerce.content.cms` | Gestor de contenido | Marketing | Páginas, colecciones y bloques de la vitrina |
| `ecommerce.content.white_label` | Marca blanca | Marketing | Vitrina y correo sin firma de suite, dominio propio |
| `ecommerce.fulfillment` | Entregas y devoluciones | Operación | Zonas, métodos, recojo, preparación, seguimiento y devoluciones |
| `ecommerce.fulfillment.routing` | Enrutado de entregas | Operación | Hoja de ruta y prueba de entrega con firma y geoposición |
| `ecommerce.orders.advanced` | Pedidos avanzados | Operación | Pedidos programados, repetición e importación masiva |
| `ecommerce.analytics.advanced` | Analítica avanzada | Analítica | Embudo de conversión y términos de búsqueda |
| `ecommerce.integrations.enterprise` | Integraciones corporativas | Integración | API de socio, credenciales con permisos y webhooks |
| `ecommerce.sales.force` | Fuerza de ventas | Ventas B2B | Vendedores con jerarquía y cartera |
| `ecommerce.sales.territory` | Territorios de venta | Ventas B2B | Territorios, cobertura y rutas de visita |
| `ecommerce.sales.performance` | Desempeño comercial | Ventas B2B | Visitas, metas, comisiones y liquidaciones |
| `ecommerce.credit.management` | Gestión de crédito | Finanzas | Cuentas por cobrar, cobros y antigüedad de saldos |
| `ecommerce.invoicing` | Facturación | Finanzas | Comprobante fiscal con impuesto por línea |
| `ecommerce.trade.quotes` | Cotizaciones | Ventas B2B | Cotizaciones con vigencia convertibles en pedido |
| `ecommerce.trade.assortments` | Surtidos por cliente | Ventas B2B | Qué puede comprar cada cliente, segmento o canal |
| `ecommerce.planning.demand` | Planificación de demanda | Analítica | Pedido sugerido y previsión de demanda |
| `ecommerce.ai.assist` | Asistencia con IA | IA | Asistente de compra sobre el catálogo, con cuota por sociedad |
| `ecommerce.ai.catalog.copy` | Redacción de fichas con IA | IA | Borrador de ficha de producto revisado por una persona |
| `ecommerce.ai.insights` | Análisis y alertas con IA | IA | Señala qué indicadores de la tienda merecen atención |

Si el paso 1.5 dice que los puntos no se admiten, **no cambies los códigos por tu cuenta**: para y
repórtalo; el cambio de convención se decide con eCommerce.

## Paso 3 — Registrar la organización demo MiQuímica (con sus uuids)

Estos uuids **ya existen en la base de eCommerce DEV** y deben conservarse tal cual en el hub. Son uuids de
demo (patrón `d0000000-…`), es una organización de prueba, no un cliente real.

| organization_id | slug | nombre | company_id | sociedad | país |
|---|---|---|---|---|---|
| `d0000000-0000-4000-8000-000000000001` | `miquimica` | MiQuímica | `d0000000-0000-4000-8000-0000000000c1` | MiQuímica | PE |

No registres `d0000000-0000-4000-8000-000000000002` (Tenant B): es un tenant de pruebas de aislamiento.

Pasos (vía las RPC que usa `platform-register`, o en la misma migración si así se cargan los demos en
este repo — sigue la convención que encuentres):

1. `upsert_org` con `id = d0000000-0000-4000-8000-000000000001`. **Verifica que el `org_id` devuelto es
   exactamente ese.** Si la deduplicación devuelve otro, para y repórtalo: no sigas.
2. `upsert_company` con `id = d0000000-0000-4000-8000-0000000000c1`, misma verificación.
3. `activate_app` con `app_code = 'ecommerce'`, `status = 'active'`.
4. `set_addon` activo para estos 22 códigos, que son los que la sociedad tiene hoy activos en eCommerce:

   `ecommerce.ai.assist`, `ecommerce.analytics.advanced`, `ecommerce.catalog.advanced`,
   `ecommerce.content.cms`, `ecommerce.content.white_label`, `ecommerce.credit.management`,
   `ecommerce.customers.b2b`, `ecommerce.fulfillment`, `ecommerce.fulfillment.routing`,
   `ecommerce.integrations.enterprise`, `ecommerce.inventory.multiwarehouse`, `ecommerce.invoicing`,
   `ecommerce.orders.advanced`, `ecommerce.payments`, `ecommerce.planning.demand`,
   `ecommerce.pricing.lists`, `ecommerce.promotions`, `ecommerce.sales.force`,
   `ecommerce.sales.performance`, `ecommerce.sales.territory`, `ecommerce.trade.assortments`,
   `ecommerce.trade.quotes`

Ejecutar esto contra la base viva del hub **requiere orden del operador**: pregunta antes.

## Paso 4 — Verificar lo que verá eCommerce

Con autorización del operador, llama a `platform-context` del hub para
`org_id = d0000000-0000-4000-8000-000000000001` (POST, cabecera `X-EBIM-Service`) y **pégame el JSON de
respuesta completo** (no contiene secretos; si contuviera alguno, sustitúyelo por `***`).

Necesito confirmar:
- la forma exacta de la respuesta (`organization`, `companies`, `addons`, `apps`, …);
- que `addons["d0000000-0000-4000-8000-0000000000c1"]` trae los 22 códigos;
- cómo se ve que `ecommerce` está activa para esa organización.

## Paso 5 — Avisar por el buzón

Deja un mensaje en `coordinacion/pendientes/` con el formato habitual (`from: gmao`, `to: ecommerce`) que
incluya:
- migración creada y si se aplicó o no;
- códigos de addon definitivos (y si cambió la convención);
- la forma de respuesta de `platform-context` (paso 4) y cómo indica que la app está activa;
- URL de las funciones del hub: `https://xikbhkfeaosasdltartg.supabase.co/functions/v1/platform-context`
  y `.../sso-issue`;
- **sin ningún secreto**: solo "`EBIM_SERVICE_SECRET` y `EBIM_SSO_SECRET` se entregan por canal del
  operador".

Añade la fila en `coordinacion/BANDEJA.md`.

## Qué **no** hacer en esta sesión

- No construir nada de eCommerce (ruta `/sso`, adaptaciones del proxy): eso se hace en el repo de
  eCommerce.
- No dar de alta la organización "Biel" todavía: se hará después, con uuids que se generarán en eCommerce.
- No tocar datos de clientes reales de GMAO (Gloria, ALO Group, Grupo EBIM).

## Entrega

Resumen en español con: lo encontrado en el paso 1, migración creada (ruta y commit), qué quedó aplicado y
qué no, JSON del paso 4 y ruta del mensaje del buzón.
