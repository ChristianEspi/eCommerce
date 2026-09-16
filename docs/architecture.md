# Arquitectura inicial — eCommerce by EBIM

Compatible con `EBIM-CONTRATO-PLATAFORMA.md` (§0 principios, §1 topología, §2 identidad, §3 jerarquía,
§5 Platform Context API, §7 qué vive dónde, §8 convenciones).

> **Desde P17-SaaS (2026-08-30)** este documento describe **cómo está construido** el sistema. Para
> las otras dos preguntas hay documento propio, y conviene no duplicarlas aquí:
> - **qué está listo, qué es parcial y cómo se extiende para un cliente nuevo** →
>   [`SAAS_RELEASE_BASELINE.md`](SAAS_RELEASE_BASELINE.md)
> - **qué falta, clasificado y con responsable** → [`SAAS_GAPS.md`](SAAS_GAPS.md)
>
> El mapa de fronteras no vive en prosa: `src/domain/boundaries.ts` lo declara y
> `src/architecture.test.ts` rompe la suite si el código se sale de él.

## Topología

```
Comprador (público) ─┐
                     ├─► App eCommerce (React + TS + Vite + MUI)
Usuario del tenant ──┘      ├─ /s/:storeSlug  storefront público (tenant por slug/dominio)
                            ├─ /s/:slug/p/:page  página administrable del CMS (P11-SaaS)
                            └─ /app           backoffice (sesión + membership + active_company)
                                   │
                                   ▼
                     Supabase eCommerce (proyecto propio)
                       ├─ PostgreSQL (RLS default deny)
                       ├─ Storage (imágenes de producto, path por tenant)
                       └─ Edge Functions (Deno)
                            ├─ bootstrap-tenant   (alta de tenant, clave de aprovisionamiento)
                            ├─ checkout           (pipeline de 11 etapas, idempotente — P07-SaaS;
                            │                      desde P10 la etapa 4 evalua promociones y
                            │                      la 8a canjea tarjeta regalo antes de cobrar)
                            ├─ create-order       (la puerta de P02-P06; sigue viva)
                            ├─ catalog-product    (alta/edición con el JWT del usuario)
                            ├─ update-order-status (transiciones con el JWT del usuario)
                            ├─ payments-webhook   (la pasarela dice qué pasó — P09-SaaS)
                            ├─ fulfillment-webhook (el operador dice dónde va — P12-SaaS)
                            ├─ api                (la API de SOCIO, versionada: /v1/…
                            │                      OAuth client_credentials + scopes — P14-SaaS)
                            ├─ integration-worker (vacía la cola y FIRMA los webhooks;
                            │                      clave de trabajador en cabecera — P14-SaaS)
                            └─ storefront-seo     (sitemap.xml y robots.txt POR TIENDA;
                                                   cliente ANÓNIMO, tenant por slug — P15-SaaS)

Sistema de un socio ──► api  ──►  Postgres (el tenant sale de la fila de la credencial)
Sistema suscrito    ◄── integration-worker ◄── integration_outbox ◄── domain_events

                            ├─ platform-context   ──► HUB EBIM (addons y config, §5)
                            │                        [escrita y probada; el hub todavía
                            │                         no conoce esta app → HUB_NO_CONFIGURADO]
                            │
                            └─ sso  [PENDIENTE]    ──► HUB EBIM (verifica JWT contra JWKS)
```

> **Estado real de la identidad.** `sso` sigue sin existir; `platform-context` sí existe desde
> P02-SaaS, pero su camino hacia el hub nunca se ha ejercitado contra un hub real porque
> `ecommerce` no está dado de alta en la suite (`SAAS_ROADMAP` §5.1). La identidad efectiva de DEV/QAS es Supabase Auth más el hook
> `ebim.demo_access_token_hook` (migraciones `20260827120000` y `..._121000`), y el camino contra el
> hub no se ha ejercitado nunca. Corregido en P01-SaaS por ser un error de documentación; el cambio
> de identidad en sí está bloqueado (contrato §2, cambios breaking al buzón) y corresponde a
> P02/P16.

El **hub EBIM** es el emisor de identidad y dueño del catálogo/billing. eCommerce **lee** del hub y nunca
escribe en él. La identidad del comprador final del storefront es **local** a este proyecto (patrón §2.5,
igual que los proveedores externos de eSupplier); los usuarios del tenant llegan por SSO del hub.

## Modelo de datos (implementado hasta P14-SaaS)

Nueve tablas en `supabase/migrations`, todas con `organization_id uuid` + `company_id uuid` (uuids del hub),
`created_at`/`updated_at`, PK uuid y RLS default deny **forzada**:

```
tenants (PK = organization_id del hub)
  └── tenant_members (usuario × sociedad × rol de app)
  └── products (MAESTRO de la sociedad, ADR 018) ── product_images · PIM
  └── stores (N por sociedad desde 2026-09-17: `create_store`; slug/dominio públicos)
        ├── store_settings (1:1 — branding publicable + config interna)
        ├── categories (árbol dentro de la misma tienda)
        ├── store_products (publicación del maestro: slug, categoría, estado, precio)
        │     └── store_price_overrides (precio propio de variante/presentación)
        └── orders ────── order_items (snapshot completo; line_total GENERATED)
                     ├── order_events        linea de tiempo de los 4 ejes (P08)
                     ├── order_notes/tags    anotaciones internas (P08)
                     └── order_external_refs como se llama en otros sistemas (P08)
```

- **`organization_id` es el "tenant_id"** del modelo: nombre exacto del contrato §3, sin variantes.
  `store_id` es la dimensión adicional propia de eCommerce.
- **FK compuestas** `(store_id, organization_id, company_id) → stores`: una fila hija no puede declarar un
  tenant distinto al de su tienda, aunque alguien se equivoque copiando uuids.
- **Predicado único de acceso** `ebim.can_access(org, company)`: claims del JWT **y** membresía activa.
  Escritura además por rol: `ebim.has_role(...)` con `owner/admin/catalog/orders/viewer`.
- **Dinero en `numeric(14,2)`**, nunca float; los importes salen de la API como string decimal.
- Storefront público: policies `to anon` limitadas a tienda activa + producto publicado, con **GRANT por
  columna** (RLS filtra filas, nunca columnas) y vistas `security_invoker` encima
  (`public_stores`, `public_categories`, `public_products`, `public_product_images` y
  `public_store_branding` — §4.3). La disponibilidad se publica como `products.in_stock`, columna
  **generada** (`stock > 0`): `anon` la lee, pero nunca lee `stock` (P05). Desde P06 la vista
  publica un booleano calculado por ATP, y la cifra exacta sigue sin salir a `anon`.
- Sin forks de schema por cliente: diferencias por `store_settings.config` + `products.custom_fields` (JSONB).
- El recorrido de las tablas: `customers` llegó en P05-SaaS; los almacenes y las reservas, en
  P06-SaaS; `carts`, `checkout_intents` y `domain_events`, en P07-SaaS; la línea de tiempo del
  pedido, sus anotaciones y sus referencias externas, en P08-SaaS; las siete tablas del cobro, en
  P09-SaaS; las campañas, los cupones y las tarjetas regalo, en P10-SaaS; las páginas, los bloques y
  los sinónimos de búsqueda, en P11-SaaS; las quince de la entrega y la devolución, en P12-SaaS; y
  `analytics_events`, `audit_log` y `ops_events` en P13-SaaS; y las siete de la superficie
  empresarial —tres de webhooks y cuatro de la API de socio— en P14-SaaS. **`audit_log` deja de ser un
  pendiente**: existe desde P13 y es append-only para todos, incluido `service_role`.

### Producto maestro de sociedad y publicación por tienda (ADR 018, 2026-09-17)

`products` es el maestro de la SOCIEDAD (SKU único por sociedad) y `store_products` su publicación
en cada tienda. El backoffice (`/app/products`) lista maestros sin precio global y administra cada
tienda en la pestaña «Tiendas» con `publish_product`, `update_product_publication` y
`unpublish_product` (INVOKER, tenant del JWT). La vitrina resuelve siempre por
`tienda + store_products.slug`. Durante la transición, `products.store_id` es la tienda de ORIGEN,
sincronizada con su publicación, y el `store_id` del PIM lo ancla la base a ese origen; la fase 05
migra los consumidores de comercio y retira la sincronía. Detalle en
[`STORES_PRODUCT_MASTER_MIGRATION_PLAN.md`](STORES_PRODUCT_MASTER_MIGRATION_PLAN.md).

### PIM: variantes, atributos, unidades y kits (P03-SaaS)

Once tablas más, migraciones `20260827170000`–`20260827170300`. Decisiones completas en
[`adr/003-pim-variantes-uom-kits.md`](adr/003-pim-variantes-uom-kits.md).

```
VOCABULARIO DE LA SOCIEDAD (sin store_id: se reusa en todas sus tiendas)
  brands · product_families · units_of_measure
  attributes ──── attribute_values          (dominio cerrado de los de tipo lista)

EL PRODUCTO CRECE
  products + kind (simple | variant | bundle) + brand_id + family_id

LO QUE CUELGA DEL PRODUCTO (con store_id: el producto es de una tienda)
  product_variants ──── variant_attribute_values   (la combinación que ES cada variante)
  product_attribute_values                          (ficha técnica, una columna por tipo)
  product_uoms                                      (factor de conversión a unidad base)
  bundle_items                                      (receta del kit; NO hay tabla `bundles`)
  product_relations                                 (accesorio, sustituto, venta cruzada)
```

- **El producto sigue siendo el maestro único.** Un kit ES un producto con `kind = 'bundle'`; darle
  tabla propia habría duplicado SKU, precio, imágenes y publicación. Un maestro de variantes **no se
  vende**: se vende una de sus filas de `product_variants`.
