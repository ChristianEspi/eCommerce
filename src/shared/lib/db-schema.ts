/**
 * Vocabulario de PERSISTENCIA: cómo se llaman las cosas en Postgres.
 *
 * Está aquí y no en `src/domain` a propósito. Un nombre de tabla no es un
 * concepto de negocio, es un detalle de la implementación que hoy es Supabase;
 * el dominio habla de «producto», no de `public.products`. La prueba de
 * arquitectura verifica que nada bajo `src/domain` importa este archivo.
 *
 * Por qué existe: antes de P01 las mismas constantes estaban escritas dos veces
 * —`STORES_TABLE` en `features/tenant` y en `features/admin/settings`,
 * `PRODUCT_IMAGES_BUCKET` y `STORE_ASSETS_BUCKET` en catálogo y en storefront—.
 * Dos copias de un nombre no se separan el día que se escriben, se separan el
 * día que una de las dos cambia. Cada feature reexporta lo suyo, así que ningún
 * llamante tuvo que cambiar de import.
 *
 * Además es el **consumidor de `database.types.ts`** (R11). Cada constante lleva
 * `satisfies` contra el esquema generado, así que un nombre de tabla, vista o
 * función que deje de existir en la base **deja de compilar**. Hasta P01 el
 * archivo generado estaba commiteado en 0 bytes y no lo importaba nadie, o sea
 * que la convención «tipos generados, no escritos a mano» no se cumplía y
 * tampoco había forma de notarlo. El generador se arregló en
 * `scripts/gen-db-types.mjs`; esto es lo que le da un consumidor.
 *
 * Los buckets de Storage y los nombres de Edge Function NO se pueden tipar así:
 * no están en el esquema `public`. Se quedan como literales.
 */
import type { Database } from './database.types'

type Schema = Database['public']
type TableName = keyof Schema['Tables']
type ViewName = keyof Schema['Views']
type FunctionName = keyof Schema['Functions']

// --- Tablas ----------------------------------------------------------------
export const TENANTS_TABLE = 'tenants' satisfies TableName
export const TENANT_MEMBERS_TABLE = 'tenant_members' satisfies TableName
/** Avisos por persona: campanita del backoffice y «Tu cuenta» de la tienda. */
export const NOTIFICATIONS_TABLE = 'notifications' satisfies TableName
/** Cola de correo. Solo lectura para owner y admin, para ver si sale. */
export const NOTIFICATION_EMAILS_TABLE = 'notification_emails' satisfies TableName
export const STORES_TABLE = 'stores' satisfies TableName
export const STORE_SETTINGS_TABLE = 'store_settings' satisfies TableName
export const PRODUCTS_TABLE = 'products' satisfies TableName
export const CATEGORIES_TABLE = 'categories' satisfies TableName
export const PRODUCT_IMAGES_TABLE = 'product_images' satisfies TableName
export const ORDERS_TABLE = 'orders' satisfies TableName
export const ORDER_ITEMS_TABLE = 'order_items' satisfies TableName
export const ORDER_EVENTS_TABLE = 'order_status_events' satisfies TableName
export const CURRENCIES_TABLE = 'currencies' satisfies TableName
export const TAX_CATEGORIES_TABLE = 'tax_categories' satisfies TableName

// --- Recorrido B2B: la operacion comercial (migraciones 20260902100000+) -----
// `satisfies TableName` en todas: si una migracion se renombra o no se aplica,
// el typecheck se pone rojo aqui y no en la primera consulta en produccion.
export const SALES_REPS_TABLE = 'sales_reps' satisfies TableName
export const SALES_REP_CUSTOMERS_TABLE = 'sales_rep_customers' satisfies TableName
export const SALES_TERRITORIES_TABLE = 'sales_territories' satisfies TableName
export const SALES_REP_TERRITORIES_TABLE = 'sales_rep_territories' satisfies TableName
export const SALES_ROUTES_TABLE = 'sales_routes' satisfies TableName
export const SALES_ROUTE_STOPS_TABLE = 'sales_route_stops' satisfies TableName
export const SALES_VISITS_TABLE = 'sales_visits' satisfies TableName
export const SALES_GOALS_TABLE = 'sales_goals' satisfies TableName
export const COMMISSION_RULES_TABLE = 'commission_rules' satisfies TableName
export const COMMISSION_STATEMENTS_TABLE = 'commission_statements' satisfies TableName

export const AR_DOCUMENTS_TABLE = 'ar_documents' satisfies TableName
export const AR_RECEIPTS_TABLE = 'ar_receipts' satisfies TableName
export const AR_APPLICATIONS_TABLE = 'ar_applications' satisfies TableName
export const INVOICES_TABLE = 'invoices' satisfies TableName
export const INVOICE_ITEMS_TABLE = 'invoice_items' satisfies TableName
// --- Cierre · D1 · Emision de comprobantes (20260914170000) -----------------
// Sin `satisfies`: la migracion aun no esta aplicada en el proyecto enlazado y
// `database.types.ts` no se edita a mano. La red es `invoice-issue.test.ts`.
/** Estado de emision por comprobante (security invoker). */
export const INVOICE_ISSUE_STATUS_VIEW = 'invoice_issue_status'
/** Pide emitir un comprobante completo; el tenant sale de la fila, no del cliente. */
export const INVOICE_REQUEST_ISSUE_RPC = 'invoice_request_issue'
// --- Alta desde EBIM MasterAdmin (20260924120000) ---------------------------
// Sin `satisfies`: la migracion aun no esta aplicada en el proyecto enlazado.
/**
 * El administrador que MasterAdmin dejo PREPROVISIONED reclama su tenant. Sin
 * argumentos: usuario, organizacion, sociedad y correo salen del JWT.
 */
export const CLAIM_PROVISIONED_TENANT_RPC = 'claim_provisioned_tenant'

export const QUOTES_TABLE = 'quotes' satisfies TableName
export const QUOTE_ITEMS_TABLE = 'quote_items' satisfies TableName
export const ASSORTMENTS_TABLE = 'assortments' satisfies TableName
export const ASSORTMENT_ITEMS_TABLE = 'assortment_items' satisfies TableName
export const ASSORTMENT_ASSIGNMENTS_TABLE = 'assortment_assignments' satisfies TableName

export const ORDER_SUGGESTIONS_TABLE = 'order_suggestions' satisfies TableName
export const ORDER_SUGGESTION_ITEMS_TABLE = 'order_suggestion_items' satisfies TableName
export const DEMAND_FORECASTS_TABLE = 'demand_forecasts' satisfies TableName

export const CUSTOMER_AGING_RPC = 'customer_aging'
/** `ebim.suggest_order` — devuelve FILAS con su motivo; no crea nada. */
export const SUGGEST_ORDER_RPC = 'suggest_order'
// --- Cierre · item 11 · Sugerido v2 (20260914151000) ------------------------
/** `ebim.suggest_order_v2` — historial en dos ventanas, temporada, surtido y ATP; cae a v1. */
export const SUGGEST_ORDER_V2_RPC = 'suggest_order_v2'


