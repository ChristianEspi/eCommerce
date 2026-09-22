/**
 * Capacidades del producto y su resolución efectiva (P02-SaaS).
 *
 * Tres ejes que hasta P02 compartían la palabra «capability» y por eso se
 * confundían. Ahora cada uno tiene su nombre y su dueño:
 *
 * | Eje | Pregunta | Quién manda | Dónde vive |
 * |---|---|---|---|
 * | **Permiso** (`Permission`) | ¿este ROL puede hacerlo? | la app | `shared/lib/roles.ts` |
 * | **Entitlement** | ¿la cuenta CONTRATÓ el módulo? | el **hub** (contrato §5/§6) | cache local |
 * | **Flag** (`FeatureFlags`) | ¿está encendido técnicamente? | el tenant | `tenant_feature_flags` |
 *
 * `Capability` es la unidad TÉCNICA que gatea: un módulo del producto. El
 * `Capability` de los roles pasó a llamarse `Permission` en esta fase, que es
 * lo que siempre fue; el ADR 001 §«alternativas descartadas» dejó ese
 * renombrado asignado aquí, a la fase que introduce el tercer eje.
 *
 * Este archivo es DOMINIO: no sabe de Supabase, de React ni de qué addon
 * cuesta cuánto. El catálogo comercial —planes, precios, nombres de venta— es
 * del hub y no se replica (principio 2 del contrato). Lo que sí es de esta app
 * es saber QUÉ SABE HACER: eso es el registro de abajo.
 */
import type { BoundaryId } from './boundaries'

/**
 * Capacidades BASELINE: vienen con el producto. Un tenant con eCommerce activo
 * las tiene siempre, no se venden aparte y ningún flag las apaga.
 */
export const BASELINE_CAPABILITY_IDS = [
  'analytics.basic',
  'catalog',
  'checkout',
  'customers',
  'orders',
  'storefront',
] as const

/** Capacidades VENDIBLES: exigen un entitlement activo del hub. */
export const SELLABLE_CAPABILITY_IDS = [
  'analytics.advanced',
  'catalog.advanced',
  'content.cms',
  'content.white_label',
  'customers.b2b',
  'fulfillment',
  'integrations.enterprise',
  'inventory.multiwarehouse',
  'orders.advanced',
  'payments',
  'pricing.lists',
  'promotions',
  // Recorrido B2B, fase 02. La estructura comercial de campo: vendedor,
  // jerarquia y cartera. Sin ella el tenant SIGUE vendiendo como antes — nada
  // de lo nuevo es prerrequisito del checkout que ya existe.
  'sales.force',
  // Fase 03. El territorio COMERCIAL y la ruta de visita — distintos de
  // `delivery_zones`, que es logistica.
  'sales.territory',
  // Fase 04. La cobranza: documento, recibo, aplicacion y antiguedad.
  'credit.management',
  // Fase 06. La cotizacion comercial: documento con vigencia y estado.
  'trade.quotes',
  // Fase 08. Que puede comprar cada cliente del canal.
  'trade.assortments',
  // Fases 10 y 11. La hoja de ruta y la prueba de que llego.
  'fulfillment.routing',
  // Fases 12 y 13. Visitas, metas y comisiones: cierran `sales`.
  'sales.performance',
  // Fases 14 y 15. Sugerido y prevision de demanda.
  'planning.demand',
  // Fase 07. El comprobante fiscal, sobre el puerto que ya estaba escrito.
  'invoicing',
  // La IA. Unica capacidad con coste marginal POR USO, y por eso la unica que
  // ademas de contratarse se mide: el entitlement dice si puede, la cuota dice
  // cuanto. Ver `boundaries.ts` → frontera `ai`.
  'ai.assist',
  'ai.catalog.copy',
  'ai.insights',
  // EBIM_AI_SEQUENCE fase 01. Redactar contenido publicable (promociones, CMS,
  // respuestas a reseñas), siempre como borrador. Declarada: el hub tiene que
  // dar de alta `ecommerce.ai.content` y la fase 09 implementarla.
  'ai.content',
] as const