- **Cuatro reglas del modelo se impiden con FK, no con triggers**: columna denormalizada + CHECK +
  FK a una clave de apoyo del padre con `on update cascade`. Es lo que permite que un CHECK mire otra
  tabla — variante solo bajo un `kind='variant'`, valor solo bajo un atributo de lista, eje solo si
  está declarado eje, y ningún kit dentro de otro kit.
- **Un solo espacio de nombres de SKU por tienda** entre `products` y `product_variants`, con el
  trigger `ebim.assert_sku_unique_in_store`. Es lo único que ningún índice puede expresar.
- **`factor` en `numeric(18,6)`**, nunca float: multiplicado por miles de líneas, el redondeo binario
  es descuadre de inventario. Una conversión que no da unidades base enteras se rechaza.
- **`products.price` y `products.stock` NO se retiran** (cinco consumidores vivos); lo que cambia es
  su significado por tipo, escrito en `comment on column`. Retirar `stock` es trabajo de P06.
- **Disponibilidad pública por tipo**: `public_products.in_stock` es la columna generada para el
  simple, `bool_or` de variantes para el maestro, y `ebim.bundle_is_available` para el kit — única
  función `SECURITY DEFINER` nueva, con su autorización dentro y limitada a kits ya públicos.
- Vista nueva `public_product_variants` (precio heredado ya resuelto, sin SKU ni existencia exacta).
  La composición del kit y los atributos **no** salen a `anon` en esta fase.

### Motor de precios (P04-SaaS)

Cinco tablas más, migraciones `20260827180000`–`20260827180200`. Decisiones completas en
[`adr/004-pricing-engine.md`](adr/004-pricing-engine.md).

```
VOCABULARIO DE LA SOCIEDAD (sin store_id)
  customer_segments                el grupo comercial; P05 le cuelga los clientes

EL ACUERDO (de la tienda)
  price_lists ──── price_list_items         precio por producto/variante, presentación y escala
              └── price_list_assignments    a quién: tienda · canal · segmento · cliente

BITÁCORA
  price_change_events               alta, cambio y baja de precio, con actor. Sin FK: sobrevive a la lista
```

- **Una sola autoridad de precio: `ebim.resolve_prices`.** `create_order` deja de calcular y pasa a
  preguntar (`180200`); la vitrina lee un precio ya resuelto; el carrito cotiza contra la misma
  función. Lo que se muestra, lo que se cotiza y lo que se cobra salen del mismo sitio, y hay un
  test que lo compra comparando los tres totales.
- **Contexto explícito y nada de él viene del navegador**: tienda (del slug), canal (de la tienda),
  segmento y cliente (solo si los pone un llamante de servidor). La lista negra del payload crece
  con `segment_id`, `customer_id`, `price_list_id`, `price_source` y `channel_id`, en el borde y en
  la base.
- **Precedencia TOTAL y documentada**: especificidad del alcance (cliente 40 > segmento 30 > canal
  20 > tienda 10) → `priority` → `valid_from` más reciente → `id`. La especificidad no es
  configurable; el último paso lo denuncia `public.price_list_conflicts` como ambigüedad.
- **La escala se mide en unidades base**, nunca en unidades de venta: si no, cambiar de presentación
  cambiaría el descuento sin que nadie lo decidiera.
- **Fallback al precio de catálogo** cuando ninguna lista alcanza —incluido el tenant que no tiene
  `pricing.lists` contratado—. Por eso ningún test de pedido de P02/P03 cambió una línea.
- **El entitlement se comprueba con un JOIN** dentro de `ebim.active_price_lists` y no llamando a
  `has_capability`: una función invocada dentro de una vista definer corre como el usuario que
  pregunta, y para `anon` devolvería «no» siempre.
- **La vitrina muestra el precio resuelto** (`ebim.public_unit_prices`, definer, limitada a alcances
  tienda y canal público). Un precio de segmento o de cliente no sale nunca a `anon`.
- **Tres puertas públicas, tres autorizaciones**: `price_quote_for_slug` (anónima, por slug),
  `price_quote` (backoffice, con membresía) y `price_list_conflicts` (invoker, la RLS decide).
- `order_items` gana `price_source` y `price_list_id`: la línea explica por qué costó lo que costó.

### Clientes y cuentas B2B (P05-SaaS)

Ocho tablas más, migraciones `20260827190000`–`20260827190200`. Decisiones completas en
[`adr/005-customers-b2b.md`](adr/005-customers-b2b.md).

```
VOCABULARIO DE LA SOCIEDAD (sin store_id: el cliente lo es de todas sus tiendas)
  customers ──── customer_addresses      envío y facturación, con estado de verificación
            ├─── customer_contacts       las personas del cliente; NO son usuarios
            └─── customer_external_ids   cómo se llama en cada sistema externo

EL PORTAL (se contrata: `customers.b2b`)
  business_accounts ──── business_locations      sucursales y centros de entrega
                    ├─── business_account_users  EL VÍNCULO usuario ↔ cuenta
                    └─── approval_rules          desde qué importe y quién aprueba
```

- **`customers` no tiene `user_id`.** Usuario autenticado y cliente son dos ejes distintos: la
  identidad la emite el hub y el vínculo con personas es una RELACIÓN, porque una columna solo sabe
  expresar «uno». Un test de esquema falla si esa columna aparece.
- **La ficha es baseline; el portal se vende.** `customers` entra en `app_capabilities` como
  capacidad baseline y `customers.b2b` pasa a `implemented`. Escribir un cliente pide rol
  (`owner`/`admin`/`orders`); escribir una cuenta pide rol (`owner`/`admin`) **y** capacidad.
- **Una cuenta corporativa sobre una persona es imposible**: FK compuesta `(customer_id,
  customer_kind)` contra `customers (id, kind)`, la técnica del PIM.
- **`public.my_business_accounts()` no acepta argumentos.** Es la forma de la regla «el acceso a una
  cuenta exige vínculo servidor»: sin parámetro no hay id que el navegador pueda declarar. Los
  usuarios B2B **no tienen ni una policy** sobre estas tablas —no son miembros del tenant— y esa
  función definer es su única puerta.
- **Roles fijos, importes configurables**: enum `business_role` (`admin`, `approver`, `buyer`,
  `viewer`) y límites por persona (`spending_limit`) y por cuenta (`approval_rules.min_amount`). Un
  rol cuyos permisos fueran datos permitiría marcar «puede aprobar» sobre un comprador.
- **`public.purchase_approval(cuenta, importe)`** decide y explica el motivo (`user_limit`, `rule`,
  `account_threshold`). Es una función pura: no crea solicitudes ni cambia estados. La llaman por
  igual el portal y el backoffice.
- **La dirección**: uso en dos banderas (envío/facturación, al menos una), predeterminado por índice
  parcial único, y verificación como ESTADO de cuatro valores —«no se preguntó» y «lo rechazaron» no
  son lo mismo—. `verified_at` lo estampa un trigger.
- **El identificador externo es atributo, nunca clave**: no es único entre sistemas, cambia con la
  versión del ERP y no existe para el cliente de ayer.
- **Cierra la deuda de P04**: `price_list_assignments.customer_id` gana su FK tenant-safe y
  `public.price_quote` deriva el segmento de la ficha cuando no se declara.
- **`orders` NO gana `customer_id`**: el checkout sigue siendo anónimo y esa columna solo la podría
  rellenar el navegador. `public.customer_orders` enlaza por correo y lo dice.

### Inventario multi-almacén, ATP y reservas (P06-SaaS)

Seis tablas más, migraciones `20260827200000`–`20260827200400`. Decisiones completas en
[`adr/006-inventory-atp-reservations.md`](adr/006-inventory-atp-reservations.md).

```
VOCABULARIO DE LA SOCIEDAD (sin store_id: el almacén sirve a todas sus tiendas)
  warehouses ──── store_warehouses      qué tienda se sirve de cuál, y en qué orden
                                        SIN filas = todas: declarar es restringir

LA EXISTENCIA
  inventory_levels     on_hand · reserved · available (GENERADA) · safety_stock · reorder_point
  inventory_movements  libro mayor inmutable: delta con signo, saldo resultante y por qué

LO COMPROMETIDO
  inventory_reservations ──── inventory_reservation_items
```

- **La sobreventa la impide un CHECK, no la disciplina del que escribe.**
  `inventory_levels_no_oversell` (`reserved <= on_hand` y `on_hand >= 0`, salvo backorder explícito)
  aborta la transacción aunque el reparto fallara. Es la última línea, y hay un test que intenta
  saltársela como `service_role`.
- **`available_qty` es una columna GENERADA** (`on_hand - reserved`): no puede discrepar de sus dos
  sumandos. Lo *prometible* descuenta además `safety_stock` y lo calcula `ebim.atp`, porque el
  colchón es política comercial y no un hecho del almacén.
- **El reparto decide DENTRO de la sentencia que escribe** (`ebim.take_units`): una CTE con
  `SELECT … FOR UPDATE` toma el bloqueo y relee la fila ya bloqueada, así que la cantidad a tomar
  sale de la cifra verdadera y no de una foto anterior. Sin bucle de reintento: no hay conflicto que
  reintentar.
- **El backorder es una política del almacén**, denormalizada en el nivel con FK a
  `warehouses (id, allows_backorder)` y `on update cascade` — la técnica del PIM, que es lo que
  permite que un CHECK mire otra tabla.
- **«No se sabe» no es «no hay»**: un almacén `source = 'erp'` con la cifra caducada deja de aportar
  (`stale_policy = 'unknown'`, `ebim.atp` responde `unknown: true`) o sigue con la última cifra
  (`trust_last_known`). Nunca cero. El checkout se niega con `DISPONIBILIDAD_DESCONOCIDA` y la
  vitrina **no se vacía**.
- **La reserva tiene caducidad obligatoria** (`expires_at` NOT NULL), **idempotencia de negocio**
  (`reference_key`, índice único parcial sobre `held`) y un **secreto de 256 bits** (`token`) que es
  lo único que permite al checkout reclamarla. Caduca sola al reservar y al pedir: este proyecto no
  tiene cron garantizado.