// --- IA medida (migración 20260910100000) ----------------------------------
// SIN `satisfies` por el mismo motivo que las capacidades, más abajo: la
// migración todavía no está aplicada en el proyecto enlazado contra el que se
// generan los tipos. La red de seguridad es `supabase/tests/ai-metering.test.ts`,
// que comprueba estos nombres contra el esquema real de las migraciones.
export const AI_QUOTAS_TABLE = 'ai_quotas'
export const AI_USAGE_TABLE = 'ai_usage'
export const AI_INTERACTIONS_TABLE = 'ai_interactions'
/** Estado del saldo. Solo lectura: mirar el medidor no gasta cuota. */
export const AI_ENTITLEMENT_RPC = 'ai_entitlement'
/** Valida y descuenta en la MISMA transacción. Lo llaman las Edge Functions. */
export const AI_CONSUME_RPC = 'ai_consume'
/** Deja la traza y suma los tokens, ya conocidos tras responder. */
export const AI_RECORD_RPC = 'ai_record'
// --- Cotizaciones con IA (migración 20260921170000, fase 07) --------------
// Sin `satisfies`: la migración aún no está en el proyecto enlazado. Red de
// seguridad: `supabase/tests/ai-quotes-facts.test.ts`.
/** Borrador preciado por el motor (`price_quote`) con disponibilidad y surtido. Solo lee. */
export const QUOTE_DRAFT_PREVIEW_RPC = 'quote_draft_preview'
/** Guarda el borrador en `draft` tras la confirmación humana; re-precia en el servidor. */
export const QUOTE_CREATE_FROM_DRAFT_RPC = 'quote_create_from_draft'
/** El pulgar. Única columna de la traza que puede cambiar una persona. */
export const AI_FEEDBACK_RPC = 'ai_feedback'

// --- Capacidades y entitlements (P02-SaaS, migración 160000) ---------------
// SIN `satisfies`: `database.types.ts` se genera contra el proyecto Supabase
// ENLAZADO y la migración 160000 todavía no está aplicada allí (esta fase no
// despliega, contrato de ejecución §11). Poner el `satisfies` ahora sería
// romper el typecheck; escribir los tipos a mano sería romper la convención
// que R11 acaba de cerrar. La red de seguridad mientras tanto es
// `supabase/tests/capabilities.test.ts`, que comprueba estos mismos nombres
// contra el esquema real construido desde las migraciones — una verificación
// MÁS fuerte que el `satisfies`, porque no depende de que alguien regenere.
// Al aplicar la migración: `npm run db:types` y añadir el `satisfies`.
export const APP_CAPABILITIES_TABLE = 'app_capabilities'
export const TENANT_PLATFORM_CONTEXT_TABLE = 'tenant_platform_context'
export const TENANT_ENTITLEMENTS_TABLE = 'tenant_entitlements'
export const TENANT_FEATURE_FLAGS_TABLE = 'tenant_feature_flags'

// --- PIM (P03-SaaS, migraciones 170000-170300) ------------------------------
// Sin `satisfies` por la misma razón que las cuatro de arriba: `database.types.ts`
// se genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/pim-catalog.test.ts`,
// que comprueba estos mismos nombres contra el esquema construido desde las
// migraciones. Al aplicar: `npm run db:types` y añadir el `satisfies`.
export const BRANDS_TABLE = 'brands'
/**
 * El listado de productos del backoffice, con `category_name` y `brand_name`
 * aplanados para que el buscador general los alcance en el mismo `or=`.
 * Sin `satisfies` hasta regenerar los tipos, como las de arriba.
 */
export const ADMIN_PRODUCTS_VIEW = 'admin_products'
export const PRODUCT_FAMILIES_TABLE = 'product_families'
export const ATTRIBUTES_TABLE = 'attributes'
export const ATTRIBUTE_VALUES_TABLE = 'attribute_values'
export const UNITS_OF_MEASURE_TABLE = 'units_of_measure'
export const PRODUCT_VARIANTS_TABLE = 'product_variants'
export const VARIANT_ATTRIBUTE_VALUES_TABLE = 'variant_attribute_values'
export const PRODUCT_ATTRIBUTE_VALUES_TABLE = 'product_attribute_values'
export const PRODUCT_UOMS_TABLE = 'product_uoms'
export const BUNDLE_ITEMS_TABLE = 'bundle_items'
export const PRODUCT_RELATIONS_TABLE = 'product_relations'

// --- Motor de precios (P04-SaaS, migraciones 180000-180200) -----------------
// Sin `satisfies` por la misma razón que las del PIM: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/pricing-engine.test.ts`
// y `pricing-checkout.test.ts`, que comprueban estos nombres contra el esquema
// construido desde las migraciones. Al aplicar: `npm run db:types` y `satisfies`.
export const CUSTOMER_SEGMENTS_TABLE = 'customer_segments'
export const PRICE_LISTS_TABLE = 'price_lists'
export const PRICE_LIST_ITEMS_TABLE = 'price_list_items'
export const PRICE_LIST_ASSIGNMENTS_TABLE = 'price_list_assignments'
export const PRICE_CHANGE_EVENTS_TABLE = 'price_change_events'
export const CHANNELS_TABLE = 'channels'
// --- Cierre · item 7 · Administracion de canales (20260914150000) -----------
// Sin `satisfies` por la misma razon que el resto de este bloque: la migracion
// aun no esta aplicada en el proyecto enlazado. La red es `channels-admin.test.ts`.
/** Cambia el canal por defecto en una transaccion; autoriza owner/admin desde el JWT. */
export const CHANNEL_SET_DEFAULT_RPC = 'channel_set_default'
/** Productos declarados por canal (cero = todo el catalogo). Security invoker. */
export const CHANNEL_CATALOG_SUMMARY_RPC = 'channel_catalog_summary'

// --- Clientes y cuentas B2B (P05-SaaS, migraciones 190000-190200) -----------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/customers.test.ts`,
// que comprueba estos nombres contra el esquema construido desde las
// migraciones. Al aplicar: `npm run db:types` y añadir el `satisfies`.
export const CUSTOMERS_TABLE = 'customers'
export const CUSTOMER_ADDRESSES_TABLE = 'customer_addresses'
export const CUSTOMER_CONTACTS_TABLE = 'customer_contacts'
export const CUSTOMER_EXTERNAL_IDS_TABLE = 'customer_external_ids'
export const BUSINESS_ACCOUNTS_TABLE = 'business_accounts'
export const BUSINESS_LOCATIONS_TABLE = 'business_locations'
export const BUSINESS_ACCOUNT_USERS_TABLE = 'business_account_users'
export const APPROVAL_RULES_TABLE = 'approval_rules'

// --- Inventario (P06-SaaS, migraciones 200000-200400) -----------------------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/inventory.test.ts`,
// que comprueba estos nombres contra el esquema construido desde las
// migraciones. Al aplicar: `npm run db:types` y añadir el `satisfies`.
export const WAREHOUSES_TABLE = 'warehouses'
export const STORE_WAREHOUSES_TABLE = 'store_warehouses'
export const INVENTORY_LEVELS_TABLE = 'inventory_levels'
export const INVENTORY_MOVEMENTS_TABLE = 'inventory_movements'
export const INVENTORY_RESERVATIONS_TABLE = 'inventory_reservations'
export const INVENTORY_RESERVATION_ITEMS_TABLE = 'inventory_reservation_items'
export const INVENTORY_ALERTS_VIEW = 'inventory_alerts'