export const CAPABILITY_IDS = [
  ...BASELINE_CAPABILITY_IDS,
  ...SELLABLE_CAPABILITY_IDS,
] as const

export type BaselineCapabilityId = (typeof BASELINE_CAPABILITY_IDS)[number]
export type SellableCapabilityId = (typeof SELLABLE_CAPABILITY_IDS)[number]
export type CapabilityId = BaselineCapabilityId | SellableCapabilityId

/**
 * Un código de addon del hub. Deliberadamente `string` y no una unión: el hub
 * es el dueño del catálogo y puede devolver códigos que esta app no conoce
 * —de otra app de la suite, o de un módulo que aún no implementa—. Tiparlo
 * cerrado obligaría a esta app a declarar el catálogo ajeno, que es justo lo
 * que el contrato §6 prohíbe.
 */
export type EntitlementCode = string

/** Estado REAL de la capacidad en el producto, no la intención. */
export type CapabilityState = 'implemented' | 'partial' | 'declared'

export interface Capability {
  readonly id: CapabilityId
  /**
   * Nombre en castellano, para las pantallas.
   *
   * El `id` NO se traduce: es la clave que empareja con `entitlement_code`
   * en el hub y con la frontera del codigo. Ensenarlo como unico nombre
   * obligaba a leer ingles tecnico para saber que es cada modulo, asi que
   * ahora manda este y el `id` queda debajo, en pequeno, para quien tenga que
   * cruzarlo con el catalogo de addons.
   */
  readonly name: string
  /** Frontera de `boundaries.ts` que la implementa. */
  readonly boundary: BoundaryId
  /** `null` = baseline: viene con el producto y no se vende aparte. */
  readonly entitlement: EntitlementCode | null
  readonly state: CapabilityState
  /** Qué deja de poder hacer el tenant si no la tiene. */
  readonly grants: string
  /**
   * Fallback de transición (cierre D3, migración `20260914180000`): la
   * capacidad cuenta como contratada para una sociedad que el hub NUNCA
   * sincronizó. Solo lo llevan las tres que nacieron sin candado de servidor
   * (ADR 017); con contexto sincronizado manda la lista de entitlements.
   * Espejo de `app_capabilities.legacy_until_synced`.
   */
  readonly legacyUntilSynced?: true
}

/**
 * Prefijo propuesto para los códigos de addon de esta app en el hub.
 *
 * **Provisional.** El alta de `ecommerce` en la suite y su catálogo de addons
 * los hace el operador (SAAS_ROADMAP §5.1); hasta entonces estos son los
 * códigos que esta app ESPERA, no los que el hub confirma. Cuando el catálogo
 * exista y no coincida, lo que cambia es esta constante y la columna
 * `entitlement_code` de `app_capabilities` — ni una línea de gating.
 */