- **Ninguna existencia se escribe con `UPDATE`**: las cuatro tablas de saldo no tienen GRANT de
  escritura para `authenticated` ni `anon`. Toda entrada, corrección y reserva pasa por una función
  que mueve y anota en la misma transacción.
- **El libro mayor es idempotente por `external_ref`** (índice único parcial): un webhook reenviado
  no descuenta dos veces. `sync_inventory_level` recibe SALDOS absolutos del ERP y calcula el delta.
- **`products.stock` NO se retira**: pasa a ser el camino de FALLBACK. `ebim.consume_stock` tiene los
  dos caminos dentro y `create_order` llama a uno solo; sin almacenes que sirvan a la tienda hace
  exactamente lo de antes. Ningún test de pedido de P02/P03/P04 cambió una línea.
  `public.seed_inventory_from_catalog` copia el catálogo al almacén, idempotente.
- **La vitrina pregunta en vez de leer una columna**: `in_stock` sale de
  `ebim.product_is_available` (definer, autorización dentro, solo un booleano) y el kit de
  `ebim.bundle_is_available` recalculado contra el ATP de sus componentes.
- **`warehouse_locations` y `reservation_events` NO se crearon**, y el ADR dice el disparador de cada
  una: las ubicaciones son WMS y P12; el historial de la reserva ya es la propia fila más el asiento
  del libro mayor.
- `InventoryPort` gana **dos** implementaciones —backoffice (con cifra) y vitrina (solo semáforo)—,
  que es exactamente lo que justificaba el puerto desde P01.

### Carrito persistente y pipeline de checkout (P07-SaaS)

Cuatro tablas más, migraciones `20260828100000`-`20260828100400`. Decisiones completas en
[`adr/007-cart-checkout-pipeline.md`](adr/007-cart-checkout-pipeline.md).

```
EL CARRITO (de una tienda y de UN canal)
  carts ──── cart_items      dueño = sesion O secreto de 256 bits, nunca un id declarado
                             unit_price_snapshot: INFORMATIVO, jamas autoridad de cobro

EL INTENTO DE COMPRA
  checkout_intents           (store_id, idempotency_key) unico + resumen de la peticion

LOS HECHOS
  domain_events              outbox de DOMINIO, sin proveedor: publica aunque el tenant
                             no tenga ni una integracion contratada
```

- **El ancla de la idempotencia es una fila, no el botón deshabilitado.** `checkout_begin` devuelve
  `replay: true` con la respuesta guardada; repetir la misma petición devuelve el MISMO pedido.
  `request_hash` ata la clave a lo que se pidió: adivinar la clave no basta.
- **El orquestador es TypeScript puro** (`supabase/functions/_shared/checkout/pipeline.ts`), once
  etapas en orden, con pila de compensaciones y errores tipados por etapa. Vive en el borde y no en
  PL/pgSQL porque la etapa de cobro es una llamada de red: dentro de una transacción de la base
  bloquearía las filas de existencia mientras un tercero contesta.
- **Las etapas 10 y 11 no ejecutan nada, y eso es la propiedad**: los hechos se escriben DENTRO de la
  transacción del pedido (`checkout_place_order`), así que no existe «pedido creado, nadie enterado».
- **Los tres ganchos vacíos ya tienen motor detrás** —promociones (P10), cobro (P09) y entrega
  (P12)— y **ninguna de las tres fases abrió el orquestador para meter una etapa**: sustituyeron un
  adaptador, que era exactamente el punto de dejar el asiento hecho. Las tres funciones neutras
  (`noPromotions`, `noPaymentGateway`, `alwaysDeliverable`) siguen existiendo y siguen probadas: son
  el camino del tenant que no tiene ese módulo contratado. Ningún nombre de pasarela, transportista
  ni ERP aparece en el directorio.
- **La etapa 7 resuelve el coste de la entrega, y la 8 autoriza el total CON transporte** (P12). Es
  lo único que no se podía dejar para `create_order`: si el envío apareciera solo dentro de la
  transacción del pedido, a la pasarela se le habría pedido de menos y el comercio cobraría el envío
  a nadie.
- **La fusión invitado → usuario toma el MÁXIMO, no la suma**, solo absorbe carritos sin dueño y
  exige mismo canal.
- **En la petición de compra no viaja ni un céntimo**: el aviso de cambio de precio lo produce
  `cart_price_drift` comparando la cotización vigente contra el snapshot del propio motor.
- **`domain_events` no es `integration_outbox`**: aquella exige un proveedor ACTIVO y entrega a un
  sistema; esta publica un hecho y funciona en un tenant sin conectores.
- **Ni `anon` ni `authenticated` escriben una sola fila** de las cuatro tablas; el `token` del
  carrito y el `reservation_token` del intento quedan fuera del GRANT por columna del backoffice.

### OMS: cuatro ejes, snapshots inmutables y comandos (P08-SaaS)

Cuatro tablas más, migraciones `20260828110000`-`20260828110600`. Decisiones completas en
[`adr/008-oms-order-axes-snapshots.md`](adr/008-oms-order-axes-snapshots.md).

```
EL PEDIDO CRECE (sin renombrar nada de lo que ya habia)
  orders  + status (comercial, el de siempre)
          + payment_status · fulfillment_status · approval_status
          + source_channel   POR QUE PUERTA entro; distinto de channel_id (canal COMERCIAL)
          + tax_inclusive · billing_address · shipping_address_snapshot · customer_snapshot
  order_items + tax_rate/tax_amount/tax_category_code · discount_amount/discount_snapshot
              + variant_label/variant_attributes · components_snapshot · price_list_code

EL RELATO
  order_events        linea de tiempo de los CUATRO ejes, append-only, un solo escritor

LO QUE ESCRIBE EL EQUIPO
  order_notes         hilo interno; orders.notes sigue siendo la instruccion del COMPRADOR
  order_tags          triage plano, normalizado por CHECK y por trigger

LO QUE ESCRIBEN OTROS SISTEMAS
  order_external_refs (order_id, system_code, ref_type) — atributo, nunca clave
```

- **`status` no cambia de significado.** Se le suman tres ejes porque una columna que responde «¿llegó
  el dinero?», «¿salió la mercancía?» y «¿en qué punto comercial está?» a la vez no puede escribir un
  pedido pagado y no despachado. La compatibilidad la garantiza `ebim.sync_order_axes`, que corre
  ANTES que la máquina de los ejes (orden alfabético de triggers BEFORE) y adelanta lo que la
  sentencia no tocó: el estado «`paid` con `payment_status` en `pending`» es imposible, no
  improbable.
- **Los tres ejes nuevos NO tienen GRANT de escritura.** El GRANT por columna de P02 no se amplía, así
  que la única puerta es `public.order_transition`, que reúne en una operación atómica autorización +
  máquina de estados + línea de tiempo + hecho de dominio. Un test enumera las columnas con `UPDATE`
  para `authenticated` y falla si aparece una cuarta.
- **El motivo del cambio viaja por un ajuste LOCAL de transacción** (`set_config(…, true)`) que lee el
  trigger de la línea de tiempo. Así el escritor de `order_events` sigue siendo único y **no existe un
  cambio de estado sin evento**, ni siquiera si alguien escribe un UPDATE a mano.
- **La inmutabilidad es un trigger, no un comentario**: `ebim.assert_order_item_immutable` y
  `ebim.assert_order_snapshot_immutable` detienen también a `service_role`, que sí tiene GRANT y no
  pasa por ninguna policy. `shipping_address` sigue siendo corregible y su original vive en
  `shipping_address_snapshot`, que no tiene GRANT para nadie.
- **El impuesto se reparte por línea con resto mayor**: el total del grupo de tasa se distribuye en
  proporción al importe y el residuo va a la línea mayor. La suma de las líneas es EXACTAMENTE el
  `tax_total` del pedido por construcción, no por suerte.
- **La aprobación B2B no contamina B2C**: `not_required` es terminal, y con la aprobación pendiente no
  se mueve ningún eje salvo cancelar. El umbral de la CUENTA lo impone la base con la fila delante; el
  límite de la PERSONA lo aporta el borde, que es donde hay sesión — y solo puede AÑADIR aprobación,
  nunca quitarla.
- **`order_status_events` no se retira**: sigue viva y su historial se copió a `order_events`, para
  que un pedido anterior a esta fase no aparezca sin memoria.
- **Pedidos programados, repetición e importación se PREPARAN sin construirse**: capacidad
  `orders.advanced` (`declared`), los tres valores ya en el enum `order_source_channel` y
  `order_external_refs` como lote de origen. `order_schedules` y `order_batches` **no se crean**;
  el ADR escribe el disparador de cada una, igual que P06 con `warehouse_locations`.

### Pagos: contrato de pasarela, comandos y conciliación (P09-SaaS)

Siete tablas más, migraciones `20260828120000`-`120200`. Decisiones completas en
[`adr/009-payments-provider-contract.md`](adr/009-payments-provider-contract.md).

```
payment_methods        QUE puede elegir el comprador. Config PUBLICA; sin credenciales.
  └── payment_intents  LA INTENCION de cobrar. Nace ANTES que el pedido y se ata despues.
        ├── payment_attempts  CADA llamada al proveedor, con su resultado. Append-only.
        ├── payments          EL DINERO cobrado. ── refunds  LA DEVOLUCION, con idempotencia propia.
        └── payment_events    la bitacora del dominio. Append-only, incluso para service_role.
reconciliation_records LO QUE EL PROVEEDOR DICE QUE LIQUIDO. De la SOCIEDAD, no de la tienda.
```

- **El dominio de pedidos no se enteró de nada.** `orders` y `order_items` no ganaron ni una columna:
  el cobro apunta al pedido y el pedido no apunta al cobro. Tres FK en un sentido, cero en el otro, y
  un test que lo comprueba contra `pg_constraint` en vez de contra el diff.