// --- Carrito, intentos de compra y hechos (P07-SaaS, migraciones 100000-100400)
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/carts.test.ts` y
// `checkout-pipeline.test.ts`, que comprueban estos nombres contra el esquema
// construido desde las migraciones. Al aplicar: `npm run db:types` y `satisfies`.
export const CARTS_TABLE = 'carts'
export const CART_ITEMS_TABLE = 'cart_items'
export const CHECKOUT_INTENTS_TABLE = 'checkout_intents'
export const DOMAIN_EVENTS_TABLE = 'domain_events'

// --- OMS (P08-SaaS, migraciones 110000-110600) ------------------------------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/orders-oms.test.ts`,
// que comprueba estos nombres contra el esquema construido desde las
// migraciones. Al aplicar: `npm run db:types` y añadir el `satisfies`.
//
// `ORDER_EVENTS_TABLE` (arriba) sigue apuntando a `order_status_events`, que no
// se retira: es la bitácora de P07 histórico y la leen consultas existentes. La
// línea de tiempo COMPLETA —los cuatro ejes en un solo relato— es esta otra, y
// se llama distinto justamente para que nadie confunda una con otra.
export const ORDER_TIMELINE_TABLE = 'order_events'
export const ORDER_NOTES_TABLE = 'order_notes'
export const ORDER_TAGS_TABLE = 'order_tags'
export const ORDER_EXTERNAL_REFS_TABLE = 'order_external_refs'

// --- Pagos (P09-SaaS, migraciones 120000-120200) ----------------------------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/payments.test.ts`,
// que comprueba estos nombres contra el esquema construido desde las
// migraciones. Al aplicar: `npm run db:types` y añadir el `satisfies`.
//
// De las siete tablas, el backoffice ESCRIBE una sola —`payment_methods`, que
// es configuración—. Las otras seis se leen: mover dinero es un comando.
export const PAYMENT_METHODS_TABLE = 'payment_methods'
export const PAYMENT_INTENTS_TABLE = 'payment_intents'
export const PAYMENT_ATTEMPTS_TABLE = 'payment_attempts'
export const PAYMENTS_TABLE = 'payments'
export const REFUNDS_TABLE = 'refunds'
export const PAYMENT_EVENTS_TABLE = 'payment_events'
export const RECONCILIATION_TABLE = 'reconciliation_records'
export const PAYMENT_OVERVIEW_VIEW = 'payment_intent_overview'
export const PUBLIC_PAYMENT_METHODS_VIEW = 'public_payment_methods'
// Catálogo GLOBAL de conectores (P12 histórico). Lo lee la pantalla de pagos
// para ofrecer proveedores por su `code`: ninguna marca vive en el código.
export const INTEGRATION_PROVIDERS_TABLE = 'integration_providers'

// --- Promociones (P10-SaaS, migraciones 130000-130400) ----------------------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/promotions.test.ts`
// y `gift-cards.test.ts`. Al aplicar: `npm run db:types` y añadir el `satisfies`.
//
// De las nueve tablas, el backoffice ESCRIBE cinco —campaña, alcance,
// audiencia, escala y cupón, que son configuración comercial—. Los canjes, la
// bitácora, el saldo de una tarjeta y su libro mayor se LEEN: mover un contador
// de usos o un saldo es un comando, igual que en pagos y en inventario.
export const PROMOTIONS_TABLE = 'promotions'
export const PROMOTION_SCOPES_TABLE = 'promotion_scopes'
export const PROMOTION_AUDIENCES_TABLE = 'promotion_audiences'
export const PROMOTION_TIERS_TABLE = 'promotion_tiers'
export const COUPONS_TABLE = 'coupons'
export const PROMOTION_REDEMPTIONS_TABLE = 'promotion_redemptions'
export const PROMOTION_EVENTS_TABLE = 'promotion_events'
export const GIFT_CARDS_TABLE = 'gift_cards'
export const GIFT_CARD_TRANSACTIONS_TABLE = 'gift_card_transactions'
export const PROMOTION_OVERVIEW_VIEW = 'promotion_overview'
export const GIFT_CARD_OVERVIEW_VIEW = 'gift_card_overview'

// --- CMS y busqueda (P11-SaaS, migraciones 140000-140400) ------------------
// Sin `satisfies` por la misma razón que las de arriba: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones no están aplicadas
// allí. La red mientras tanto es `supabase/tests/cms-content.test.ts` y
// `supabase/tests/catalog-search.test.ts`, que comprueban estos mismos nombres
// contra el esquema construido desde las migraciones.
//
// De las cuatro tablas el backoffice ESCRIBE las cuatro: contenido, colección y
// sinónimos son configuración del comercio. Lo que NO se escribe desde el
// navegador es el estado de verificación del dominio propio —queda fuera del
// GRANT por columna de `store_settings` (migración 140200)— porque marcarse uno
// mismo el dominio como verificado sería saltarse la única prueba que hay.
export const CONTENT_PAGES_TABLE = 'content_pages'
export const CONTENT_BLOCKS_TABLE = 'content_blocks'
export const CONTENT_BLOCK_ITEMS_TABLE = 'content_block_items'
export const SEARCH_SYNONYMS_TABLE = 'search_synonyms'
export const CONTENT_PAGE_OVERVIEW_VIEW = 'content_page_overview'

// --- Fulfillment y devoluciones (P12-SaaS, migraciones 150000-150700) -------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/fulfillment.test.ts`
// y `supabase/tests/returns.test.ts`, que comprueban estos mismos nombres
// contra el esquema construido desde las migraciones.
//
// De las quince tablas, el backoffice ESCRIBE seis —zonas, métodos, tarifas,
// puntos de recojo, franjas y motivos de devolución, que son configuración del
// comercio—. El DESPACHO se lee y se mueve con comandos: mover una entrega son
// cuatro cosas que tienen que pasar juntas (autorización, máquina de estados,
// línea de tiempo y espejo en el pedido) y un GRANT de UPDATE permite la mitad.
export const DELIVERY_ZONES_TABLE = 'delivery_zones'
export const DELIVERY_METHODS_TABLE = 'delivery_methods'
export const DELIVERY_RATES_TABLE = 'delivery_rates'
export const DELIVERY_WINDOWS_TABLE = 'delivery_windows'
export const PICKUP_POINTS_TABLE = 'pickup_points'
export const FULFILLMENTS_TABLE = 'fulfillments'
export const FULFILLMENT_ITEMS_TABLE = 'fulfillment_items'
export const SHIPMENTS_TABLE = 'shipments'
export const SHIPMENT_ITEMS_TABLE = 'shipment_items'
export const TRACKING_EVENTS_TABLE = 'tracking_events'
export const RETURN_REASONS_TABLE = 'return_reasons'
export const RETURN_REQUESTS_TABLE = 'return_requests'
export const RETURN_ITEMS_TABLE = 'return_items'
export const RETURN_EVENTS_TABLE = 'return_events'
export const RETURN_EVIDENCE_TABLE = 'return_evidence'
export const FULFILLMENT_OVERVIEW_VIEW = 'fulfillment_overview'
export const RETURN_OVERVIEW_VIEW = 'return_overview'
export const PUBLIC_DELIVERY_METHODS_VIEW = 'public_delivery_methods'
// Bucket PRIVADO de la evidencia de devolución. Sin lectura pública ni para el
// dueño: se accede con URL firmada que caduca (P12).
export const RETURN_EVIDENCE_BUCKET = 'return-evidence'