export const ENTITLEMENT_PREFIX = 'ecommerce.'

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'catalog',
    name: 'Catálogo',
    boundary: 'catalog',
    entitlement: null,
    state: 'implemented',
    grants: 'Productos, categorías e imágenes con publicación por tienda.',
  },
  {
    id: 'storefront',
    name: 'Tienda pública',
    boundary: 'content',
    entitlement: null,
    state: 'implemented',
    grants: 'Vitrina pública por slug con catálogo, ficha y marca del tenant.',
  },
  {
    id: 'checkout',
    name: 'Compra y pago',
    boundary: 'checkout',
    entitlement: null,
    state: 'implemented',
    grants: 'Carrito y creación de pedido por un comprador anónimo.',
  },
  {
    id: 'orders',
    name: 'Pedidos',
    boundary: 'orders',
    entitlement: null,
    // BASELINE, y sigue siéndolo tras P08-SaaS. Los cuatro ejes de estado, la
    // línea de tiempo, los snapshots inmutables y las referencias externas no
    // son un módulo aparte: son lo que un pedido tiene que ser para que su
    // historial resista que cambie el catálogo. Cobrar por «la versión que no
    // miente» no sería vender un módulo.
    state: 'implemented',
    grants:
      'Gestión del pedido: estados de pedido, pago y entrega, línea de tiempo, ' +
      'snapshots inmutables, referencias externas y consulta por el comprador.',
  },
  {
    // VENDIBLE y `declared` (P08-SaaS). Lo que se vende no es gestionar el
    // pedido, es que los pedidos se creen SOLOS: programados, repetidos e
    // importados en masa. La capacidad se registra ahora —y las tablas NO— para
    // que el operador pueda dar de alta el addon en el hub sin esperar al
    // código; el ADR 008 escribe el disparador de cada una de las tres.
    id: 'orders.advanced',
    name: 'Pedidos avanzados',
    boundary: 'orders',
    entitlement: `${ENTITLEMENT_PREFIX}orders.advanced`,
    // Recorrido B2B, fase 05: deja de estar `declared`. Lo que la llena no es
    // un motor nuevo —el de aprobacion ya existia, igual que la idempotencia
    // por fila y la referencia externa— sino lo unico que faltaba de verdad:
    // la plantilla de pedido y su programacion con estado.
    state: 'implemented',
    grants: 'Pedidos programados, repetición de pedido e importación masiva.',
  },
  {
    id: 'analytics.basic',
    name: 'Indicadores básicos',
    boundary: 'analytics',
    entitlement: null,
    state: 'implemented',
    grants: 'Indicadores agregados del panel de inicio.',
  },
  {
    id: 'customers',
    name: 'Clientes',
    boundary: 'customers',
    // BASELINE (P05-SaaS). Guardar a quién le vendiste viene con el producto:
    // cobrar aparte por poder anotar el correo del comprador no sería un
    // módulo, sería un peaje, y dejaría a un tenant sin plan sin poder atender
    // una devolución. Lo vendible es la CUENTA B2B, no la ficha.
    entitlement: null,
    state: 'implemented',
    grants: 'Ficha de cliente con contactos, direcciones, segmento e identificadores externos.',
  },
  {
    id: 'catalog.advanced',
    name: 'Catálogo avanzado',
    boundary: 'catalog',
    entitlement: `${ENTITLEMENT_PREFIX}catalog.advanced`,
    // La primera vendible que deja de ser `declared` (P03-SaaS): tiene esquema,
    // pantalla y pedido detras. El `state` dice la verdad sobre el producto HOY,
    // y un test de paridad lo compara contra la fila de `app_capabilities`.
    state: 'implemented',
    grants: 'Variantes, atributos, unidades de venta y kits sobre un producto maestro unico.',
    legacyUntilSynced: true,
  },
  {
    id: 'pricing.lists',
    name: 'Listas de precios',
    boundary: 'pricing',
    entitlement: `${ENTITLEMENT_PREFIX}pricing.lists`,
    // La segunda vendible que deja de ser `declared` (P04-SaaS): tiene esquema,
    // motor determinista, pantalla y pedido detras. Sin ella, la resolucion
    // devuelve el precio de catalogo — no falla, se degrada.
    state: 'implemented',
    grants:
      'Listas de precio por canal, segmento, cliente, cantidad, moneda y vigencia, con precedencia documentada.',
  },
  {
    id: 'customers.b2b',
    name: 'Cuentas de empresa',
    boundary: 'customers',
    entitlement: `${ENTITLEMENT_PREFIX}customers.b2b`,
    // La tercera vendible que deja de ser `declared` (P05-SaaS): cuentas con
    // varios usuarios, sucursales, roles y límites de autorización, con su
    // enforcement en las policies. El crédito NO entra: es lógica de ERP.
    state: 'implemented',
    grants:
      'Cuentas de empresa con varios usuarios, sucursales, roles y límites de autorización por monto.',
  },
  {
    id: 'inventory.multiwarehouse',
    name: 'Inventario multialmacén',
    boundary: 'inventory',
    entitlement: `${ENTITLEMENT_PREFIX}inventory.multiwarehouse`,
    // La cuarta vendible que deja de ser `declared` (P06-SaaS): almacenes,
    // movimientos trazables, reservas con caducidad y ATP por almacén, con su
    // enforcement en las policies. Sin ella el tenant sigue vendiendo contra
    // `products.stock` — no falla, se degrada, igual que el motor de precios.
    state: 'implemented',
    grants:
      'Existencias por almacén y variante, movimientos trazables, reservas con caducidad y disponibilidad prometida (ATP).',
  },
  {
    id: 'payments',
    name: 'Cobros en línea',
    boundary: 'payments',
    entitlement: `${ENTITLEMENT_PREFIX}payments`,
    // P09-SaaS: el dominio existe entero —intento, intentos de llamada, cobro,
    // devolución, bitácora y conciliación—, con su contrato canónico de
    // pasarela y el conector `sandbox` desplegado. Lo que falta para cobrar de
    // verdad es una decisión del operador (qué pasarela), no código.
    state: 'implemented',
    grants: 'Cobro en línea: autorización, captura, devolución y conciliación (P09).',
    legacyUntilSynced: true,
  },
  {
    id: 'promotions',
    name: 'Promociones',
    boundary: 'promotions',
    entitlement: `${ENTITLEMENT_PREFIX}promotions`,
    state: 'implemented',
    grants:
      'Campañas con prioridad y combinación explícitas, cupones, tarjetas regalo y desglose de descuento sobre el precio base (P10).',
  },
  {
    id: 'sales.force',
    name: 'Fuerza de ventas',
    boundary: 'sales',
    entitlement: `${ENTITLEMENT_PREFIX}sales.force`,
    // Recorrido B2B, fase 02. La primera pieza de la operación comercial de
    // campo, y la que desbloquea territorios, rutas, visitas, metas y
    // comisiones: todas cuelgan de que exista un vendedor y una cartera.
    //
    // Se degrada como el resto: sin la capacidad el tenant sigue vendiendo
    // exactamente como antes. Nada de esto es prerrequisito del checkout.
    state: 'implemented',
    grants:
      'Fuerza de ventas: vendedores con jerarquía sin ciclos y cartera de clientes con un solo titular por cuenta.',
  },
  {
    id: 'sales.territory',
    name: 'Territorios de venta',
    boundary: 'sales',
    entitlement: `${ENTITLEMENT_PREFIX}sales.territory`,
    // Fase 03. El territorio es COMERCIAL y por eso es una tabla propia:
    // reutilizar `delivery_zones` ataria la cartera de un vendedor al recorrido
    // de un camion, y cambiar una ruta de reparto moveria comisiones.
    state: 'implemented',
    grants:
      'Territorios con jerarquía sin ciclos, cobertura por vendedor y rutas de visita con orden único.',
  },
  {
    id: 'credit.management',
    name: 'Gestión de crédito',
    boundary: 'credit',
    entitlement: `${ENTITLEMENT_PREFIX}credit.management`,
    // Fase 04. El saldo lo mantiene la base con un trigger y no quien inserta:
    // si lo escribiera la aplicacion, existiria la ruta que se olvida —una
    // carga masiva, una correccion a mano— y el saldo dejaria de ser cierto sin
    // que nada fallara.
    state: 'implemented',
    grants:
      'Documento por cobrar con vencimiento y saldo, cobros con aplicación N:M y antigüedad de saldos por cliente.',
  },
  {
    id: 'trade.quotes',
    name: 'Cotizaciones',
    boundary: 'trade',
    entitlement: `${ENTITLEMENT_PREFIX}trade.quotes`,
    // Fase 06. Guarda lo que el motor de precios devolvio, con su fecha; no
    // calcula. Dos verdades sobre el precio discreparian el dia que alguien
    // toque una lista.
    state: 'implemented',
    grants:
      'Cotizaciones con vigencia, estado que solo avanza y líneas con la forma del pedido para convertir sin traducir.',
  },
  {
    id: 'trade.assortments',
    name: 'Surtidos por cliente',
    boundary: 'trade',
    entitlement: `${ENTITLEMENT_PREFIX}trade.assortments`,
    // Fase 08. Calca `price_list_assignments`, que resuelve el mismo problema
    // —«que aplica a quien, con precedencia»— y cuya forma ya esta probada.
    // Inventar otra para lo mismo obliga a aprender dos.
    state: 'implemented',
    grants:
      'Surtido por cliente, segmento, territorio, canal o tienda, en lista blanca o negra, con precedencia resuelta en un solo sitio.',
  },
  {
    id: 'fulfillment.routing',
    name: 'Enrutado de entregas',
    boundary: 'fulfillment',
    entitlement: `${ENTITLEMENT_PREFIX}fulfillment.routing`,
    // Fases 10 y 11. Extiende el despacho que ya existe: la parada apunta al
    // `fulfillment`, no crea uno paralelo. Y la evidencia es append-only —una
    // firma que se puede cambiar despues no prueba nada.
    state: 'implemented',
    grants:
      'Planificación de reparto con vehículo y orden de visita, y evidencia de entrega inmutable con firma, geoposición y fotos.',
  },
  {
    id: 'sales.performance',
    name: 'Desempeño comercial',
    boundary: 'sales',
    entitlement: `${ENTITLEMENT_PREFIX}sales.performance`,
    // Fases 12 y 13. La liquidacion pagada es INMUTABLE: es dinero de terceros,
    // y recalcular una cerrada porque cambio una regla es como se pierde la
    // confianza de una fuerza de ventas. Se corrige con un ajuste del periodo
    // siguiente, como cualquier nomina.
    state: 'implemented',
    grants:
      'Visitas con agenda y hecho separados, metas por vendedor o territorio, reglas de comisión y liquidaciones inmutables una vez pagadas.',
  },
  {
    id: 'planning.demand',
    name: 'Planificación de demanda',
    boundary: 'planning',
    entitlement: `${ENTITLEMENT_PREFIX}planning.demand`,
    // Fases 14 y 15. La sugerencia devuelve filas con su motivo y no crea
    // pedidos; el forecast guarda con que modelo y cuando se calculo, para que
    // una prevision no se confunda nunca con una venta real.
    state: 'implemented',
    grants:
      'Recomendación de pedido con motivo auditable y previsión de demanda por producto, periodo, territorio y modelo.',
  },
  {
    id: 'invoicing',
    name: 'Facturación',
    boundary: 'credit',
    entitlement: `${ENTITLEMENT_PREFIX}invoicing`,
    // Fase 07. Implementa el puerto `InvoicingProvider`, que ya estaba escrito
    // y dejaba anotada su precondicion: impuesto POR LINEA. Se llena copiando
    // del pedido, nunca recalculando — el IGV de una factura es el del dia de
    // la venta, y una tasa que cambia en enero no reescribe una de diciembre.
    state: 'implemented',
    grants:
      'Comprobante fiscal con impuesto por línea copiado del pedido, su bitácora de estados y la inmutabilidad de lo ya aceptado.',
  },
  {
    id: 'ai.assist',
    name: 'Asistencia con IA',
    boundary: 'ai',
    entitlement: `${ENTITLEMENT_PREFIX}ai.assist`,
    // La unica capacidad que se MIDE y no solo se contrata. El entitlement dice
    // si la sociedad puede; la cuota de `ai_quotas` dice cuanto. Contratada sin
    // configurar NO significa sin limite: cae al bucket de prueba, porque un
    // modulo de pago activado sin tope es una factura abierta.
    state: 'implemented',
    grants:
      'Asistente de compra sobre el catálogo real, con cuota por sociedad, consumo atómico y traza auditable de qué se preguntó y si sirvió.',
  },
  {
    id: 'ai.catalog.copy',
    name: 'Redacción de fichas con IA',
    boundary: 'ai',
    entitlement: `${ENTITLEMENT_PREFIX}ai.catalog.copy`,
    // Addon aparte del asistente y no una extensión suya: son dos productos
    // que se venden por separado, y hasta esta fase contratar uno abría el
    // otro sin que nadie lo decidiera.
    //
    // Redacta la PRESENTACIÓN —forma, concentración, contenido del envase,
    // laboratorio— y nunca la indicación terapéutica. En un catálogo donde 181
    // de las 281 fichas vacías son medicamentos, un modelo escribiendo «para
    // qué sirve» no es una función de producto, es un problema sanitario. El
    // texto sale como borrador que una persona aprueba.
    state: 'implemented',
    grants:
      'Borrador de ficha de producto a partir de su nombre, marca y categoría, limitado a la presentación y revisado por una persona antes de guardarse.',
  },
  {
    id: 'ai.insights',
    name: 'Análisis y alertas con IA',
    boundary: 'ai',
    entitlement: `${ENTITLEMENT_PREFIX}ai.insights`,
    // Lee indicadores que YA calcula la base y dice cuáles merecen atención.
    // No inventa cifras: recibe las filas resueltas y devuelve cuáles señalar y
    // por qué, con la misma regla de lista cerrada que el asistente.
    // Desde la fase 01 de EBIM_AI_SEQUENCE paga también las explicaciones por
    // módulo (pedidos, inventario, clientes, cobranza, operaciones…): todas
    // leen cifras que ya calculó la base y ninguna decide nada. Cada una exige
    // además su módulo contratado (`ebim.ai_module_capability_for`).
    state: 'implemented',
    grants:
      'Lectura de los indicadores de la tienda para señalar qué merece atención, sobre cifras calculadas por la base y nunca por el modelo.',
  },
  {
    id: 'ai.content',
    name: 'Redacción de contenido con IA',
    boundary: 'ai',
    entitlement: `${ENTITLEMENT_PREFIX}ai.content`,
    // Declarada en la fase 01 de EBIM_AI_SEQUENCE; la implementa la fase 09.
    // Borradores de promociones, páginas y respuestas a reseñas que una
    // persona revisa y publica por el flujo normal: la IA no publica nada.
    state: 'declared',
    grants:
      'Borradores de textos de promociones, contenido de la vitrina y respuestas a reseñas, que una persona revisa antes de publicar.',
  },
  {
    id: 'content.cms',
    name: 'Gestor de contenido',
    boundary: 'content',
    entitlement: `${ENTITLEMENT_PREFIX}content.cms`,
    // La sexta vendible que deja de ser `declared` (P11-SaaS): páginas, bloques
    // con vigencia/canal/segmento, colecciones con FK de verdad, editor con
    // vista previa y búsqueda con sinónimos. Sin ella la vitrina cae a lo que
    // pintaba antes —hero de `store_settings` y catálogo— no falla: se degrada,
    // igual que el motor de precios, el inventario y las promociones.
    state: 'implemented',
    grants:
      'Páginas, colecciones y bloques editables de la vitrina, con vigencia, canal y segmento, más los sinónimos de búsqueda (P11).',
  },
  {
    id: 'content.white_label',
    name: 'Marca blanca',
    boundary: 'content',
    entitlement: `${ENTITLEMENT_PREFIX}content.white_label`,
    // Estaba `implemented` desde P02 con un solo interruptor (`white_label`).
    // P11 no cambia su estado —ya estaba hecha— sino CUÁNTO cubre: tipografía,
    // identidad de correo y dominio propio. Lo que NO gatea sigue siendo el
    // acento, el logo, el favicon, el radio y la densidad: eso es tematización
    // y el lockup de la suite sigue puesto.
    state: 'implemented',
    grants:
      'Vitrina y correo sin la firma de la suite: tipografía de la whitelist, identidad de correo y dominio propio. El contrato §4.3 ya lo declara addon premium.',
  },
  {
    id: 'fulfillment',
    name: 'Entregas y devoluciones',
    boundary: 'fulfillment',
    entitlement: `${ENTITLEMENT_PREFIX}fulfillment`,
    // La séptima vendible que deja de ser `declared` (P12-SaaS). Sin ella el
    // comercio sigue vendiendo exactamente como antes: `create_order` sin
    // `p_delivery` cobra transporte cero y no planifica entrega, así que el
    // pedido nace igual que en P11 y el backoffice lo mueve a mano por
    // `orders.status`. Se degrada, no se rompe — el mismo trato que el motor de
    // precios, el inventario, las promociones y el CMS.
    state: 'implemented',
    grants:
      'Zonas y métodos de entrega con tarifa server-side, ventanas, puntos de recojo, cola de preparación, seguimiento normalizado y devoluciones con reposición (P12).',
    legacyUntilSynced: true,
  },
  {
    id: 'analytics.advanced',
    name: 'Analítica avanzada',
    boundary: 'analytics',
    entitlement: `${ENTITLEMENT_PREFIX}analytics.advanced`,
    // La séptima vendible que deja de ser `declared` (P13-SaaS): embudo de los
    // nueve hechos canónicos y términos de búsqueda, con su gate en la base
    // (`ebim.assert_analytics_advanced`) y no solo en la pantalla. Sin ella el
    // tenant conserva ventas, pedidos, ticket, productos y canal, que salen de
    // `orders` y son baseline: se degrada, no se rompe.
    //
    // Las COHORTES no entran y no se fingen: exigirían seguir a un comprador
    // identificado en el tiempo, y la analítica de esta app se guarda SIN PII a
    // propósito. Queda escrito en el ADR 013 en vez de dejar una función vacía
    // para que la casilla quede marcada.
    state: 'implemented',
    grants:
      'Embudo de conversión sobre los nueve hechos canónicos y términos de ' +
      'búsqueda con resultados vacíos, exportables.',
  },
  {
    id: 'integrations.enterprise',
    name: 'Integraciones corporativas',
    boundary: 'integrations',
    entitlement: `${ENTITLEMENT_PREFIX}integrations.enterprise`,
    // P14-SaaS. Deja de ser `partial`: hasta aquí existía el transporte —outbox,
    // reintentos, disyuntor— y no existía forma de que un tercero lo usara. Lo
    // que faltaba no era más SQL: eran credenciales con permisos, una API
    // versionada, suscripciones a eventos y una pantalla para operar los fallos.
    //
    // El addon cubre PUBLICAR. **No** cubre mirar: el monitor de integraciones
    // está fuera, igual que `/app/operations` en P13 — quien no puede ver por
    // qué le fallan las integraciones acaba llamando por teléfono.
    state: 'implemented',
    grants:
      'Habilitar conectores, credenciales de la API de socio con permisos por ' +
      'operación y suscripciones de webhook por evento.',
  },
]