- **`orders.payment_status` es un ESPEJO**, escrito por `ebim.payment_sync_order`. Y **no propaga la
  excepción**: si el eje del pedido no admite la transición —un pedido B2B pendiente de aprobación—
  el cobro se escribe igual y el comando devuelve `order_synced: false`. Perder el registro de un
  dinero que ya se movió, para salvar la coherencia de una etiqueta, es el intercambio equivocado.
- **Nadie con sesión escribe dinero**: seis de las siete tablas sin GRANT de escritura para
  `authenticated` ni `anon`. La séptima, `payment_methods`, es configuración. Mover dinero es un
  comando `SECURITY DEFINER`, igual que los ejes del pedido en P08.
- **Un único punto de entrada**, `public.payment_apply_outcome`, para la respuesta síncrona, el
  webhook y el operador. Ahí viven las tres reglas caras: el retorno del navegador **no decide**
  (`RETORNO_NO_DECIDE`), un webhook sin firma verificada **no mueve dinero**
  (`FIRMA_NO_VERIFICADA`), y un aviso repetido no duplica nada.
- **Idempotencia en tres cerrojos** independientes —evento del proveedor, llamada al proveedor, cobro
  por referencia— más la máquina de estados como cuarto tope: `captured` es terminal para el intento.
- **PCI por delegación es verificable, no una promesa**: `ebim.jsonb_is_card_safe` es un CHECK con
  Luhn que rechaza un PAN a cualquier profundidad **incluso insertado por `service_role`**, y
  `provider_token_ref` solo admite el formato de un nombre de variable del vault.
- **`timeout` es de primera clase**: no dice que no se cobró, dice que no se sabe. Deja el intento en
  `processing` y el checkout devuelve `PAGO_NO_DISPONIBLE` (503, reintentable), nunca «rechazado».
- **La conciliación cruza por referencia externa dentro del tenant**, que sale del JWT. Ningún banco
  aparece nombrado: el proveedor es una fila de `integration_providers`.

El lado TypeScript vive en `supabase/functions/_shared/payments/`: el contrato canónico
(`provider.ts`, con capacidades explícitas porque no toda pasarela implementa todos los modos), el
conector determinista `sandbox.ts`, la verificación de firma (`signature.ts`, HMAC-SHA256 sobre el
cuerpo **crudo** y comparación en tiempo constante), el gancho de la etapa 8 (`gateway.ts`) y la
ingesta de avisos (`webhook.ts`). **`registry.ts` es el único sitio del repositorio donde se escribe
el código de una pasarela**: añadir una real es un archivo y una línea en ese mapa.

La Edge Function `payments-webhook` no usa `serveJson` —necesita el cuerpo crudo para la firma—, no
acepta `Authorization` (quien llama es un servidor, y la autenticación es la firma) y responde 200
casi siempre, porque a un webhook al que se contesta con error se le reintenta para siempre.

### Promociones, cupones y tarjetas regalo (P10-SaaS)

Nueve tablas más, migraciones `20260828130000`-`130400`. Decisiones completas en
[`adr/010-promotions-engine.md`](adr/010-promotions-engine.md).

```
LA CAMPANA (de la tienda)
  promotions ──── promotion_scopes      SOBRE QUE: todo/producto/variante/categoria/marca.
             │                          is_exclusion RESTA y gana siempre.
             ├─── promotion_audiences   A QUIEN: canal/segmento/cliente/cuenta. SIN filas = a todos.
             ├─── promotion_tiers       las ESCALAS de las campanas por volumen
             └─── coupons               EL CODIGO. code_normalized es GENERATED y el indice va sobre el

LO QUE PASO
  promotion_redemptions  quien la uso, en que pedido y cuanto se llevo
  promotion_events       BITACORA con el estado que la campana tenia en ese momento

EL MEDIO DE PAGO (no es un descuento)
  gift_cards ──── gift_card_transactions   libro mayor: delta con signo y saldo resultante
```

- **Precio y promoción son dos capas, y el orden es una regla**: `precio base → promociones →
  impuesto → total`. `ebim.evaluate_promotions` recibe líneas YA cotizadas por
  `ebim.resolve_prices` y les resta; ni una línea de las cinco tablas de precios de P04 cambia.
- **El alcance va en columnas TIPADAS, no en un `rules jsonb`.** Sin FK, una regla que apunta a una
  categoría borrada se queda viva decidiendo dinero. El coste asumido: añadir un tipo de campaña es
  escribir código, y por eso `promotion_kind` tiene cinco valores y no veinte.
- **Orden TOTAL de evaluación** (`priority desc, created_at, id`) y stacking explícito: exclusiva →
  grupo excluyente → remanente. Que cada campaña se aplique sobre lo que QUEDA es lo que impide que
  dos del 60 % sumen 120 %; no hace falta un CHECK, el modelo no puede expresarlo.
- **Los límites de uso se cuentan con la fila BLOQUEADA.** `evaluate_promotions(p_lock := true)`
  bloquea solo lo que puede agotarse, en orden de `id`; `ebim.redeem_promotions` gasta el uso en la
  MISMA transacción que crea el pedido. Entre contar y gastar no cabe otra compra.
- **La normalización del cupón es un DATO**: `code_normalized` es GENERATED y el índice único está
  sobre ella, así que «Verano 25» y «verano-25» son el mismo cupón.
- **Una sola autoridad fiscal con descuento**: `ebim.promotion_totals` construye la identidad
  `subtotal + impuesto − descuento = total` en las dos modalidades, y con descuento cero devuelve
  EXACTAMENTE los números que devolvía P09. El pipeline la comprueba antes de llamar a una pasarela.
- **La respuesta trae lo que NO se aplicó y por qué** —diez motivos estables—, con una excepción: una
  campaña que exige cupón y no lo trae no se reporta, o la respuesta pública sería el folleto de las
  campañas secretas de la tienda.
- **La tarjeta regalo NO es una promoción**: es un medio de pago con saldo. No toca subtotal,
  impuesto ni `discount_total`; vive en la etapa 8a del pipeline, antes de la pasarela, y a la
  pasarela se le pide el RESTO. El código son 96 bits sin GRANT de lectura para nadie y sale de la
  base una sola vez.
- **El saldo no se escribe, se mueve**: ni un GRANT de escritura, y `ebim.gift_card_move` bloquea,
  comprueba caducidad y saldo, y escribe asiento y saldo juntos. La caducidad se comprueba AL MOVER,
  no por un proceso periódico: no hay cron garantizado.
- `order_items.discount_amount` y `discount_snapshot` —que P08 creó para esto— se llenan por fin: un
  pedido explica su descuento incluso después de borrar la campaña.

### CMS, white-label por tokens y búsqueda del catálogo (P11-SaaS)

Cuatro tablas más, migraciones `20260828140000`-`140400`. Decisiones completas en
[`adr/011-cms-white-label-search.md`](adr/011-cms-white-label-search.md).

```
LA PAGINA (de la tienda)
  content_pages ──── content_blocks      TIPO cerrado (7) + columnas tipadas.
                          │              Vigencia, canal y segmento PROPIOS.
                          └── content_block_items   lo que la coleccion ENSENA,
                                                    con FK compuestas tenant-safe

EL DISCOVERY QUE EL COMERCIO AJUSTA
  search_synonyms        term_normalized es GENERATED y el indice va sobre el

EL BRANDING CRECE (sin tabla nueva)
  store_settings + font_family · ui_radius · ui_density · business_display_name
                 + email_from_name · email_reply_to
                 + custom_domain_status/_verified_at/_token

EL INDICE (sin tabla nueva)
  products.search_vector   tsvector GENERADA, pesos A/B/C, GIN + trigramas
```

- **El contenido enriquecido NO es HTML.** Es un array plano de cuatro nodos
  (`paragraph`, `heading`, `list`, `quote`) con vocabulario CERRADO de claves,
  validado por `ebim.rich_text_is_safe` como CHECK —rechaza también a
  `service_role`— y pintado por `shared/ui/RichText.tsx` mapeando nodo →
  componente. **No hay `dangerouslySetInnerHTML` en `src/`** y un test de
  arquitectura lo mantiene cierto: no hay cadena que escapar mal porque no hay
  cadena que interpretar.
- **El bloque tiene tipo cerrado y columnas tipadas, no un `config jsonb`.**
  Misma decisión que `promotion_scopes` en P10: sin FK, una colección que apunta
  a un producto borrado se queda viva enseñando un hueco. `settings` es un
  vocabulario cerrado de doce claves escalares — el sitio donde, si admitiera un
  objeto, alguien metería una URL de script «porque es solo configuración».
- **La resolución vive en la base y tiene orden TOTAL**: canal específico > canal
  nulo → `priority desc` → `publish_from desc` → `id`. `anon` **no tiene ni un
  GRANT** sobre las tres tablas del CMS: recibe el resultado de
  `store_page_for_slug`, así que un borrador no se filtra por una policy pública
  mal escrita — no hay policy pública.
- **La vista previa llama a la MISMA `ebim.resolve_content` que la vitrina**, con
  el reloj, el canal y el segmento explícitos. Una vista previa calculada aparte
  miente el día que las dos se separan, y ese día no avisa.
- **White-label por TOKENS, y la tipografía es un token de lista cerrada, nunca
  una URL**: una fuente remota elegida por el tenant es contenido remoto en el
  dominio de la vitrina. `content.white_label` gatea lo que hace que la tienda y
  su correo dejen de parecer de la suite (marca blanca, tipografía, identidad de
  correo, dominio propio); el acento, el logo, el favicon, el radio y la densidad
  no se gatean — el lockup de la suite sigue puesto.
- **Retirar el addon apaga su efecto por TODOS los caminos**: `ebim.reset_premium_branding`
  es un trigger sobre `tenant_entitlements`, no una línea dentro de
  `sync_platform_context` (que es lo único que P02 pudo cubrir).