// --- Recorrido B2B: reparto y evidencia de entrega (migración 20260902160000)
// CON `satisfies`, al revés que el bloque de arriba: la migración 160000 sí está
// aplicada en el proyecto enlazado, así que `database.types.ts` conoce estas
// cinco tablas y el typecheck se pone rojo aquí —y no en la primera consulta en
// producción— si alguna se renombra.
export const DELIVERY_VEHICLES_TABLE = 'delivery_vehicles' satisfies TableName
export const DELIVERY_PLANS_TABLE = 'delivery_plans' satisfies TableName
export const DELIVERY_PLAN_STOPS_TABLE = 'delivery_plan_stops' satisfies TableName
export const PROOF_OF_DELIVERY_TABLE = 'proof_of_delivery' satisfies TableName
export const POD_EVIDENCE_TABLE = 'pod_evidence' satisfies TableName

// --- Analitica, auditoria y operacion (P13-SaaS, migraciones 160000-160500) -
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones todavía no están
// aplicadas allí. La red mientras tanto es `supabase/tests/analytics.test.ts`,
// `audit-log.test.ts` y `observability.test.ts`, que comprueban estos mismos
// nombres contra el esquema construido desde las migraciones.
//
// De las tres tablas el backoffice NO ESCRIBE NINGUNA, y eso es la fase entera:
// un hecho de analítica, un registro de auditoría y un incidente son cosas que
// se producen, no que se editan. Las tres son append-only en la base —la
// auditoría y la analítica con un trigger que rechaza UPDATE y DELETE incluso
// para `service_role`— y lo único que la pantalla puede hacer sobre un
// incidente es ATENDERLO, por `ops_resolve_event`, que no es un `update`.
export const ANALYTICS_EVENTS_TABLE = 'analytics_events'
export const AUDIT_LOG_TABLE = 'audit_log'
export const OPS_EVENTS_TABLE = 'ops_events'
export const OPS_INCIDENT_OVERVIEW_VIEW = 'ops_incident_overview'

// --- Integraciones empresariales (P14-SaaS, migraciones 170000-170600) ------
// Sin `satisfies` por la misma razón que las anteriores: `database.types.ts` se
// genera contra el proyecto ENLAZADO y estas migraciones no están aplicadas
// allí. La red mientras tanto son `webhooks.test.ts`, `enterprise-api.test.ts`
// e `integration-monitor.test.ts`, que comprueban estos mismos nombres contra
// el esquema construido desde las migraciones.
//
// `api_access_tokens`, `api_requests` y `api_idempotency` NO están aquí: el
// backoffice no las consulta directamente —lo que necesita se lo da
// `integration_health`— y listarlas invitaría a leer desde el navegador una
// tabla cuyo valor está en las columnas que precisamente NO tienen GRANT.
export const INTEGRATION_OUTBOX_TABLE = 'integration_outbox'
export const TENANT_INTEGRATIONS_TABLE = 'tenant_integrations'
export const WEBHOOK_ENDPOINTS_TABLE = 'webhook_endpoints'
export const WEBHOOK_SUBSCRIPTIONS_TABLE = 'webhook_subscriptions'
export const API_CLIENTS_TABLE = 'api_clients'
export const INTEGRATION_MONITOR_VIEW = 'integration_monitor'
export const WEBHOOK_MONITOR_VIEW = 'webhook_monitor'

// --- Vistas del modelo de lectura público ----------------------------------
// `security_invoker` sobre policies `to anon`: filtran filas, y el GRANT por
// columna es lo que evita que `anon` vea `stock` o `config` (P02, §4.3).
export const PUBLIC_STORES_VIEW = 'public_stores' satisfies ViewName
export const PUBLIC_CATEGORIES_VIEW = 'public_categories' satisfies ViewName
export const PUBLIC_PRODUCTS_VIEW = 'public_products' satisfies ViewName
export const PUBLIC_PRODUCT_IMAGES_VIEW = 'public_product_images' satisfies ViewName
// Ídem que las tablas del PIM: sin `satisfies` hasta que se regeneren los tipos.
export const PUBLIC_PRODUCT_VARIANTS_VIEW = 'public_product_variants'
/**
 * Storefront V2 · P02 · Las marcas con producto publicado por tienda, con su
 * logo. Existe porque las FACETAS de la búsqueda dan código, nombre y cuenta —
 * lo que necesita un filtro— y nunca el logo; pedirlo marca a marca sería el
 * N+1 que el rediseño prohíbe. Sin `satisfies` hasta regenerar los tipos.
 */
export const PUBLIC_BRANDS_VIEW = 'public_brands'

// --- Buckets de Storage ----------------------------------------------------
// Los dos son PRIVADOS: no hay URL pública ni para el dueño. Cada lado firma
// con su propio cliente y bajo su propia policy (decisión P02 #18).
export const PRODUCT_IMAGES_BUCKET = 'product-images'
export const STORE_ASSETS_BUCKET = 'store-assets'

// --- Funciones de la base (RPC) --------------------------------------------
export const DASHBOARD_KPIS_RPC = 'dashboard_kpis' satisfies FunctionName
export const PRODUCT_USAGE_RPC = 'product_deletion_usage' satisfies FunctionName
export const CATEGORY_USAGE_RPC = 'category_deletion_usage' satisfies FunctionName
export const SET_PRIMARY_IMAGE_RPC = 'set_primary_product_image' satisfies FunctionName
export const REORDER_IMAGES_RPC = 'reorder_product_images' satisfies FunctionName
export const SET_TAX_RATE_RPC = 'set_tax_rate' satisfies FunctionName
export const ORDER_BY_TOKEN_RPC = 'order_by_token' satisfies FunctionName
// Ídem que las tablas de 160000: sin `satisfies` hasta que se regeneren.
export const EFFECTIVE_CAPABILITIES_RPC = 'effective_capabilities'
// Motor de precios (P04-SaaS). `price_quote_for_slug` la llama el comprador
// ANÓNIMO desde la vitrina; `price_quote` y `price_list_conflicts` solo el
// backoffice con sesión. Son tres funciones distintas y no una con bandera
// justo por eso: cada una tiene su propia autorización dentro.
export const PRICE_QUOTE_PUBLIC_RPC = 'price_quote_for_slug'
export const PRICE_QUOTE_RPC = 'price_quote'
export const PRICE_LIST_CONFLICTS_RPC = 'price_list_conflicts'
// Clientes y cuentas B2B (P05-SaaS). `my_business_accounts` no acepta NINGÚN
// argumento a propósito: el vínculo usuario ↔ cuenta lo resuelve el servidor,
// nunca un id declarado por el navegador (regla 8 de la fase).
export const MY_BUSINESS_ACCOUNTS_RPC = 'my_business_accounts'
/** Vínculos B2B del usuario pendientes de activación. Solo el nombre de la cuenta. */
export const MY_PENDING_BUSINESS_ACCOUNTS_RPC = 'my_pending_business_accounts'
/**
 * En qué tiendas compra quien pregunta (migración 20260910200000). Sin
 * argumentos, por lo mismo que la de arriba. Sin `satisfies` hasta regenerar
 * los tipos: la red mientras tanto es `supabase/tests/my-stores.test.ts`.
 */
