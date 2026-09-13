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
// JWT y los pedidos, del vínculo que escribe el checkout (`order_buyers`). Sin
// `satisfies` hasta regenerar los tipos: la red es `consumer-account.test.ts`.
// `checkout_link_order_buyer` NO está aquí a propósito: es de `service_role`.
export const MY_CONSUMER_ORDERS_RPC = 'my_consumer_orders'
export const MY_CONSUMER_ORDER_DETAIL_RPC = 'my_consumer_order_detail'
export const MY_CHECKOUT_PROFILE_RPC = 'my_checkout_profile'
// Libreta de direcciones del consumidor (N06, migración 20260913160000). Sin
// usuario por parámetro: sale del JWT; la tienda, por su slug.
export const MY_CONSUMER_ADDRESSES_RPC = 'my_consumer_addresses'
export const SAVE_MY_CONSUMER_ADDRESS_RPC = 'save_my_consumer_address'
export const DELETE_MY_CONSUMER_ADDRESS_RPC = 'delete_my_consumer_address'
export const SET_DEFAULT_MY_CONSUMER_ADDRESS_RPC = 'set_default_my_consumer_address'
// Contexto comercial de la sesión en una tienda (H05-H06, migración
// 20260913110000). Solo para PINTAR «cuenta comercial» o «comprando para»: la
// misma cuenta que usa el motor de precios, sin un precio ni un id de lista.
export const MY_COMMERCE_CONTEXT_RPC = 'my_commerce_context'
// Cuenta B2B efectiva y selector multi-cuenta (N01, migración 20260913130000).
// El navegador PIDE comprar para una de sus cuentas; el servidor valida vínculo,
// estado y sociedad antes de guardar. `my_effective_business_account_for_slug`
// la usa el checkout (Edge Function), no la vitrina.
export const MY_STORE_BUSINESS_ACCOUNTS_RPC = 'my_store_business_accounts'
export const SELECT_STORE_BUSINESS_ACCOUNT_RPC = 'select_store_business_account'

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