- **La búsqueda vive en Postgres**: `products.search_vector` GENERADA con pesos,
  `pg_trgm` como PLAN B —solo si el texto no encontró nada, y exigiendo que
  TODOS los términos se parezcan—, facetas contadas en el servidor y un `mode`
  (`fts`/`fuzzy`/`browse`/`empty`) que sale del ORIGEN de las filas. Un índice
  externo sería un segundo almacén **sin RLS**.
- **La portada dejó de descargarse entera**: `StoreHomePage` pide una PÁGINA al
  `SearchPort` en vez de `public_products` sin límite, que es la línea que el
  encargo prohíbe cruzar.
- `SearchPort` **por fin existe**, con las dos implementaciones que la regla del
  repositorio exige: la vitrina anónima (solo publicado) y el backoffice con
  sesión (incluye borradores), cuyo primer llamante es el selector de productos
  del editor — la deuda que P10 dejó escrita.

### Fulfillment, logística y devoluciones (P12-SaaS)

Quince tablas más, migraciones `20260828150000`–`20260828150700`. Decisiones completas en
[`adr/012-fulfillment-returns.md`](adr/012-fulfillment-returns.md).

```
LA OFERTA (configuración del comercio; el backoffice la escribe)
  delivery_zones      dónde se entrega: país, regiones y prefijos postales
  delivery_methods    cómo llega: ship · pickup · local_delivery · digital, y su operador
  delivery_rates      cuánto cuesta: base + por línea + por peso + umbral de gratuidad
  pickup_points       dónde se recoge; si cuelga de un almacén, de ahí sale la mercancía
  delivery_windows    franjas SEMANALES con aforo y hora de corte

EL DESPACHO (se lee; se mueve con comandos)
  fulfillments        la PROMESA de entrega de una PARTE del pedido
  fulfillment_items   qué unidades entran en ella — esta tabla ES el despacho parcial
  shipments           el bulto que movió un operador, con su guía y su coste real
  shipment_items      qué va dentro del bulto
  tracking_events     el recorrido, normalizado y append-only

LA DEVOLUCIÓN
  return_reasons      el vocabulario del comercio: qué exige foto y qué repone stock
  return_requests     la solicitud, con su RMA y su ciclo
  return_items        qué unidades vuelven, en qué estado llegaron y si se reponen
  return_events       la bitácora, append-only
  return_evidence     la ruta en un bucket PRIVADO por tenant
```

- **Un pedido no es un fulfillment.** Tres FK del despacho al pedido y **cero** del pedido al
  despacho — hay un test contra el catálogo de Postgres, no contra el diff. Es la misma forma que
  P09 dio a los cobros y por la misma razón: conectar un operador nuevo no puede ser una migración
  sobre `orders`. `orders.fulfillment_status` es un ESPEJO derivado de las cantidades entregadas
  (`ebim.fulfillment_sync_order`), y solo avanza.
- **La única columna del pedido que cambia es el dinero**: `shipping_total`, que existía desde P02 y
  valía siempre cero. Llenarlo obligó a reescribir `create_order` entera, y la copia la hace un
  script con anclas exactas (`scripts/build-p12-create-order.mjs`).
- **El reparto de ese importe entre entregas es estructural**: `coste = shipping_total − lo ya
  asignado a entregas no anuladas`. Con una sola da el total, con la segunda da cero, y partir un
  despacho no cobra transporte de más.
- **`delivery_rates` no tiene GRANT de SELECT para `anon`**, y el subtotal con el que se evalúa el
  umbral de envío gratis **tampoco viaja en la pregunta**: `delivery_options_for_slug` lo recalcula
  con `ebim.build_quote`, el mismo motor que cotiza el carrito.
- **Una sola autoridad de cotización**, `ebim.delivery_options`, para la vitrina, el checkout y el
  backoffice — la misma forma que `ebim.resolve_prices` desde P04.
- **La zona gana por especificidad**: prefijo postal más largo, luego región declarada, luego
  `priority`. Sin eso, una zona «país» creada después taparía a «Lima 15001».
- **`null` de peso no es cero**: una tarifa por kilo sobre un catálogo sin pesos NO se aplica, y el
  motivo se distingue (`PESO_NO_DECLARADO` lo arregla el catálogo; `SIN_TARIFA`, la configuración).
- **Recojo, reparto y envío son estrategias del MISMO checkout**, no checkouts distintos. Lo que
  cambia por estrategia lo imponen CHECKs: solo `ship` admite transportista, `pickup` exige punto, y
  un recojo congela la dirección del PUNTO y no la del comprador.
- **El punto de recojo manda sobre la regla de abastecimiento** (`ebim.select_warehouse`): que una
  regla eligiera otro almacén produce el caso peor del comercio físico.
- **El seguimiento se normaliza a `tracking_status`** y la jerga del operador se guarda al lado, sin
  traducir, en `provider_status`. La ingesta es idempotente por índice único
  `(shipment_id, external_event_id)`, un aviso sin firma verificada se registra y **no mueve nada**,
  y un aviso desordenado se guarda sin fallar — la tabla de transiciones es una función precisamente
  porque tiene dos lectores, el que prohíbe y el que pregunta.
- **Una devolución no es un pedido negativo**: tiene ciclo propio, motivo por línea y
  `received_quantity` distinta de `quantity`, porque el reembolso se calcula sobre lo que llegó.
- **La integración financiera es un HECHO canónico** (`return.completed` en `domain_events`), no una
  nota de crédito de ningún ERP. Y completar una devolución **no abona nada**: eso es un acto
  autorizado del dominio de pagos, con su pantalla y su rol.
- **La reposición pasa por el motor de P06** con referencia externa en el asiento, así que
  inspeccionar dos veces no repone el doble; y lo que no llegó vendible no se repone, lo pida quien
  lo pida (`return_items_restock_shape`).
- **`products.shipping_weight`** (y el de variante) nacen aquí: sin peso no hay tarifa por kilo, y
  esa es la mitad de las tarifas reales de esta región.

### Analítica, auditoría y observabilidad (P13-SaaS)

Tres tablas más, migraciones `20260828160000`–`20260828160500`. Decisiones completas en
[`adr/013-analytics-audit-observability.md`](adr/013-analytics-audit-observability.md).

```
EL HILO (ninguna tabla nueva: una COLUMNA en las ocho del camino de una compra)
  checkout_intents · orders · payment_intents · payment_events · fulfillments
  domain_events · integration_outbox · integration_inbox
        └── correlation_id  default ebim.correlation_id()

LO QUE PASA (comercio)
  analytics_events        los nueve hechos canónicos, append-only y SIN PII

QUIÉN LO HIZO (transversal)
  audit_log               actor, acción, entidad, momento, tenant e hilo. Sin FK

QUÉ SE ROMPIÓ (operación)
  ops_events ──── ops_incident_overview   edad y repeticiones ya calculadas
```

- **El `correlation_id` es un DEFAULT de columna, no un parámetro.** Es lo que permite coser una
  petición entera sin tocar `create_order` ni ninguna de las otras once funciones de dominio.
  `ebim.correlation_id()` lo lee de `set_config` o de la cabecera `x-correlation-id` que PostgREST
  publica en `request.headers`; **no lo inventa**: sin hilo, la columna queda en NULL.
- **Seis de los nueve hechos los emite un TRIGGER del servidor** —checkout iniciado y completado,
  pedido creado y entregado, carrito abandonado y campaña canjeada—; la vitrina solo puede declarar
  `product_view`, `search` y `add_to_cart`, y `public.track_events_for_slug` rechaza el resto con
  `ANALYTICS_EVENTO_NO_PERMITIDO`. Un embudo que el navegador puede falsear no sirve para decidir.
- **La analítica no puede guardar a una persona**: sin columna de correo, nombre ni cliente; lo que
  identifica una visita es el **sha256** de un identificador opaco. `props` y `search_term` pasan por
  `ebim.redact_pii` en la puerta Y por un CHECK en la tabla.
- **Toda razón devuelve NULL sin denominador**, nunca `0 %`: conversión (sobre `checkout_intents`),
  abandono (sobre `carts` con desenlace) y ticket promedio. Misma regla que la moneda mezclada de
  `dashboard_kpis` desde P03.
- **La auditoría son triggers sobre once tablas sensibles**, no llamadas dentro de cada comando: un
  trigger registra la escritura venga de donde venga. El actor sale del JWT y `ebim.audit` no tiene
  parámetro de actor. Quedan fuera —y por escrito— los dominios que ya llevan su propia bitácora.
- **`ops_events` es una proyección**, no una segunda verdad: la fila que manda sigue siendo la del
  dominio. Existe para que los cuatro fallos tengan la MISMA forma y para dar sitio a las dos señales
  que solo ocurren en el borde —operación lenta y webhook rechazado—.
- **`ops_health` no acepta tenant**: lo deriva del JWT, así que no hay parámetro que validar. La
  lectura exige `owner`/`admin`, igual que `audit_log` y `ops_events`.
- **`public.trace_by_correlation`** une once tablas y siete dominios en una consulta, filtrando cada
  rama por `ebim.can_access`. Es la Definition of Done de la fase escrita como función.

### API empresarial, webhooks e Integration Monitor (P14-SaaS)

Siete tablas más, migraciones `20260828170000`–`20260828170600`. Decisiones completas en
[`adr/014-enterprise-api-webhooks-monitor.md`](adr/014-enterprise-api-webhooks-monitor.md).