export const MY_STORES_RPC = 'my_stores'
export const PURCHASE_APPROVAL_RPC = 'purchase_approval'
export const CUSTOMER_ORDERS_RPC = 'customer_orders'
export const CUSTOMER_USAGE_RPC = 'customer_deletion_usage'
// Inventario (P06-SaaS). Las tres puertas que abre el NAVEGADOR con sesión;
// las del servidor (`reserve_inventory_for_slug`, `sync_inventory_level`,
// `release_inventory_by_token`, `expire_inventory_reservations`) no están aquí
// a propósito: no se pueden llamar desde el bundle y listarlas invitaría a
// intentarlo. `availability_for_slug` sí, porque es la puerta ANÓNIMA de la
// vitrina, hermana de `price_quote_for_slug`.
export const INVENTORY_AVAILABILITY_RPC = 'inventory_availability'
export const AVAILABILITY_PUBLIC_RPC = 'availability_for_slug'
export const RESERVE_INVENTORY_RPC = 'reserve_inventory'
export const RELEASE_RESERVATION_RPC = 'release_inventory_reservation'
export const COMMIT_RESERVATION_RPC = 'commit_inventory_reservation'
export const ADJUST_INVENTORY_RPC = 'adjust_inventory'
export const SET_INVENTORY_POLICY_RPC = 'set_inventory_policy'
export const SEED_INVENTORY_RPC = 'seed_inventory_from_catalog'

// Carrito del servidor (P07-SaaS). Las tres son del COMPRADOR —anónimo o con
// sesión— y su autorización vive dentro: o el token de 256 bits, o la sesión
// del dueño. Las del pipeline (`checkout_begin`, `checkout_place_order`,
// `checkout_mark_stage`, `checkout_fail`) NO están aquí a propósito: solo se
// pueden llamar con `service_role` desde la Edge Function, y listarlas
// invitaría a intentarlo desde el bundle.
export const CART_OPEN_RPC = 'cart_open'
export const CART_REPLACE_LINES_RPC = 'cart_replace_lines'
export const CART_ABANDON_RPC = 'cart_abandon'
// Pedido rápido y CSV (cierre). Traduce `[{sku, quantity}]` a producto y
// variante con un motivo por fila; solo con sesión, porque el SKU no es
// público. No toca el carrito: las filas aceptadas entran por el carrito de
// siempre. Sin `satisfies` hasta regenerar los tipos: la red mientras tanto es
// `supabase/tests/quick-order-resolver.test.ts`.
export const RESOLVE_ORDER_LINES_RPC = 'resolve_order_lines_for_slug'

// --- Cierre · relaciones de producto en la vitrina (20260914140000) ---------
// Puerta ANÓNIMA: ids de relacionados publicados y visibles en el canal
// público, en el orden que fija el comercio. Sin `satisfies` hasta regenerar
// los tipos: la red mientras tanto es
// `supabase/tests/storefront-product-relations.test.ts`.
export const PRODUCT_RELATIONS_PUBLIC_RPC = 'product_relations_for_slug'
// --- fin relaciones ----------------------------------------------------------

// --- Cierre · reseñas y valoraciones (20260914141000) -----------------------
// `PRODUCT_REVIEWS_PUBLIC_RPC` es ANÓNIMA (solo publicadas + resumen). Enviar y
// leer la propia exigen sesión; moderar, rol de catálogo del tenant del JWT.
// La cola de moderación se lee de la TABLA (RLS de miembros). Sin `satisfies`
// hasta regenerar los tipos: la red es `supabase/tests/product-reviews.test.ts`.
export const PRODUCT_REVIEWS_TABLE = 'product_reviews'
export const PRODUCT_REVIEWS_PUBLIC_RPC = 'product_reviews_for_slug'
export const MY_PRODUCT_REVIEW_RPC = 'my_product_review'
export const SUBMIT_PRODUCT_REVIEW_RPC = 'submit_product_review'
export const MODERATE_PRODUCT_REVIEW_RPC = 'moderate_product_review'
// --- fin reseñas -------------------------------------------------------------

// OMS (P08-SaaS). Los COMANDOS del pedido. No hay ningún `update` directo sobre
// `orders` en `features/orders`: los tres ejes nuevos no tienen GRANT de
// escritura, así que `order_transition` no es la forma recomendada — es la
// única. `my_business_orders` no acepta id de cuenta, igual que
// `my_business_accounts`: es la puerta del aprobador B2B, que no es miembro del
// tenant y no ve una sola fila de `orders` por PostgREST.
export const ORDER_TRANSITION_RPC = 'order_transition'
export const ORDER_APPROVAL_DECIDE_RPC = 'order_approval_decide'
export const MY_BUSINESS_ORDERS_RPC = 'my_business_orders'
// Cuenta del CONSUMIDOR registrado (hardening H02-H04, migración 20260913100000).
// Las tres reciben el slug público de la tienda y nada más: el usuario sale del
// JWT y los pedidos, del vínculo que escribe el checkout (`order_buyers`).
// `checkout_link_order_buyer` NO está aquí a propósito: es de `service_role`.
//
// Release Candidate R02: los tipos se regeneraron desde una base LOCAL con todas
// las migraciones hasta 20260913160000 (`DB_TYPES_DB_URL`, ver
// `scripts/gen-db-types.mjs`), así que las constantes de H14 y N01–N06 ya llevan
// `satisfies`. Si alguien regenera contra un proyecto que NO tenga esas
// migraciones, el typecheck lo dirá aquí — que es la señal que se busca.
export const MY_CONSUMER_ORDERS_RPC = 'my_consumer_orders' satisfies FunctionName
export const MY_CONSUMER_ORDER_DETAIL_RPC = 'my_consumer_order_detail' satisfies FunctionName
export const MY_CHECKOUT_PROFILE_RPC = 'my_checkout_profile' satisfies FunctionName
// Libreta de direcciones del consumidor (N06, migración 20260913160000). Sin
// usuario por parámetro: sale del JWT; la tienda, por su slug.
export const MY_CONSUMER_ADDRESSES_RPC = 'my_consumer_addresses' satisfies FunctionName
export const SAVE_MY_CONSUMER_ADDRESS_RPC = 'save_my_consumer_address' satisfies FunctionName
export const DELETE_MY_CONSUMER_ADDRESS_RPC = 'delete_my_consumer_address' satisfies FunctionName
export const SET_DEFAULT_MY_CONSUMER_ADDRESS_RPC = 'set_default_my_consumer_address' satisfies FunctionName
// Contexto comercial de la sesión en una tienda (H05-H06, migración
// 20260913110000). Solo para PINTAR «cuenta comercial» o «comprando para»: la
// misma cuenta que usa el motor de precios, sin un precio ni un id de lista.
export const MY_COMMERCE_CONTEXT_RPC = 'my_commerce_context' satisfies FunctionName
// Cuenta B2B efectiva y selector multi-cuenta (N01, migración 20260913130000).
// El navegador PIDE comprar para una de sus cuentas; el servidor valida vínculo,
// estado y sociedad antes de guardar. `my_effective_business_account_for_slug`
// la usa el checkout (Edge Function), no la vitrina.
export const MY_STORE_BUSINESS_ACCOUNTS_RPC = 'my_store_business_accounts' satisfies FunctionName
export const SELECT_STORE_BUSINESS_ACCOUNT_RPC = 'select_store_business_account' satisfies FunctionName