const BY_ID = new Map<CapabilityId, Capability>(CAPABILITIES.map((c) => [c.id, c]))

export function capability(id: CapabilityId): Capability {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Capacidad no declarada: ${id}`)
  return found
}

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && BY_ID.has(value as CapabilityId)
}

export function isBaselineCapability(id: CapabilityId): boolean {
  return capability(id).entitlement === null
}

/** Código de addon que concede la capacidad, o `null` si es baseline. */
export function entitlementFor(id: CapabilityId): EntitlementCode | null {
  return capability(id).entitlement
}

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------

/** Contexto tal y como lo devuelve el hub (§5) o la cache local. */
export interface PlatformContextInput {
  /** ¿La cuenta tiene eCommerce activo? `app_active` del contrato §5. */
  readonly appActive: boolean
  /** Códigos de addon ACTIVOS. Los que esta app no conoce se ignoran. */
  readonly entitlements: readonly EntitlementCode[]
  /** Interruptores técnicos del tenant. Solo restan. */
  readonly flags?: Readonly<Record<string, boolean>>
  /**
   * ¿El hub (o el aprovisionamiento) sincronizó alguna vez esta sociedad?
   * `false` = no hay fila en `tenant_platform_context` (`source: 'sin-contexto'`),
   * y entonces las capacidades con `legacyUntilSynced` cuentan como
   * contratadas. Por omisión `true`: el caso estricto.
   */
  readonly synced?: boolean
}

export interface CapabilityResolution {
  /** Lo que el tenant puede usar ahora mismo. */
  readonly capabilities: readonly CapabilityId[]
  /** Lo contratado, antes de aplicar flags. */
  readonly entitled: readonly CapabilityId[]
  /** Contratado pero apagado por un flag técnico. */
  readonly disabledByFlag: readonly CapabilityId[]
  /** Códigos que el hub devolvió y esta versión de la app no reconoce. */
  readonly unknownEntitlements: readonly EntitlementCode[]
}

/**
 * Capacidad efectiva = app activa AND (baseline OR entitlement OR fallback
 * legado) AND flag ≠ false, donde fallback legado = `legacyUntilSynced` y
 * sociedad nunca sincronizada (`synced: false`).
 *
 * Tres decisiones que no son obvias y que un test fija:
 *
 * 1. **`appActive: false` no deja ni lo baseline.** Si el hub dice que la
 *    cuenta no tiene esta app, no hay nada que gatear: no es un tenant con
 *    plan mínimo, es un tenant que no es cliente de eCommerce.
 * 2. **Un flag jamás concede.** `flags['payments'] = true` sin el addon no
 *    enciende nada. Si pudiera, la pantalla de ajustes del propio cliente
 *    sería un sistema de facturación en la sombra.
 * 3. **Un flag no apaga lo baseline.** Un interruptor capaz de dejar la tienda
 *    sin catálogo desde los ajustes del tenant es un botón de caída.
 *
 * Función PURA: no consulta nada. La autoridad real es `ebim.has_capability`
 * en la base, que aplica exactamente esta misma composición dentro de las
 * policies; esto es lo que permite que la UI no pida permiso por cada botón.
 */
export function resolveCapabilities(input: PlatformContextInput): CapabilityResolution {
  const flags = input.flags ?? {}

  if (!input.appActive) {
    return {
      capabilities: [],
      entitled: [],
      disabledByFlag: [],
      unknownEntitlements: [...input.entitlements].sort(),
    }
  }

  const active = new Set(input.entitlements)
  const known = new Set(
    CAPABILITIES.map((c) => c.entitlement).filter((code): code is string => code !== null),
  )

  const entitled: CapabilityId[] = []
  const capabilities: CapabilityId[] = []
  const disabledByFlag: CapabilityId[] = []

  const synced = input.synced ?? true

  for (const item of CAPABILITIES) {
    const isBaseline = item.entitlement === null
    const legacy = !synced && item.legacyUntilSynced === true
    if (!isBaseline && !legacy && !active.has(item.entitlement as string)) continue

    entitled.push(item.id)
    if (!isBaseline && flags[item.id] === false) disabledByFlag.push(item.id)
    else capabilities.push(item.id)
  }

  const unknownEntitlements = [...active].filter((code) => !known.has(code)).sort()

  return {
    capabilities: capabilities.sort(),
    entitled: entitled.sort(),
    disabledByFlag: disabledByFlag.sort(),
    unknownEntitlements,
  }
}

/** Atajo de lectura. Sin capacidad resuelta no hay módulo: la duda es «no». */
export function hasCapability(
  resolution: Pick<CapabilityResolution, 'capabilities'> | null | undefined,
  id: CapabilityId,
): boolean {
  if (!resolution) return false
  return resolution.capabilities.includes(id)
}