```
EL TRANSPORTE NO CAMBIA: gana una DIMENSIÓN
  integration_outbox  + target      a QUÉ destino concreto va el mensaje
  integration_circuit + target      el disyuntor pasa a ser POR destino
  integration_messages + status_code + correlation_id + target

LO QUE SALE HACIA UN SISTEMA SUSCRITO (se contrata: `integrations.enterprise`)
  webhook_endpoints ──── webhook_subscriptions   qué eventos quiere cada destino
                    └─── webhook_deliveries      la IDENTIDAD de lo entregado y
                                                 la cadena de reproducciones

LO QUE ENTRA DESDE EL SISTEMA DE UN SOCIO
  api_clients ──── api_access_tokens   el grant client_credentials
              ├─── api_requests        contador con ventana Y pulso del socio
              └─── api_idempotency     la misma clave dos veces es UNA operación

LO QUE SE MIRA (NO se vende: es observabilidad, área de plataforma)
  integration_monitor · webhook_monitor · integration_health
  integration_message_detail (saneado y auditado) · integration_retry · webhook_replay
```

- **Los webhooks NO son una segunda cola.** Son `integration_outbox` con
  `provider_code = 'webhook'` y un `target` por endpoint, así que heredan idempotencia, backoff con
  jitter, cola muerta, disyuntor, bitácora de intentos y monitor sin escribir ninguno otra vez. La
  columna `target` existe por una razón concreta: **el disyuntor tiene que ser por destino**, o un
  endpoint roto cortaría la entrega a los sanos del mismo tenant.
- **La identidad del evento es `domain_events.id`**, y la reproducción la conserva. Como
  `domain_events` ya es idempotente por `dedupe_key` (P07), la deduplicación del receptor funciona
  por construcción y no por disciplina.
- **El fan-out NUNCA levanta.** Cuelga de un trigger sobre `domain_events`, que se escribe dentro de
  la transacción del pedido: una excepción ahí tumbaría la venta. Lo que falla queda como incidente
  (`WEBHOOK_NO_ENCOLADO` en `ops_events`).
- **Solo `https` y solo direcciones públicas**, por CHECK: bucle local, enlace-local y los tres
  rangos privados de RFC 1918 se rechazan en la base. Es defensa contra SSRF, no cosmética — el
  trabajador entrega con credenciales de servidor y desde dentro de la red del proyecto.
- **La API de socio no es PostgREST.** Versión en la RUTA (`/v1/…`), recursos en vez de tablas,
  importes como cadena decimal, el pedido por su NÚMERO, el producto por su SKU, paginación por
  cursor y errores con código estable. Un socio que integrara contra el esquema quedaría atado a
  nuestros nombres de columna.
- **Ninguna función `api_*` acepta `organization_id` ni `company_id`**: derivan el tenant de la FILA
  de la credencial (`ebim.api_authorize`). No se valida el parámetro: no existe el parámetro. Hay un
  test que lo comprueba leyendo `pg_proc.proargnames`.
- **Los scopes son las operaciones canónicas que ya existían** (`order.create`, `stock.read`…), las
  mismas de `integration_providers.capabilities`. Un vocabulario, tres tiempos de ejecución
  —`ebim.api_scope_catalog()`, `src/domain/api.ts`, `_shared/api/contract.ts`— y un test que los
  compara contra Postgres real.
- **El secreto se guarda en sha256 y se devuelve UNA vez.** El GRANT es por columna en los DOS
  sentidos: `secret_hash` no se puede leer ni escribir desde el backoffice —escribirlo sería
  elegirlo—. `api_authenticate` recibe el HASH del token, no el token, para que no acabe en el
  registro de sentencias de Postgres.
- **El secreto de firma de un webhook no vive en la base**: allí está `secret_ref`, el nombre de la
  variable del vault. Mismo patrón que `tenant_integrations.secret_ref` desde P12.
- **La firma lleva un instante dentro** (`t=…,v1=…` sobre `<instante>.<cuerpo crudo>`). Sin él, una
  firma válida lo es para siempre y una captura vieja se puede reproducir contra el cliente.
- **El monitor NO se vende.** `integration_monitor`, `webhook_monitor` e `integration_health` están
  fuera del addon —igual que `/app/operations` desde P13—; lo vendible es PUBLICAR. Quien decide
  quién entra es el ROL, y lo decide la base.
- **El detalle de un mensaje pasa por DOBLE redacción** (tarjeta de P09 y datos personales de P13),
  sale sin la cadena de consulta de la URL y **queda registrado en `audit_log`**: mirarlo es un acto
  con autor. El CUERPO de la respuesta del destino no se guarda nunca.
- **La cola no se reescribe desde el navegador.** Reintentar y reproducir son comandos con rol,
  motivo obligatorio y firma; el reintento CONSERVA los intentos gastados —son la prueba— y da uno
  más por encima del techo.

### Capacidades y entitlements (P02-SaaS)

Cuatro tablas más, migración `20260827160000`. Decisiones completas en
[`adr/002-capabilities-entitlements.md`](adr/002-capabilities-entitlements.md).

```
app_capabilities          registro TÉCNICO del producto (global, sin tenant, como integration_providers)
tenant_platform_context   cache de la respuesta del hub (§5): app_active, plan, origen, sincronización
tenant_entitlements       cache de los addons ACTIVOS por sociedad (§6). Solo lectura para el backoffice
tenant_feature_flags      interruptores técnicos del tenant. Solo restan; nunca conceden
```

- **`ebim.has_capability(org, company, cap)`** = `can_access` **y** `company_is_entitled`. Es la
  autoridad: se usa dentro de las policies, no solo en la UI.
- **`public.effective_capabilities(company)`** es lo que lee la app; la sociedad es alcance y el JWT
  sigue decidiendo (`can_access` antes de devolver nada, y `SIN_PERMISO` si no).
- **`public.sync_platform_context(...)`** es la única puerta de escritura: `service_role`, con
  `REVOKE EXECUTE` a `anon`/`authenticated`/`public`. Reemplaza el conjunto entero, así que un addon
  que el hub deja de devolver se apaga.
- Enforcement real hoy: `store_settings.white_label` exige `content.white_label` (addon premium del
  contrato §4.3) y escribir `tenant_integrations` exige `integrations.enterprise`.

## Operaciones de servidor y Edge Functions (P02)

| Función | Autoriza | Cliente | Por qué |
|---|---|---|---|
| `bootstrap-tenant` | clave en cabecera `x-ebim-provisioning-key` | `service_role` | crea el tenant: no hay todavía un token del que derivarlo |
| `checkout` | ninguna para el pipeline (comprador anónimo); el JWT del llamante **solo** para resolver su cuenta B2B | `service_role` **y** clave publicable + `Authorization` | `my_business_accounts()` no acepta argumentos: sin la sesión del llamante esa pregunta no tiene respuesta |
| `create-order` | ninguna (comprador anónimo) | `service_role` | el pedido no puede insertarse desde el navegador; sigue viva para los clientes de P02-P06 |
| `catalog-product` | JWT del usuario | clave publicable + `Authorization` | **decide la RLS**, no la función |
| `update-order-status` | JWT del usuario | clave publicable + `Authorization` | idem, más el trigger de transiciones |
| `platform-context` | JWT del usuario **o** clave de aprovisionamiento | `service_role` | es la única que tiene la credencial del hub; el navegador nunca habla con el hub |

Desde P04-SaaS hay además tres funciones de base con autorización propia, y no una con bandera
porque cada una responde a un llamante distinto: `public.price_quote_for_slug` (comprador **anónimo**;
resuelve tienda por slug y canal público por defecto), `public.price_quote` (backoffice; comprueba
membresía contra la tienda antes de mirar un precio) y `public.price_list_conflicts` (invoker: la RLS
decide qué tiendas ve quien pregunta).

Desde P06-SaaS hay nueve más, agrupadas por llamante y no por tema, porque cada grupo trae su
propia autorización: del **backoffice con sesión** (rol + capacidad, tenant derivado de la tienda o
del almacén) `reserve_inventory`, `release_inventory_reservation`, `commit_inventory_reservation`,
`adjust_inventory`, `set_inventory_policy`, `seed_inventory_from_catalog` e
`inventory_availability`; del **servidor** (`service_role`, revocadas a `authenticated`)
`reserve_inventory_for_slug`, `release_inventory_by_token`, `expire_inventory_reservations` y
`sync_inventory_level`; y del **comprador anónimo**, `availability_for_slug`, que devuelve el
semáforo por cantidad y nunca la cifra.

Desde P05-SaaS hay tres más, y la primera es la que sostiene la regla del vínculo:
`public.my_business_accounts()` (definer, **sin parámetros**: el usuario B2B no es miembro del tenant
y su cuenta la resuelve el servidor), `public.purchase_approval` (definer, con su autorización
dentro: o vínculo con la cuenta, o membresía del tenant) y `public.customer_orders` /
`public.customer_deletion_usage` (invoker: la RLS decide qué ve quien pregunta).

Desde P10-SaaS hay dos puertas públicas más y cinco comandos, agrupados por llamante porque cada
grupo trae su propia autorización: del **comprador anónimo**, `promotion_quote_for_slug` (la
cotización con descuento y cupones, hermana de `price_quote_for_slug`) y `gift_card_balance_for_slug`
(devuelve saldo, nunca código, y no distingue «no existe» de «es de otra tienda»); del **backoffice
con sesión** (rol `owner`/`admin` y capacidad `promotions`, comprobados dentro), `promotion_simulate`,
`gift_card_issue`, `gift_card_adjust` y `gift_card_cancel`; y del **servidor** (`service_role`,
revocadas a `authenticated`) `gift_card_redeem`, `gift_card_release` y `expire_gift_cards` — si el
navegador pudiera canjear saldo, el importe a descontar lo decidiría el navegador.

Desde P08-SaaS hay tres funciones más y un permiso nuevo. `public.order_transition` (el COMANDO de los
tres ejes: `authenticated`, con la autorización dentro y el tenant sacado de la fila del pedido),
`public.order_approval_decide` (decide una compra B2B pendiente; autoriza al aprobador de la cuenta
—vínculo resuelto por el servidor— o al personal de pedidos) y `public.my_business_orders()`
(**sin argumentos**, la puerta del aprobador B2B, que no es miembro del tenant). El permiso es
`orders.export`, en las dos copias de la matriz de roles: exportar no es «ver el listado en un
archivo», es una extracción masiva de datos de contacto y fiscales de todos los compradores, y un
`viewer` no la tiene.