// --- Cierre A3 · cotizaciones del comprador (migración 20260914101000) -------
// SIN `satisfies`: la migración aún no está en el proyecto contra el que se
// generan los tipos. La red de seguridad es `supabase/tests/quote-to-order.test.ts`.
// Ninguna acepta un id de cuenta ni de cliente: los resuelve la sesión.
/** Las cotizaciones del comprador en esta tienda, sin los borradores del vendedor. */
export const MY_QUOTES_RPC = 'my_quotes'
/** Aceptar: el precio pasa a acuerdo del motor y las líneas vuelven para el carrito. */
export const ACCEPT_QUOTE_RPC = 'accept_quote'
/** Pedir una cotización: borrador con precio de referencia del motor. */
export const REQUEST_QUOTE_RPC = 'request_quote'

// --- Cierre 4 · pedidos programados del comprador (migración 20260914130000) --
// SIN `satisfies` hasta regenerar los tipos; la red es
// `supabase/tests/scheduled-orders.test.ts`. El trabajo (`ebim.run_order_schedules`)
// es de servidor y no tiene constante aquí a propósito. Ninguna acepta cuenta,
// cliente ni tenant: la tienda por slug y la cuenta por la sesión.
/** Plantillas, programación y propuesta vigente de la cuenta en esta tienda. */
export const MY_ORDER_SCHEDULES_RPC = 'my_order_schedules'
/** Alta (idempotente por clave) o edición de plantilla + programación. */
export const SAVE_MY_ORDER_SCHEDULE_RPC = 'save_my_order_schedule'
/** Revisión previa (20260914192000): cada línea con ok/rechazada y su motivo. No escribe. */
export const CHECK_MY_ORDER_SCHEDULE_LINES_RPC = 'check_my_order_schedule_lines'

// Tiendas en autoservicio (20260917100000). Owner/admin de la sociedad ACTIVA;
// ninguna manda organización ni sociedad. Red de seguridad:
// `supabase/tests/store-management.test.ts`.
export const CREATE_STORE_RPC = 'create_store'
export const UPDATE_STORE_RPC = 'update_store'
export const SET_STORE_STATUS_RPC = 'set_store_status'

// --- Stores + Product Master · fase 04 (20260917130000) ---------------------
// El producto MAESTRO de la sociedad y su publicación por tienda. Sin
// `satisfies` hasta aplicar la migración y regenerar los tipos; la red es
// `supabase/tests/product-master-commands.test.ts`.
/** Un maestro por fila (sociedad activa) con el resumen de sus tiendas. */
export const ADMIN_PRODUCT_MASTERS_VIEW = 'admin_product_masters'
/**
 * Una fila por publicación (tienda × maestro) con sku, nombre, kind, marca y la
 * categoría/slug/estado/precio de ESA tienda. Es lo que ofrecen los selectores
 * de producto de pantallas por tienda (listas de precio, promociones, surtidos).
 */
export const ADMIN_STORE_PRODUCTS_VIEW = 'admin_store_products'
/** Todas las tiendas de la sociedad y la publicación del producto en cada una. */
export const PRODUCT_STORE_PUBLICATIONS_RPC = 'product_store_publications'
export const PUBLISH_PRODUCT_RPC = 'publish_product'
export const UPDATE_PRODUCT_PUBLICATION_RPC = 'update_product_publication'
export const UNPUBLISH_PRODUCT_RPC = 'unpublish_product'
/** Borrado del maestro: el servidor lo niega si sigue publicado o tiene historia. */
export const DELETE_PRODUCT_MASTER_RPC = 'delete_product_master'

// Importación del catálogo desde Excel (20260916100000). Las tres simulan con
// `p_dry_run = true` y aplican todo o nada con `false`. Red de seguridad:
// `supabase/tests/catalog-import.test.ts`.
export const IMPORT_CATALOG_VOCABULARY_RPC = 'import_catalog_vocabulary'
export const IMPORT_CATALOG_CATEGORIES_RPC = 'import_catalog_categories'
export const IMPORT_CATALOG_PRODUCTS_RPC = 'import_catalog_products'
/** Pausar o reanudar. */
export const SET_MY_ORDER_SCHEDULE_STATUS_RPC = 'set_my_order_schedule_status'
export const ARCHIVE_MY_ORDER_SCHEDULE_RPC = 'archive_my_order_schedule'
/** Pasar la propuesta al carrito: devuelve qué y cuánto, nunca un pedido. */
export const TAKE_MY_ORDER_SCHEDULE_RUN_RPC = 'take_my_order_schedule_run'
export const DISMISS_MY_ORDER_SCHEDULE_RUN_RPC = 'dismiss_my_order_schedule_run'

// --- Cierre 8 · recuperación de carritos (migración 20260914160000) -----------
// SIN `satisfies` hasta regenerar los tipos; la red es
// `supabase/tests/cart-recovery.test.ts`. El encolado (`ebim.enqueue_cart_recovery`)
// es de servidor y no tiene constante aquí a propósito.
/** Backoffice (owner/admin): el ajuste de la tienda y los números de 30 días. */
export const CART_RECOVERY_OVERVIEW_RPC = 'cart_recovery_overview'
/** Backoffice (owner/admin): encender, apagar y ajustar la ventana. */
export const CART_RECOVERY_CONFIGURE_RPC = 'cart_recovery_configure'
/** Tienda con sesión: ¿quiero recordatorios de carrito de esta tienda? */
export const MY_CART_REMINDERS_RPC = 'my_cart_reminders'
export const SET_MY_CART_REMINDERS_RPC = 'set_my_cart_reminders'
/** Tienda sin sesión: la baja de un clic con el secreto que trae el correo. */
export const CART_RECOVERY_UNSUBSCRIBE_RPC = 'cart_recovery_unsubscribe'

// Pagos (P09-SaaS). Las TRES que puede llamar el navegador con sesión, y su
// autorización vive dentro de cada una. Las del servidor —`payment_intent_open`,
// `payment_intent_attach_order`, `payment_apply_outcome`, `payment_refund_settle`—
// NO están aquí a propósito: solo se pueden llamar con `service_role` desde una
// Edge Function, y listarlas invitaría a intentarlo desde el bundle. Es la
// misma decisión que con el pipeline de checkout en P07.
export const REFUND_REQUEST_RPC = 'payment_refund_request'
export const RECONCILIATION_IMPORT_RPC = 'payment_reconciliation_import'
export const RECONCILIATION_MATCH_RPC = 'payment_reconciliation_match'

