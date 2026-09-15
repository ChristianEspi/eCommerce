/**
 * Mapa de fronteras de dominio de eCommerce (P01-SaaS).
 *
 * Esto NO es documentación decorativa: `src/architecture.test.ts` lo usa para
 * exigir que todo archivo de `src/features` pertenezca a una frontera
 * declarada. Una carpeta nueva sin dominio declarado rompe la suite, que es la
 * única forma conocida de que un mapa de arquitectura siga siendo cierto un año
 * después de escribirlo.
 *
 * `state` dice la verdad sobre cada frontera hoy, no la intención:
 *  - `implemented` — hay código de producto y está en uso.
 *  - `partial`     — existe una parte (a menudo solo en la base) sin superficie.
 *  - `declared`    — la frontera está reconocida y su contrato escrito, pero no
 *                    hay implementación. Es el estado honesto para lo que
 *                    construyen P03-P14; declararlo `implemented` sería mentir.
 */

/** Dominios de NEGOCIO. Son los doce que ordena el recorrido SaaS. */
export const DOMAIN_IDS = [
  'catalog',
  'pricing',
  'customers',
  'inventory',
  'checkout',
  'orders',
  'payments',
  'promotions',
  'content',
  'fulfillment',
  'analytics',
  'integrations',
  'sales',
  'credit',
  'trade',
  'planning',
] as const
export type DomainId = (typeof DOMAIN_IDS)[number]

/**
 * Áreas de PLATAFORMA. No son dominios de comercio y por eso no están en la
 * lista de doce: son las que sostienen a todas las demás. Separarlas evita el
 * error de tratar «identidad» como si fuera un módulo vendible más.
 */
export const PLATFORM_AREA_IDS = [
  'identity',
  'tenancy',
  'entitlements',
  'provisioning',
  'configuration',
  // P13-SaaS. Es área de PLATAFORMA y no un dominio de comercio ni un módulo
  // vendible, y las dos cosas importan: la salud operativa sostiene a los doce
  // dominios (por eso no cabe dentro de ninguno) y no se cobra aparte (por eso
  // no es un dominio con capacidad). Un tenant que no pudiera ver por qué
  // fallan sus cobros porque no pagó el addon de observabilidad es un tenant
  // que llama por teléfono.
  'observability',
  // La IA NO es un dominio de comercio: no decide nada sobre productos, precios
  // ni pedidos. Es una capacidad que sirve a catálogo, planificación, analítica
  // y operación por igual, y meterla entre los dominios habría obligado a
  // elegir cuál de ellos la «posee». Que ademas se venda es propiedad de la
  // capacidad, no de la frontera.
  'ai',
  'shell',
] as const
export type PlatformAreaId = (typeof PLATFORM_AREA_IDS)[number]

export type BoundaryId = DomainId | PlatformAreaId

export type BoundaryState = 'implemented' | 'partial' | 'declared'

export interface Boundary {
  readonly id: BoundaryId
  readonly kind: 'domain' | 'platform'
  readonly state: BoundaryState
  /** Qué decide esta frontera y, por tanto, qué NO decide ninguna otra. */
  readonly responsibility: string
  /**
   * Prefijos de ruta bajo `src/` que pertenecen a esta frontera. Gana el
   * prefijo más largo, así que un archivo suelto puede sacarse de la carpeta
   * que lo contiene sin partir la carpeta en dos.
   */
  readonly paths: readonly string[]
  /** Puerto que gobierna la frontera hacia fuera, si lo tiene. */
  readonly port?: string
  /** Dónde vive hoy lo que ya existe y no está en `src/` (base o borde). */
  readonly serverSide?: readonly string[]
}