`supabase/functions/_shared/` (auth, CORS, errores, validación, reglas de pedido, roles) es TypeScript puro:
lo compila el `tsc` del repo y lo cubren los tests. `_runtime/clients.ts` queda aparte porque importa el SDK
con especificador `npm:` y solo existe dentro de Deno.

## Seguridad

- `service_role` solo dentro de Edge Functions; el bundle del front lleva únicamente URL + clave publicable.
- Tenant siempre derivado del JWT en el servidor; el storefront anónimo se resuelve por host contra tabla de
  dominios, nunca por header o parámetro declarado por el cliente.
- `SECURITY DEFINER` únicamente con autorización explícita dentro de la función y `REVOKE EXECUTE` a
  `anon`/`authenticated`/`public`.
- `audit_log` no legible ni borrable por `anon`; se escribe solo vía función validada.
- Rol operador/super-admin no asignable desde UI y con guard 403 en servidor (`_shared/roles.ts`).

## Frontend

Estructura real (organización por features; storefront y backoffice siguen siendo
áreas lógicamente separadas — rutas, layouts y guards distintos, design system compartido):

```
src/
  domain/               PURO: fronteras, puertos, errores, dinero. Sin React, MUI ni Supabase (P01-SaaS)
    boundaries.ts         los 12 dominios + 7 areas de plataforma, con su estado real (P13 anade `observability`)
    capabilities.ts       los 16 modulos del producto y la resolucion efectiva (P02-SaaS)
    flags.ts              interruptores tecnicos: solo restan, nunca conceden
    errors.ts             AppError con discriminante `kind`
    money.ts              importe = decimal en TEXTO, nunca number
    ports/                PricingPort, InventoryPort, PaymentProvider, ErpProvider, ...
  app/                  router, providers, ErrorBoundary, queryClient
  theme/                tokens (CSS vars + escalas), createEbimTheme, apariencia por usuario
  shared/               ui kit (EbimMark, SectionTabs, SearchField, estados, SkipToContentLink),
                        i18n ES/EN, lib (env, supabase, db-schema, format, search, slug)
    seo/                  (P15-SaaS) `meta.ts` PURO decide qué se indexa, con qué identidad
                          y con qué canonical; `useDocumentMeta` lo escribe en el `<head>` y
                          —esto es lo que importa en una SPA— lo RETIRA al desmontar
    i18n/                 `messages.es.ts` viaja siempre (es el suelo del fallback);
                          `messages.en.ts` entra por `import()` (P15-SaaS: −30 kB gzip de
                          la entrada). `messages.all.ts` es SOLO para tests de paridad y
                          hay un test que comprueba que nadie más lo importa
  features/auth/        login (anatomía de suite §4.5), sesión, guard RequireSession
  features/tenant/      contexto de tenant del backoffice, derivado del JWT
  features/capabilities/ que modulos tiene la sociedad: provider, gate, diagnostico
  features/admin/       AdminLayout, dashboard, configuración
  features/catalog/     productos del backoffice
    pim/                  PIM (P03-SaaS): marcas, familias, atributos, unidades,
                          variantes, UoM de producto, componentes de kit y relaciones
  features/pricing/     motor de precios (P04-SaaS): listas, renglones, asignaciones,
                        segmentos, simulador, diagnostico, importacion CSV y el
                        adaptador `serverPricing` que implementa `PricingPort`
  features/customers/   clientes y cuentas B2B (P05-SaaS): ficha, contactos,
                        direcciones, identificadores externos, cuentas de empresa
                        con usuarios, sucursales y reglas de autorizacion
  features/inventory/   almacenes, existencias por almacen, libro mayor, reservas y
                        alertas (P06-SaaS), mas los dos adaptadores de `InventoryPort`
  features/orders/      pedidos del backoffice (P08-SaaS: listado paginado en servidor,
                        cuatro ejes de estado con comando de transicion, linea de tiempo,
                        notas internas, etiquetas, referencias externas y aprobacion B2B)
  features/payments/    cobros, medios de pago y conciliacion (P09-SaaS). Escribe UNA
                        tabla —los medios, que son configuracion—; devolver y cuadrar
                        son comandos. Gateada por la capacidad `payments`
  features/promotions/  campanas, cupones, tarjetas regalo, simulador y bitacora
                        (P10-SaaS). Escribe CINCO tablas —campana, alcance, audiencia,
                        escala y cupon, que son configuracion comercial—; el contador
                        de usos y el saldo de una tarjeta son comandos. Gateada por la
                        capacidad `promotions`
  features/fulfillment/ entregas y devoluciones (P12-SaaS): cola de preparación con su
                        detalle, línea de tiempo y acciones autorizadas; cola de
                        devoluciones con decisión, recepción, inspección y cierre; y la
                        red de entrega —métodos, zonas y tarifas—. Escribe SEIS tablas,
                        todas de configuración; mover una entrega es un comando.
                        Gateada por la capacidad `fulfillment`
  features/content/     el editor de la vitrina (P11-SaaS): páginas, bloques con
                        vigencia/canal/segmento, colecciones con buscador de
                        producto, vista previa con reloj y sinónimos de búsqueda.
                        Gateada por la capacidad `content.cms`
  features/analytics/   el cuadro de mando (P13-SaaS): ventas, pedidos, ticket, conversión,
                        abandono, productos y canal —todo de `orders`, baseline— y el embudo
                        con los términos de búsqueda, gateados por `analytics.advanced` DESDE
                        LA BASE. No escribe ninguna tabla: la analítica se lee
  features/ops/         la operación (P13-SaaS): salud del tenant, incidentes con su edad ya
                        calculada, RASTRO por correlation id y auditoría. SIN capacidad —igual
                        que Ajustes y Diagnóstico— y con permiso de rol. Lo único que escribe
                        es atender un incidente, y no es un `update`: es un comando
  features/integrations/ el monitor (P14-SaaS): salud de conectores, cola con intentos y
                        disyuntor, webhooks con sus entregas y reproducción, y credenciales de
                        la API de socio. SIN capacidad —igual que Operación— y con permiso de
                        rol; lo vendible es PUBLICAR y ese gate vive en la BASE
  features/storefront/  vitrina pública: resolución por slug, catálogo, ficha, carrito/checkout
                        (P07-SaaS: carrito de servidor con fusión al iniciar sesión y
                         checkout idempotente con etapas)
                        + StoreAccountPage: área de cuenta del comprador B2B (P05-SaaS),
                          resuelta por `my_business_accounts()` y no por la URL
                        + analytics.ts (P13-SaaS): los TRES hechos que solo existen en la
                          pantalla —vista de ficha, búsqueda con su número de resultados y
                          añadido al carrito—, con un identificador de visita opaco en
                          `sessionStorage` que el servidor hashea antes de guardar. Dispara y
                          olvida: si la analítica falla, la tienda no se entera
                        + delivery.ts / DeliveryPicker (P12-SaaS): envío, recojo, reparto
                          y entrega digital en la MISMA lista del MISMO checkout; el
                          importe llega resuelto del servidor y aquí no se calcula nada
                        + seo.ts (P15-SaaS): los metadatos de cada pantalla de la vitrina,
                          compuestos sobre el `PublicStore` YA RESUELTO por slug. La marca,
                          el logo, el contacto y la moneda que ve un buscador son los del
                          TENANT. Carrito, checkout, cuenta y seguimiento: `noindex`
  architecture.test.ts  las reglas de frontera, comprobadas sobre el codigo real
supabase/
  migrations/  SQL versionado (tabla nueva = tabla + RLS + policies en la misma migración)
  functions/   Edge Functions (Deno) + _shared/
               _shared/observability: el hilo, la redacción, el logger con SINKS y el
               puente con `ops_events`. Sin un solo vendor dentro: cambiar de
               proveedor es registrar un sink más
               _shared/api (P14-SaaS): contrato, TABLA DE RUTAS, OpenAPI generado de
               esa misma tabla y `gateway.ts` —puro, con puertos— donde vive el
               ORDEN de las comprobaciones, que es una decisión de seguridad
               _shared/webhooks (P14-SaaS): la firma con instante dentro (verificar
               incluido, para poder probar la promesa) y el despachador puro
               _shared/seo (P15-SaaS): sitemap y robots POR TIENDA, TypeScript puro. El
               borde (`storefront-seo`) solo cablea, y lee con el cliente ANÓNIMO: lo
               máximo que puede publicar es lo que ya publica la vitrina
  tests/       PGlite: RLS, invariantes de esquema y contrato de integraciones
```

### Fronteras de dominio y puertos (P01-SaaS)

Decisiones completas en [`adr/001-domain-boundaries.md`](adr/001-domain-boundaries.md). En resumen:

- **Doce dominios de negocio** —catalog, pricing, customers, inventory, checkout, orders, payments,
  promotions, content, fulfillment, analytics, integrations (esta última pasa a `implemented` en
  P14-SaaS: hasta entonces existía el transporte y no existía forma de que un tercero lo usara)— y
  **siete áreas de plataforma** —identity, tenancy, entitlements, provisioning, configuration,
  observability, shell—, declarados en
  `src/domain/boundaries.ts` con su estado real (`implemented` / `partial` / `declared`) y su ruta
  en `src/`. (`entitlements` la añade P02-SaaS: no es un módulo vendible, es la que decide qué
  módulos hay.)