// Promociones (P10-SaaS). `promotion_quote_for_slug` y
// `gift_card_balance_for_slug` las llama el comprador ANÓNIMO desde la vitrina;
// `promotion_simulate` y los tres comandos de tarjeta regalo, el backoffice con
// sesión. `gift_card_redeem`, `gift_card_release` y `expire_gift_cards` NO
// están aquí a propósito: solo se pueden llamar con `service_role` desde una
// Edge Function —si el navegador pudiera canjear saldo, el importe a descontar
// lo decidiría el navegador— y listarlas invitaría a intentarlo.
export const PROMOTION_QUOTE_PUBLIC_RPC = 'promotion_quote_for_slug'
export const PROMOTION_SIMULATE_RPC = 'promotion_simulate'
export const GIFT_CARD_BALANCE_PUBLIC_RPC = 'gift_card_balance_for_slug'
export const GIFT_CARD_ISSUE_RPC = 'gift_card_issue'
export const GIFT_CARD_ADJUST_RPC = 'gift_card_adjust'
export const GIFT_CARD_CANCEL_RPC = 'gift_card_cancel'

// Contenido y búsqueda (P11-SaaS). Tres puertas ANÓNIMAS de la vitrina
// —`store_page_for_slug`, `store_navigation_for_slug`, `catalog_search_for_slug`
// y `catalog_suggest_for_slug`— y tres del backoffice con sesión. `content_preview`
// es la única forma de ver un BORRADOR y por eso `anon` no puede ejecutarla ni
// conociendo el uuid de la página. Ninguna función interna de resolución
// (`ebim.resolve_content`, `ebim.search_catalog`) está aquí: no son públicas.
export const STORE_PAGE_PUBLIC_RPC = 'store_page_for_slug'
export const STORE_NAVIGATION_PUBLIC_RPC = 'store_navigation_for_slug'
// Campañas vigentes SIN cupón. Nunca devuelve códigos ni cupos: lo que anuncia
// la portada tiene que aplicarse solo.
export const STORE_PROMOTIONS_PUBLIC_RPC = 'store_promotions_for_slug'
export const CATALOG_SEARCH_PUBLIC_RPC = 'catalog_search_for_slug'
/**
 * Storefront V2 · P08 · El ranking REAL de una tienda por unidades vendidas.
 *
 * Existe porque la portada titulaba «Lo más vendido» una lista que salía del
 * orden por relevancia del buscador. Devuelve solo `product_id` y su orden: ni
 * importes, ni unidades, ni un dato de nadie, y `anon` sigue sin GRANT sobre
 * `orders`. Sin ventas devuelve cero filas, y entonces la vitrina deja de decir
 * «lo más vendido».
 */
export const STORE_BEST_SELLERS_PUBLIC_RPC = 'store_best_sellers_for_slug'
export const CATALOG_SUGGEST_PUBLIC_RPC = 'catalog_suggest_for_slug'
export const CONTENT_PREVIEW_RPC = 'content_preview'
export const CATALOG_SEARCH_RPC = 'catalog_search'
export const STORE_DOMAIN_CLAIM_RPC = 'store_domain_claim'

// Fulfillment y devoluciones (P12-SaaS). `delivery_options_for_slug` es la
// puerta ANÓNIMA de la vitrina —hermana de `price_quote_for_slug` y de
// `availability_for_slug`— y `returns_by_token` y `return_request_for_slug` son
// las del comprador con el token de su pedido. El resto exige sesión y su
// autorización vive dentro de cada función. `shipment_apply_outcome` y
// `shipment_track_ingest` NO están aquí a propósito: son el resultado de hablar
// con un operador externo, solo se pueden llamar con `service_role` desde una
// Edge Function, y listarlas invitaría a intentarlo desde el bundle.
export const DELIVERY_OPTIONS_PUBLIC_RPC = 'delivery_options_for_slug'
export const DELIVERY_OPTIONS_ORDER_RPC = 'delivery_options_for_order'
export const FULFILLMENT_CREATE_RPC = 'fulfillment_create'
export const FULFILLMENT_ASSIGN_RPC = 'fulfillment_assign'
export const FULFILLMENT_TRANSITION_RPC = 'fulfillment_transition'
export const SHIPMENT_OPEN_RPC = 'shipment_open'
export const SHIPMENT_TRACK_NOTE_RPC = 'shipment_track_note'
export const RETURN_REQUEST_PUBLIC_RPC = 'return_request_for_slug'
export const RETURNS_BY_TOKEN_RPC = 'returns_by_token'
export const RETURN_OPEN_RPC = 'return_open'
export const RETURN_DECIDE_RPC = 'return_decide'
export const RETURN_RECEIVE_RPC = 'return_receive'
export const RETURN_INSPECT_RPC = 'return_inspect'
export const RETURN_COMPLETE_RPC = 'return_complete'
export const RETURN_CANCEL_RPC = 'return_cancel'
export const RETURN_EVIDENCE_ATTACH_RPC = 'return_evidence_attach'

// Analitica, auditoria y operacion (P13-SaaS). `track_events_for_slug` es la
// puerta ANÓNIMA de la vitrina —hermana de `price_quote_for_slug`— y solo
// admite tres tipos de hecho: los seis de servidor los emite un trigger y
// pedirlos desde el navegador es un error explícito.
//
// `ops_record_event` y `audit_record` NO están aquí a propósito: solo se pueden
// llamar con `service_role` desde una Edge Function —si el navegador pudiera
// escribir incidentes o entradas de auditoría, la bitácora sería redactable por
// quien la protagoniza— y listarlas invitaría a intentarlo desde el bundle. Es
// la misma decisión que P07 tomó con el pipeline de checkout.
export const TRACK_EVENTS_PUBLIC_RPC = 'track_events_for_slug'
export const ANALYTICS_KPIS_RPC = 'analytics_kpis'
export const ANALYTICS_TOP_PRODUCTS_RPC = 'analytics_top_products'
export const ANALYTICS_CHANNELS_RPC = 'analytics_channel_performance'
export const ANALYTICS_TIMESERIES_RPC = 'analytics_timeseries'
export const ANALYTICS_FUNNEL_RPC = 'analytics_funnel'
export const ANALYTICS_SEARCH_TERMS_RPC = 'analytics_search_terms'
export const OPS_HEALTH_RPC = 'ops_health'
export const OPS_RESOLVE_EVENT_RPC = 'ops_resolve_event'
export const TRACE_BY_CORRELATION_RPC = 'trace_by_correlation'