export const BOUNDARIES: readonly Boundary[] = [
  {
    id: 'catalog',
    kind: 'domain',
    state: 'implemented',
    responsibility:
      'Qué se vende y qué ES: producto, variantes, atributos, unidades de venta, kits, categoría, imágenes y su publicación. No decide precio ni disponibilidad.',
    // Cierre · item 7: los canales son una dimension sobre el catalogo unico
    // (visibilidad por product_channels), no una tienda aparte.
    paths: ['features/catalog', 'features/channels'],
    serverSide: [
      'supabase/functions/catalog-product',
      'migraciones 090300, 091100, 091200',
      'PIM: 170000 (once tablas), 170100 (lectura pública), 170300 (P03-SaaS)',
    ],
  },
  {
    id: 'pricing',
    kind: 'domain',
    state: 'implemented',
    responsibility:
      'Cuánto cuesta una línea antes de promociones: listas por canal, segmento y cliente, escalas, vigencia, moneda e impuesto aplicable.',
    paths: ['features/pricing'],
    port: 'PricingPort',
    serverSide: [
      'ebim.resolve_prices y ebim.resolve_price — la ÚNICA autoridad de precio (180100)',
      'price_lists, price_list_items, price_list_assignments (180000)',
      'price_quote_for_slug (vitrina) y price_quote (backoffice) (180100)',
      'ebim.effective_tax_rate (091700, 091800, 091900)',
      'create_order pide el precio al motor, ya no lo calcula (180200)',
    ],
  },
  {
    id: 'customers',
    kind: 'domain',
    state: 'implemented',
    responsibility:
      'Quién compra, separado de quién se autentica: ficha, contactos, direcciones, segmento, identificadores externos y la cuenta B2B con sus usuarios, sucursales y límites.',
    // El segmento comercial nace en P04 porque es una dimensión de PRECIO antes
    // que una ficha de cliente; la ficha y la cuenta B2B son P05.
    paths: ['features/customers', 'features/storefront/StoreAccountPage.tsx'],
    serverSide: [
      'customer_segments — vocabulario comercial de la sociedad (180000)',
      'customers, customer_addresses, customer_contacts, customer_external_ids (190000)',
      'business_accounts, business_locations, business_account_users, approval_rules (190100)',
      'my_business_accounts y purchase_approval — contexto y autorización sin id del navegador (190100)',
      'price_quote deriva el segmento del cliente; customer_orders enlaza por correo (190200)',
      'contacto desnormalizado en orders: sigue siendo la verdad del pedido anónimo (090400)',
    ],
  },
  {
    id: 'inventory',
    kind: 'domain',
    state: 'implemented',
    responsibility:
      'Cuánto hay y cuánto se puede prometer: existencias por almacén, movimientos trazables, reservas con caducidad y disponibilidad publicable.',
    paths: ['features/inventory'],
    port: 'InventoryPort',
    serverSide: [
      'warehouses, store_warehouses, inventory_levels, inventory_movements y las dos de reserva (200000)',
      'ebim.atp — la única autoridad de disponibilidad (200100)',
      'ebim.take_units — el reparto decide DENTRO de la sentencia que escribe (200100)',
      'ebim.hold_stock / close_reservation — reserva atómica e idempotente (200100)',
      'reserve_inventory, adjust_inventory, sync_inventory_level y sus autorizaciones (200200)',
      'in_stock de la vitrina calculado por ATP (200300)',
      'create_order consume por ebim.consume_stock y acepta una reserva (200400)',
      'products.stock sigue siendo el camino de fallback sin almacenes (090300)',
    ],
  },
  {
    id: 'checkout',
    kind: 'domain',
    state: 'implemented',
    responsibility:
      'Del carrito al pedido: carrito persistente, intención de compra idempotente y el pipeline server-side que la convierte en pedido.',
    paths: [
      'features/storefront/cart',
      'features/storefront/checkout.ts',
      'features/storefront/StoreCartPage.tsx',
      'features/storefront/StoreCheckoutPage.tsx',
    ],
    serverSide: [
      'supabase/functions/checkout — el pipeline de once etapas (P07-SaaS)',
      'supabase/functions/_shared/checkout — orquestador puro, puertos y ganchos',
      'supabase/functions/create-order — la puerta de P02-P06, que sigue viva',
      'carts + cart_items, y la fusion invitado -> usuario (100000, 100100)',
      'checkout_intents — una compra por clave de idempotencia y tienda (100300)',
      'checkout_place_order — pedido + intento + carrito + hechos, en UNA transaccion (100400)',
      'domain_events — el outbox de dominio, sin proveedor (100200)',
      'create_order (091300, 130300, 180200, 200400)',
    ],
  },
  {
    id: 'orders',
    kind: 'domain',
    state: 'implemented',
    responsibility:
      'El pedido una vez existe: estado, historial y consulta por el comprador o por el comercio.',
    paths: ['features/orders', 'features/storefront/StoreOrderPage.tsx'],
    serverSide: [
      'supabase/functions/update-order-status',
      'order_status_events (091400)',
      'order_by_token (140000)',
    ],
  },
  {
    id: 'payments',
    kind: 'domain',
    // P09-SaaS. El dominio existe entero y no toca el de pedidos: un cobro
    // apunta al pedido y el pedido no apunta al cobro. Añadir una pasarela real
    // es registrar un adaptador en `_shared/payments/registry.ts`.
    state: 'implemented',
    responsibility:
      'Cobro y su conciliación: intento de pago, autorización, captura, devolución y webhooks.',
    paths: ['features/payments'],
    port: 'PaymentProvider',
    serverSide: [
      'catálogo de proveedores en integration_providers (150000) y conector `sandbox` (120200)',
      'siete tablas del dominio, guardas PCI y RLS default deny (120000)',
      'comandos: intent_open, apply_outcome, refund_request/settle y conciliación (120100)',
      'contrato canónico y adaptadores: supabase/functions/_shared/payments',
      'Edge Function payments-webhook: firma verificada e ingesta idempotente',
    ],
  },
  {
    id: 'promotions',
    kind: 'domain',
    // P10-SaaS. El motor existe entero y **no toca el de precios**: recibe
    // líneas ya cotizadas por `ebim.resolve_prices` y les resta. Añadir un tipo
    // de campaña es una rama en `ebim.evaluate_promotions`, no un cambio en
    // ninguna de las cinco tablas de P04.
    state: 'implemented',
    responsibility:
      'Descuento sobre el precio base ya resuelto: campañas, cupones, tarjetas regalo y su desglose.',
    paths: ['features/promotions'],
    serverSide: [
      'siete tablas del dominio con RLS default deny y bitácora DEFINER (130000)',
      'motor determinista con orden total y stacking explícito: evaluate_promotions (130100)',
      'tarjetas regalo: saldo, libro mayor y caducidad (130200)',
      'create_order evalúa con los cerrojos puestos y apunta el canje (130300)',
    ],
  },
  {
    id: 'content',
    kind: 'domain',
    // P11-SaaS. Deja de ser `partial`: la vitrina ya no es solo un lector del
    // catálogo, tiene páginas y bloques que el comercio escribe, con vigencia,
    // canal y segmento, y un buscador con índice propio. Lo que faltaba para
    // dejar de ser parcial no era código de pantalla, era que el CONTENIDO
    // fuera un dato del tenant en vez de una plantilla.
    state: 'implemented',
    responsibility:
      'Cómo se presenta la tienda al comprador y cómo la encuentra: vitrina, contenido administrable, navegación, ficha, marca publicable y búsqueda del catálogo.',
    paths: ['features/storefront', 'features/content'],
    port: 'SearchPort',
    serverSide: [
      'public_stores y public_products (090500, 091200)',
      'store_settings + tokens de white-label (091500, 140200)',
      'content_pages, content_blocks, content_block_items con RLS default deny (140000)',
      'ebim.resolve_content — una sola autoridad para la vitrina y la vista previa (140100)',
      'store_page_for_slug (anónimo) y content_preview (backoffice) (140100)',
      'products.search_vector, pg_trgm, search_synonyms y ebim.search_catalog (140300)',
    ],
  },
  {
    id: 'fulfillment',
    kind: 'domain',
    // P12-SaaS. Deja de ser `declared`: hay zonas, métodos con tarifa resuelta
    // en el servidor, ventanas, puntos de recojo, cola de preparación,
    // seguimiento normalizado y devoluciones con reposición. La propiedad que
    // sostiene la frontera es la misma que P09 estableció para los cobros: una
    // entrega apunta al pedido y el pedido NO apunta a la entrega, así que
    // conectar un operador nuevo no toca el dominio de pedidos.
    state: 'implemented',
    responsibility:
      'Cómo llega el pedido y cómo vuelve: cobertura, coste, ventanas, punto de recojo, despacho (parcial incluido), seguimiento y devolución.',
    paths: ['features/fulfillment'],
    port: 'FulfillmentProvider',
    serverSide: [
      'la oferta: delivery_zones, delivery_methods, delivery_rates, pickup_points, delivery_windows (150000)',
      'el despacho: fulfillments, fulfillment_items, shipments, shipment_items, tracking_events (150100)',
      'ebim.delivery_options — la ÚNICA autoridad de cobertura y tarifa (150200)',
      'ebim.select_warehouse — el punto de recojo manda sobre la regla del método (150200)',
      'comandos: fulfillment_create/assign/transition, shipment_open y la ingesta de seguimiento (150300)',
      'devoluciones: return_reasons, return_requests, return_items, return_events, return_evidence (150400)',
      'return_decide/receive/inspect/complete y el hecho canónico return.completed (150500)',
      'create_order cotiza la entrega y escribe orders.shipping_total, que valía siempre 0 (150600)',
      'contrato canónico y adaptadores: supabase/functions/_shared/fulfillment',
      'Edge Function fulfillment-webhook: firma verificada e ingesta idempotente',
    ],
  },
  {
    id: 'analytics',
    kind: 'domain',
    // P13-SaaS. Deja de ser `partial`: hay una serie temporal de hechos
    // canónicos con su propia puerta pública, indicadores con denominador real
    // y una pantalla con exportación. Lo que faltaba para dejar de ser parcial
    // no era más agregados sobre `orders` —eso ya estaba—, era que existiera un
    // HECHO de comercio como dato de primera clase.
    state: 'implemented',
    responsibility:
      'Qué está pasando en la tienda: los nueve hechos canónicos de comercio, sin PII, y los indicadores que se derivan de ellos y de los pedidos.',
    paths: [
      'features/analytics',
      // El emisor de los tres hechos de vitrina vive en `storefront` porque es
      // ahí donde ocurren, pero pertenece a ESTA frontera: gana el prefijo más
      // largo, igual que el carrito sale de `content` hacia `checkout`.
      'features/storefront/analytics.ts',
      'features/admin/useDashboardKpis.ts',
      'features/admin/DashboardPage.tsx',
    ],
    serverSide: [
      'dashboard_kpis, SECURITY INVOKER (091000)',
      'analytics_events — los nueve hechos, append-only y sin PII (160100)',
      'track_events_for_slug — la puerta ANÓNIMA; solo tres tipos (160100)',
      'seis triggers de servidor: checkout, pedido, carrito y canje (160100)',
      'analytics_kpis, analytics_top_products, analytics_channel_performance, analytics_timeseries (160200)',
      'analytics_funnel y analytics_search_terms, gateadas por analytics.advanced (160200)',
    ],
  },
  {
    id: 'integrations',
    kind: 'domain',
    // P14-SaaS. Deja de ser `partial`. Lo que faltaba no era transporte —eso
    // existía desde P12 histórico y estaba probado— sino que un tercero
    // pudiera USARLO: credenciales con permisos por operación, una API
    // versionada que no expone el esquema, suscripciones a eventos con firma y
    // reproducción, y una pantalla donde los fallos se ven y se recuperan.
    //
    // La propiedad que sostiene la frontera: los webhooks NO son una segunda
    // cola. Son `integration_outbox` con `provider_code = 'webhook'` y un
    // `target` por endpoint, así que heredan idempotencia, backoff, cola
    // muerta, disyuntor y monitor sin escribir ninguno otra vez.
    state: 'implemented',
    responsibility:
      'Hablar con sistemas de terceros por un contrato canónico, en los dos sentidos: catálogo de proveedores, outbox, inbox, disyuntor, webhooks salientes y la API de socio con sus credenciales y permisos.',
    // `features/notifications` vive aquí porque el correo es la implementación
    // del `NotificationProvider` de esta frontera (Microsoft Graph, contrato §14).
    paths: ['features/integrations', 'features/notifications'],
    port: 'ErpProvider · InvoicingProvider · NotificationProvider',
    serverSide: [
      'integration_providers, tenant_integrations, outbox, inbox, messages y circuito (150000, 150100)',
      'el DESTINO: integration_outbox.target y el disyuntor por endpoint (170000)',
      'webhook_endpoints, webhook_subscriptions, webhook_deliveries y el fan-out desde domain_events (170200)',
      'api_clients, api_access_tokens, api_requests, api_idempotency y el grant client_credentials (170300)',
      'los recursos de /v1: pedidos, productos, existencia y clientes (170400)',
      'integration_monitor, webhook_monitor, integration_health, detalle sanitizado, retry y replay (170500)',
      'notifications y notification_emails, el reparto desde domain_events y el envío por Microsoft Graph (20260912110000, 120000)',
      'supabase/functions/api — la puerta versionada de la API de socio',
      'supabase/functions/integration-worker — el que vacía la cola y firma los webhooks',
      'supabase/functions/_shared/api y _shared/webhooks — contrato, rutas, OpenAPI y firma',
    ],
  },

  {
    id: 'sales',
    kind: 'domain',
    // Recorrido B2B, fases 02-03 y 12-13. La capa que el core de comercio no
    // tiene: la OPERACION comercial. Quien vende, a que cartera, en que
    // territorio, siguiendo que ruta, con que meta y cobrando que comision.
    //
    // La propiedad que sostiene la frontera: `sales` no decide precio ni
    // existencia. Se los pregunta a `pricing` y a `inventory`. Un vendedor que
    // pudiera fijar el precio seria un segundo motor de precios, que es
    // exactamente el error que `pricing` documenta desde P04.
    //
    // Y el territorio comercial es SUYO, no de `fulfillment`: reutilizar
    // `delivery_zones` ataria la cartera de un vendedor al recorrido de un
    // camion, y cambiar una ruta de reparto movería clientes de dueño.
    state: 'declared',
    responsibility:
      'La estructura comercial de campo: vendedor, jerarquía, cartera, territorio, ruta, visita, meta y comisión.',
    paths: ['features/sales'],
    serverSide: [],
  },
  {
    id: 'credit',
    kind: 'domain',
    // Recorrido B2B, fase 04. `business_accounts` ya guardaba la LINEA; lo que
    // faltaba es el DOCUMENTO por cobrar con su vencimiento y su saldo, que es
    // lo que convierte «te fio 10.000» en «me debes 3.200, y 800 estan
    // vencidos desde hace doce dias».
    //
    // No decide si el pedido se despacha: el bloqueo por mora sera un gancho
    // del pipeline de checkout, que ya tiene puertos, y nunca un `if` dentro de
    // `create_order`.
    state: 'implemented',
    responsibility:
      'Cuánto se le fía a un cliente y cuánto debe: línea, documento por cobrar, cobro, aplicación y antigüedad de saldos.',
    paths: ['features/credit'],
    serverSide: [
      'ar_documents, ar_receipts y ar_applications con RLS default deny (20260902120000)',
      'el saldo lo mantiene un trigger, no la aplicación: ebim.ar_apply_balance',
      'ebim.customer_aging — los cinco tramos de la antigüedad, en un solo viaje',
    ],
  },
  {
    id: 'trade',
    kind: 'domain',
    // Recorrido B2B, fase 06. Que se le OFRECE a cada cliente del canal.
    //
    // No calcula precio. «Cotizacion» significa dos cosas en este repositorio y
    // no son la misma: `ebim.build_quote` es el motor que dice cuanto cuesta un
    // carrito AHORA, y una cotizacion comercial es un documento con vigencia y
    // estado. Esta frontera crea la segunda y le pide el precio a la primera; si
    // calculara por su cuenta habria dos verdades sobre el precio.
    state: 'implemented',
    responsibility:
      'Qué se le ofrece a cada cliente del canal: cotización con vigencia y estado, y su conversión a pedido.',
    paths: ['features/trade'],
    serverSide: [
      'quotes y quote_items con RLS default deny (20260902130000)',
      'quote_items calca order_items con impuesto por línea: convertir es copiar, no traducir',
      'una cotización aceptada, rechazada o vencida no se edita: dos triggers lo impiden',
    ],
  },
  {
    id: 'planning',
    kind: 'domain',
    // Recorrido B2B, fases 14 y 15. Que se PREVE y que se SUGIERE.
    //
    // La sugerencia no crea pedidos: produce una lista que una persona
    // confirma, y de ahi sale un carrito que entra por el pipeline de checkout
    // de siempre. Un sistema que pide por ti es un sistema que se equivoca por
    // ti, y en distribucion eso se paga en devoluciones y mercaderia vencida.
    state: 'implemented',
    responsibility:
      'Qué se prevé y qué se sugiere: recomendación de pedido con su motivo auditable y previsión de demanda por producto, periodo y territorio.',
    paths: ['features/planning'],
    serverSide: [
      'order_suggestions, order_suggestion_items y demand_forecasts con RLS default deny (20260902180000)',
      'ebim.suggest_order — devuelve FILAS con su motivo; no crea nada',
      'cada línea sugerida guarda por qué: una cifra que nadie discute es una que nadie corrige',
    ],
  },
  {
    id: 'ai',
    kind: 'platform',
    // La IA como capacidad MEDIDA, no como adorno de una pantalla.
    //
    // Es la unica frontera cuyo coste es marginal por uso: todo lo demas del
    // producto cuesta lo mismo se use o no. De ahi que lo primero que exista
    // aqui no sea un asistente sino un contador, un tope y una traza. Un modulo
    // que gasta dinero por llamada y no se mide es una factura abierta.
    //
    // Ninguna llamada al proveedor sale del navegador: la clave vive en los
    // secretos de las Edge Functions y no entra jamas en el bundle.
    state: 'implemented',
    responsibility:
      'Cuánta IA puede gastar cada sociedad, en qué se gastó y si sirvió: entitlement, cuota, consumo atómico y traza con opinión.',
    paths: ['features/ai'],
    serverSide: [
      'ai_quotas, ai_usage y ai_interactions con RLS default deny y forzada (20260910100000)',
      'ebim.ai_consume — valida y descuenta en la MISMA transacción; el `for update` impide servir de más en concurrencia',
      'ebim.ai_record — separada del consumo porque los tokens solo se conocen después de responder',
      'el texto de la traza entra recortado y redactado en la frontera, no en quien llama',
    ],
  },

  {
    id: 'identity',
    kind: 'platform',
    state: 'implemented',
    responsibility:
      'Quién es el usuario del backoffice y si su sesión sigue viva. El comprador del storefront es anónimo por diseño.',
    paths: ['features/auth'],
    serverSide: ['Supabase Auth y ebim.demo_access_token_hook (120000, 121000)'],
  },
  {
    id: 'tenancy',
    kind: 'platform',
    state: 'implemented',
    responsibility:
      'Qué organización, sociedad y tienda están activas. Siempre derivado del JWT, nunca declarado por el cliente.',
    paths: ['features/tenant'],
    serverSide: ['ebim.can_access y ebim.has_role (090000)', 'tenant_members (090100)'],
  },
  {
    id: 'entitlements',
    kind: 'platform',
    state: 'implemented',
    responsibility:
      'Qué módulos tiene contratados y activos la sociedad. Lo contratado lo decide el hub (contrato §5/§6); esta área lo resuelve, lo cachea y lo hace cumplir. No es un módulo vendible: es el que decide qué módulos hay.',
    paths: ['features/capabilities'],
    serverSide: [
      'app_capabilities, tenant_platform_context, tenant_entitlements, tenant_feature_flags (160000)',
      'ebim.has_capability y public.effective_capabilities (160000)',
      'supabase/functions/platform-context',
    ],
  },
  {
    id: 'provisioning',
    kind: 'platform',
    state: 'implemented',
    responsibility: 'Dar de alta un tenant con su primera sociedad, tienda y administrador.',
    paths: ['features/onboarding'],
    serverSide: ['supabase/functions/bootstrap-tenant', 'bootstrap_tenant (090700)'],
  },
  {
    id: 'configuration',
    kind: 'platform',
    state: 'implemented',
    responsibility:
      'Lo que el tenant activa y personaliza sin tocar código: branding, impuestos y ajustes de tienda.',
    paths: ['features/admin/settings'],
    serverSide: ['store_settings (091500)', 'tax_categories y set_tax_rate (091600, 091800)'],
  },
  {
    id: 'observability',
    kind: 'platform',
    state: 'implemented',
    responsibility:
      'Que se pueda saber qué pasó: el hilo (correlation id) que cose una petición de punta a punta, la bitácora de operaciones sensibles y la salud operativa del tenant.',
    paths: ['features/ops'],
    serverSide: [
      'ebim.correlation_id y ebim.request_id — el hilo, como DEFAULT de ocho tablas (160000)',
      'las guardas de PII: pii_json_keys, looks_like_email, jsonb_is_pii_free, redact_pii (160000)',
      'audit_log — append-only para todos, con actor derivado del JWT (160300)',
      'ebim.audit_row — el trigger genérico sobre once tablas sensibles (160300)',
      'ops_events + cuatro triggers de proyección; ops_health y ops_resolve_event (160400)',
      'trace_by_correlation — la línea de tiempo de un hilo por once tablas (160400)',
      'supabase/functions/_shared/observability — logger con sinks, sin vendor',
    ],
  },
  {
    id: 'shell',
    kind: 'platform',
    state: 'implemented',
    responsibility:
      'El armazón: router, providers, layout del backoffice, design system, i18n, buscador global y utilidades compartidas.',
    // `features/search` es NAVEGACION, no un dominio: lee pedidos y productos
    // pero no decide nada sobre ellos, solo lleva a su pantalla. Sus secciones
    // salen de `visibleNavItems`, la misma fuente que el sidebar, asi que no
    // puede convertirse en un atajo a lo que el rol no permite.
    paths: ['app', 'shared', 'theme', 'features/admin', 'features/search', 'main.tsx'],
  },
]

const BY_ID = new Map<BoundaryId, Boundary>(BOUNDARIES.map((b) => [b.id, b]))

export function boundary(id: BoundaryId): Boundary {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Frontera no declarada: ${id}`)
  return found
}

/**
 * Frontera a la que pertenece una ruta de `src/`. Gana el prefijo más largo:
 * `features/admin/settings/api.ts` es `configuration` aunque `features/admin`
 * sea `shell`.
 */
export function boundaryForPath(relativePath: string): Boundary | null {
  const path = relativePath.replace(/\\/g, '/')
  let best: Boundary | null = null
  let bestLength = -1

  for (const candidate of BOUNDARIES) {
    for (const prefix of candidate.paths) {
      const matches = path === prefix || path.startsWith(`${prefix}/`)
      if (matches && prefix.length > bestLength) {
        best = candidate
        bestLength = prefix.length
      }
    }
  }
  return best
}