- **Un puerto existe solo si hay una segunda implementación ya declarada**: una fila de
  `integration_providers` con esa operación, o dos llamantes concretos hoy. Por eso hay
  `PricingPort`, `InventoryPort`, `PaymentProvider`, `FulfillmentProvider`, `NotificationProvider`,
  `ErpProvider`, `InvoicingProvider`, —desde P11-SaaS, cuando aparecieron sus dos implementaciones—
  `SearchPort`, y —desde P14-SaaS— el sobre publicado de los webhooks
  (`WebhookEnvelope`, cuya «segunda implementación» es literalmente cada sistema suscrito, y que
  `supabase/tests/webhooks.test.ts` comprueba contra lo que de verdad sale por la cola). `InventoryPort` es el primero con DOS implementaciones vivas (P06-SaaS): backoffice
  y vitrina, que no son dos capas de lo mismo sino dos actores con dos autorizaciones y dos
  respuestas distintas. `FulfillmentProvider` deja de ser solo un contrato en P12-SaaS: su versión
  de servidor (`_shared/fulfillment/provider.ts`) tiene registro, conector de pruebas y una Edge
  Function que lo usa.
- **Ningún puerto recibe el tenant como parámetro**: `organization_id`/`company_id` salen del JWT
  en el servidor. Un parámetro que se puede pasar se puede pasar mal.
- **El vocabulario canónico es el de la base.** `src/domain/ports/operations.ts` replica el enum
  `integration_kind` y las `capabilities` sembradas, y
  `supabase/tests/integration-contract.test.ts` compara las dos copias contra Postgres real.
- **Ningún nombre de fabricante, banco, transportista o cliente en `src/`**, ni en código ni en
  comentarios. Los proveedores concretos son filas de `integration_providers`.
- **Errores con discriminante.** `AppError.kind` —`config`, `unauthorized`, `forbidden`,
  `not_found`, `conflict`, `invalid`, `rate_limited`, `unavailable`, `unknown`— en vez de comparar
  textos. Lo desconocido nunca es reintentable. Solo tres módulos leen el texto de un error:
  `shared/lib/appError.ts`, `shared/lib/edgeError.ts` y `features/auth/authApi.ts`.
- **Nombres de persistencia en un solo sitio**: `shared/lib/db-schema.ts`, tipado con `satisfies`
  contra `database.types.ts` (generado por `npm run db:types` → `scripts/gen-db-types.mjs`).

- **Tres ejes de autorización, tres nombres** (P02-SaaS): `Permission` es lo que puede un ROL
  (`shared/lib/roles.ts`, `ebim.has_role`); `Capability` es el módulo que la sociedad CONTRATÓ
  (`src/domain/capabilities.ts`, `ebim.has_capability`); `FeatureFlags` son interruptores técnicos
  del tenant que solo pueden restar. Se componen: hacen falta los tres.
- **Ningún uuid literal ni nombre de plan comercial en código de producción.** Un
  `if (org === '3f2a…')` es la versión del anti-patrón que sobrevive a la regla de los nombres
  propios, y es igual de mortal.

Todas estas reglas las comprueba `src/architecture.test.ts`: no son convenciones, son tests.

- Theming por tokens; el acento proviene del branding del tenant (`accent_color`), nunca hardcodeado.
- Light + dark, densidad configurable, WCAG AA, mobile-first real.
- Pantallas largas → tabs centrados con deep-link `#hash`; listados → un buscador general.

### Rendimiento, accesibilidad y SEO de la vitrina (P15-SaaS)

**Ni una migración**: es fase de entrega, no de dominio. Decisiones completas en
[`adr/015-storefront-performance-seo.md`](adr/015-storefront-performance-seo.md); el método de
medida y los techos vigentes, en [`performance-budget.md`](performance-budget.md).

```
LO QUE VE UN BUSCADOR
  shared/seo/meta.ts        PURO: título, canonical, robots, Open Graph, JSON-LD
        │                   (`Organization`, `Product` con su oferta, `BreadcrumbList`)
        ▼
  features/storefront/seo.ts   compone sobre el PublicStore ya resuelto por SLUG
        │                      → portada y ficha `index`; carrito/checkout/cuenta/
        │                        seguimiento `noindex`; lo que no resuelve, `noindex`
        ▼
  shared/seo/useDocumentMeta   escribe el <head> y lo RETIRA al desmontar
                               (una SPA no recarga: lo que no se limpia miente)

  public/robots.txt                        el despliegue entero
  functions/storefront-seo  ──► anon ──►   /s/:slug/sitemap.xml  ·  /s/:slug/robots.txt
                                           (POR TIENDA, generado, NUNCA service_role)
```

Tres señales, la misma lista de cuatro rutas privadas —`noindex` en la aplicación, `Disallow` en
`robots.txt`, ausentes del sitemap— y un test por cada una. `robots.txt` pide que no se RASTREE:
no impide que se indexe una URL enlazada desde fuera, y por eso las tres.

**Presupuesto medible** (`npm run build && npm run bundle:report`, sale con código 1 si se pasa):
la entrada compartida baja de **283,38 kB gzip** (P14) a **251,8 kB gzip**, y el recorrido completo
de la portada queda en 334,6 kB contra un techo de 400. Lo consiguen cuatro cosas: el diccionario
del idioma que no se lee sale del bundle de entrada (`import()`, −30,09 kB gzip), el proveedor se
reparte en chunks estables, «ver más» pagina de verdad contra el servidor —antes la tercera página
descargaba 72 productos para enseñar 24— y `fetchPublicProducts` lleva el techo SIEMPRE.

**Accesibilidad**: enlace de salto al contenido con destino enfocable (`tabIndex={-1}`), un solo
`<h1>` por página —cuando el hero del CMS sustituye al de `store_settings` es él quien lo lleva—,
buscador como landmark `role="search"` y `prefers-reduced-motion` aplicado a TODO (`0.01ms`, no `0`:
con duración cero muchos navegadores no disparan `transitionend` y los componentes que esperan ese
evento para desmontarse se quedan colgados).

**Lo que NO se declara**: ninguna puntuación de Lighthouse ni Web Vitals de campo. Exigen un
navegador real contra un despliegue real, y esta fase no despliega (contrato §11).

### Línea base de seguridad (P16-SaaS)

Estado completo, con evidencia y con lo que queda fuera del repositorio, en
[`SECURITY_BASELINE.md`](SECURITY_BASELINE.md); decisiones en
[`adr/016-security-baseline.md`](adr/016-security-baseline.md).

**Tres migraciones**, ninguna de dominio nuevo:

| Migración | Qué cierra |
|---|---|
| `20260830100000_href_safety_hardening` | `ebim.is_safe_href` deja de admitir la barra invertida y los caracteres de control — `/\evil.com` pasaba el CHECK como ruta interna y el navegador la resolvía a OTRO dominio. Incluye la remediación de lo ya guardado: redefinir la función no revalida las filas existentes |
| `20260830100100_tenant_safe_foreign_keys` | Las nueve claves ajenas que apuntaban a una tabla con tenant sin llevar el tenant dentro pasan a ser compuestas. El aislamiento deja de sostenerse por revisión de código y pasa a sostenerse por construcción |
| `20260830100200_public_rate_limits` | `public_rate_events` + `ebim.public_rate_{limit,exceeded,record}`: techo por tienda para la analítica anónima (ESCRIBE) y para el sondeo de cupones (es un ORÁCULO). Las dos **degradan** en vez de negar |

**Fuera de la base:**

```
BUILD                     src/shared/security/headers.ts   (puro, comprobable sin navegador)
                                   │
        vite.config.ts · plugin `ebim-security-headers`
                                   ├──► dist/_headers          8 cabeceras, con frame-ancestors
                                   └──► <meta http-equiv CSP>  detrás de <meta charset>,
                                                               delante del primer script

BORDE   functions/_shared/securityHeaders.ts  ──► TODAS las respuestas de las 11 funciones,
                                                  incluidas la de error y la del preflight

DOMINIO src/domain/href.ts   la ÚNICA definición de «enlace publicable» del cliente.
                             La usan content.ts, el borde del storefront, RichText,
                             ContentBlocks, OrderDrawer y LoginPage

GATE    scripts/secret-scan.mjs  ──► `npm run scan:secrets`: repo versionado + dist/,
                                     sale con código 1. Busca credenciales con VALOR,
                                     no la palabra `service_role`
```

**La superficie anónima es una lista cerrada de 18 funciones**, cada una clasificada por lo que la
protege (catálogo publicado · secreto de 96-256 bits · techo de tasa · recogida acotada). Una
decimonovena pone la suite roja (`supabase/tests/security-baseline.test.ts`).

La cuarta clase, `recogido`, la trajo el segundo hallazgo de la fase: `cart_open` **crea** la fila
del invitado que llega sin token, y estaba clasificada como protegida por «un secreto de 256 bits»,
que solo es cierto para quien **ya lo tiene**. Como además `CartProvider` envolvía la vitrina
entera, era una fila de `carts` por visita anónima que nadie recogía nunca. Se corrigió en las dos
capas —el cliente solo reconcilia si hay sesión, token o líneas; la base recoge lo que quedó vacío,
acotado por llamada y sin depender de un planificador— y **sin poner techo**: negar la creación de
un carrito convierte un ataque contra el almacenamiento en un ataque contra las ventas.
`SECURITY_BASELINE.md` §3.7.

**Lo que NO se declara cubierto**: cabeceras servidas por el hosting, WAF y límite por IP, copias y
restauración, MFA/SSO (bloqueado: `ecommerce` no está dado de alta en el hub) y CI. Los seis van con
responsable, dependencia y procedimiento verificable en `SECURITY_BASELINE.md` §9.

## Integración con la suite

- Registro de `ecommerce` en el hub (`apps`, `workspace_apps`): **pendiente del operador**
  (`SAAS_ROADMAP` §5.1). La lectura de addons por sociedad ya está construida (P02-SaaS) y responde
  `HUB_NO_CONFIGURADO` mientras tanto; el tenant se queda con lo baseline.
- Vitrina cruzada (§6.1): momento contextual hacia eExpense/eSupplier cuando el tenant no las tiene contratadas.
- Coordinación por el buzón `coordinacion\` en Drive; cambios a interfaces compartidas = propuesta al contrato.