// P14. Las seis del monitor y de las credenciales. `api_token_issue`,
// `api_authenticate`, `api_rate_limit_hit` y las de idempotencia NO están:
// son del BORDE, solo las puede llamar `service_role` y nombrarlas aquí
// invitaría a intentarlo desde el bundle. Misma decisión que P07 con el
// pipeline de checkout y P13 con `ops_record_event`.
export const INTEGRATION_HEALTH_RPC = 'integration_health'
export const INTEGRATION_MESSAGE_DETAIL_RPC = 'integration_message_detail'
export const INTEGRATION_RETRY_RPC = 'integration_retry'
export const INTEGRATION_CIRCUIT_RESET_RPC = 'integration_circuit_reset'
export const WEBHOOK_REPLAY_RPC = 'webhook_replay'
export const API_CLIENT_CREATE_RPC = 'api_client_create'
export const API_CLIENT_ROTATE_SECRET_RPC = 'api_client_rotate_secret'

// --- Edge Functions --------------------------------------------------------
export const BOOTSTRAP_FUNCTION = 'bootstrap-tenant'
export const CATALOG_PRODUCT_FUNCTION = 'catalog-product'
// `create-order` sigue desplegada y sigue funcionando: es la puerta de P02 a
// P06 y ningún cliente antiguo se rompe. Lo que usa la vitrina desde P07 es
// `checkout`, que es la misma operación con clave de idempotencia delante.
export const CREATE_ORDER_FUNCTION = 'create-order'
export const CHECKOUT_FUNCTION = 'checkout'
/**
 * Asistente de compra de la vitrina. Devuelve texto e IDENTIFICADORES; el
 * precio, el stock y la foto los resuelve la vitrina contra el catálogo.
 */
export const SHOPPING_ASSISTANT_FUNCTION = 'shopping-assistant'
/** Redacta el borrador de la ficha de un producto (addon `ai.catalog.copy`). */
export const CATALOG_COPY_FUNCTION = 'catalog-copy'
/** Analista IA del dashboard (addon `ai.insights`, fase 02). Solo lee; nunca ejecuta. */
export const DASHBOARD_INSIGHTS_FUNCTION = 'dashboard-insights'
/**
 * Asistente IA de pedidos (funcionalidad `orders`, fase 04): resume, explica y
 * busca con filtros tipados. Solo lee; nunca cambia un estado.
 */
export const ORDERS_ASSISTANT_FUNCTION = 'orders-assistant'
/**
 * IA de inventario (funcionalidad `inventory`, fase 05): explica riesgo de
 * quiebre, exceso, inmovilizados, rotación y movimientos atípicos que calcula
 * el sistema. Solo lee; nunca ajusta existencias ni propone cantidades.
 */
export const INVENTORY_ASSISTANT_FUNCTION = 'inventory-assistant'
/**
 * IA de planificación (funcionalidad `planning`, fase 05): explica la previsión
 * existente frente a la venta y el sugerido de `suggest_order_v2`. No calcula
 * previsiones ni cantidades.
 */
export const PLANNING_ASSISTANT_FUNCTION = 'planning-assistant'
/**
 * IA de clientes (funcionalidad `customers`, fase 06): resumen 360 con los
 * datos que el rol puede ver (crédito solo con permiso). Solo lee.
 */
export const CUSTOMERS_ASSISTANT_FUNCTION = 'customers-assistant'
/**
 * IA de fuerza de ventas (funcionalidad `sales`, fase 06): preparar visita y
 * BORRADOR de seguimiento. Nunca envía nada.
 */
export const SALES_ASSISTANT_FUNCTION = 'sales-assistant'
/**
 * IA de cotizaciones y surtidos (funcionalidad `quotes`, fase 07): interpreta la
 * instrucción de un borrador y explica sugerencias de surtido del sistema. No
 * precia ni guarda: eso son `quote_draft_preview` / `quote_create_from_draft`.
 */
export const QUOTES_ASSISTANT_FUNCTION = 'quotes-assistant'
/**
 * IA de crédito y cobranza (funcionalidad `credit`, fase 08): explica la deuda
 * con cifras del sistema y redacta BORRADORES de recordatorio. No cambia
 * límites ni bloquea; no envía nada.
 */
export const CREDIT_ASSISTANT_FUNCTION = 'credit-assistant'
/**
 * IA de pagos (funcionalidad `payments`, fase 08): explica conciliación, fallos
 * y códigos técnicos. No marca como pagado ni altera transacciones.
 */
export const PAYMENTS_ASSISTANT_FUNCTION = 'payments-assistant'
/**
 * IA de entregas (funcionalidad `fulfillment`, fase 08): explica atrasos,
 * parciales e incidencias y redacta BORRADORES para el cliente. No despacha ni
 * cancela.
 */
export const FULFILLMENT_ASSISTANT_FUNCTION = 'fulfillment-assistant'
/**
 * IA de promociones (funcionalidad `promotions`, fase 09): BORRADORES de
 * nombre, copy y términos resumidos citando las reglas del motor, y
 * candidatos por regla. No propone descuentos ni guarda.
 */
export const PROMOTIONS_ASSISTANT_FUNCTION = 'promotions-assistant'
/**
 * IA del CMS (funcionalidad `content`, fase 09): BORRADORES de banner,
 * landing, SEO y traducción para el formulario. Nunca publica.
 */
export const CONTENT_ASSISTANT_FUNCTION = 'content-assistant'
/**
 * IA de reseñas (funcionalidad `reviews`, fase 09): resumen agregado, temas,
 * reseñas a revisar y BORRADOR de respuesta. No publica, oculta, borra ni
 * responde.
 */
export const REVIEWS_ASSISTANT_FUNCTION = 'reviews-assistant'
/**
 * Asistente técnico de operaciones (funcionalidad `operations`, fase 10):
 * resume y agrupa incidencias, interpreta un incidente con su hilo y sugiere
 * verificaciones. Datos saneados; no resuelve ni ejecuta nada.
 */
export const OPERATIONS_ASSISTANT_FUNCTION = 'operations-assistant'
/**
 * Asistente técnico de integraciones (funcionalidad `integrations`, fase 10):
 * interpreta errores de API/webhook/ERP, agrupa errores parecidos y detecta
 * patrones. Datos saneados; no reintenta, no reproduce ni modifica nada.
 */
export const INTEGRATIONS_ASSISTANT_FUNCTION = 'integrations-assistant'
/**
 * EBIM Copilot global (funcionalidad `copilot`, fase 11): capa de
 * herramientas de SOLO LECTURA (dashboard, ventas, pedidos, productos,
 * inventario, clientes) con el JWT de quien pregunta; cada herramienta exige
 * los roles y el módulo de su funcionalidad. No escribe nada.
 */
export const COPILOT_FUNCTION = 'copilot'
export const UPDATE_ORDER_STATUS_FUNCTION = 'update-order-status'
export const PLATFORM_CONTEXT_FUNCTION = 'platform-context'
// P12: la puerta por la que un operador logístico dice dónde va el paquete. No
// la llama el navegador: la llama un servidor y la autentica una FIRMA.
export const FULFILLMENT_WEBHOOK_FUNCTION = 'fulfillment-webhook'
// P14: la API de socio y el trabajador que vacía la cola. Tampoco las llama el
// navegador —la primera la llama el sistema de un tercero con su token, la
// segunda un planificador con la clave del trabajador— y están aquí solo para
// que el nombre del despliegue viva en un sitio.
export const API_FUNCTION = 'api'
export const INTEGRATION_WORKER_FUNCTION = 'integration-worker'
