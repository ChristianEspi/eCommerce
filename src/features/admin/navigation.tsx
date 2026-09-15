import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import AltRouteRoundedIcon from '@mui/icons-material/AltRouteRounded'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded'
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import RequestQuoteRoundedIcon from '@mui/icons-material/RequestQuoteRounded'
import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import PriceChangeRoundedIcon from '@mui/icons-material/PriceChangeRounded'
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import WarehouseRoundedIcon from '@mui/icons-material/WarehouseRounded'
import type { ReactNode } from 'react'
import type { CapabilityId } from '@/domain'
import type { MessageKey } from '@/shared/i18n/messages'
import type { Permission } from '@/shared/lib/roles'
import type { Crumb } from '@/shared/ui/AppBreadcrumbs'

/** Los bloques del sidebar. El orden de `NAV_GROUPS` manda, no este tipo. */
export type NavGroupId = 'catalog' | 'inventory' | 'customers' | 'sales' | 'store' | 'system'

export interface NavItem {
  to: string
  label: MessageKey
  icon: ReactNode
  end?: boolean
  /** Módulo que la sociedad tiene que tener contratado y activo (P02-SaaS). */
  capability?: CapabilityId
  /** Permiso de rol. Ortogonal a la capacidad: hacen falta los dos. */
  permission?: Permission
  /**
   * Bloque bajo el que se pinta. Sin grupo se pinta arriba del todo y sin
   * cabecera: es el sitio de Inicio, que no pertenece a ninguna familia porque
   * las resume todas.
   */
  group?: NavGroupId
}

/**
 * Las cabeceras, en el orden en que se pintan.
 *
 * Son SEPARADORES, no botones: no se pliegan ni se navegan. La razón es que
 * dieciséis de las pantallas del backoffice ya llevan `SectionTabs` dentro, así
 * que un grupo plegable metería un tercer nivel (grupo → módulo → pestaña) y
 * cada clic de más es una pantalla que alguien deja de encontrar. Agrupar sin
 * plegar no acorta el menú —lo alarga un poco—, pero parte una lista de
 * veintidós entradas en bloques de dos a cinco, que es lo que se escanea de un
 * vistazo.
 */
export const NAV_GROUPS: readonly { id: NavGroupId; label: MessageKey }[] = [
  { id: 'catalog', label: 'nav.group.catalog' },
  { id: 'inventory', label: 'nav.group.inventory' },
  { id: 'customers', label: 'nav.group.customers' },
  { id: 'sales', label: 'nav.group.sales' },
  { id: 'store', label: 'nav.group.store' },
  { id: 'system', label: 'nav.group.system' },
]

/**
 * Navegación del backoffice. Fuente única del sidebar y de las migas.
 *
 * `capability` no es decoración: si el hub declara que la cuenta no tiene
 * eCommerce activo (`app_active: false`), estos módulos dejan de listarse y su
 * ruta pinta el estado «no contratado» en vez de un listado vacío que parece
 * un fallo. Configuración se queda SIN capacidad a propósito: hay que poder
 * llegar a los ajustes aunque no haya un solo módulo contratado, si no la
 * única salida de un tenant mal configurado sería llamar por teléfono.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    to: '/app',
    label: 'nav.dashboard',
    icon: <SpaceDashboardRoundedIcon fontSize="small" />,
    end: true,
    capability: 'analytics.basic',
  },
  {
    to: '/app/products',
    label: 'nav.products',
    icon: <Inventory2RoundedIcon fontSize="small" />,
    capability: 'catalog',
    group: 'catalog',
  },
  {
    to: '/app/categories',
    label: 'nav.categories',
    icon: <CategoryRoundedIcon fontSize="small" />,
    capability: 'catalog',
    group: 'catalog',
  },
  {
    to: '/app/pim',
    label: 'nav.pim',
    icon: <TuneRoundedIcon fontSize="small" />,
    capability: 'catalog.advanced',
    group: 'catalog',
  },
  // --- Cierre · moderación de reseñas ---
  {
    // Con el catálogo: lo que se modera es lo que opinan de un producto, y
    // quien lo decide es el rol que lo edita (`catalog.write`).
    to: '/app/reviews',
    label: 'nav.reviews',
    icon: <RateReviewRoundedIcon fontSize="small" />,
    capability: 'catalog',
    permission: 'catalog.write',
    group: 'catalog',
  },
  // --- fin reseñas ---
  {
    to: '/app/pricing',
    label: 'nav.pricing',
    icon: <PriceChangeRoundedIcon fontSize="small" />,
    capability: 'pricing.lists',
    group: 'catalog',
  },
  // --- Cierre · item 7 · Canales de venta ----------------------------------
  {
    // Con el catalogo y al lado de Precios: un canal decide por donde se vende
    // el catalogo unico, y es la dimension con la que se tarifa. Capacidad
    // `catalog` (baseline) porque los canales existen desde P10 para todos;
    // permiso `store.manage` porque abrir un canal o cambiar el de defecto
    // decide por donde vende la tienda publica.
    to: '/app/channels',
    label: 'nav.channels',
    icon: <AltRouteRoundedIcon fontSize="small" />,
    capability: 'catalog',
    permission: 'store.manage',
    group: 'catalog',
  },
  {
    // Con el catálogo y no con las ventas: una promoción se define sobre el
    // producto y el precio, y quien la monta viene de ajustar tarifas.
    to: '/app/promotions',
    label: 'nav.promotions',
    icon: <LocalOfferRoundedIcon fontSize="small" />,
    capability: 'promotions',
    group: 'catalog',
  },
  {
    to: '/app/inventory',
    label: 'nav.inventory',
    icon: <WarehouseRoundedIcon fontSize="small" />,
    capability: 'inventory.multiwarehouse',
    group: 'inventory',
  },
  {
    // Planificación es lo que dice CUÁNTO habrá que tener: vive al lado de las
    // existencias, no al lado de la fuerza de ventas que la alimenta.
    to: '/app/planning',
    label: 'nav.planning',
    icon: <QueryStatsRoundedIcon fontSize="small" />,
    capability: 'planning.demand',
    group: 'inventory',
  },
  {
    to: '/app/customers',
    label: 'nav.customers',
    icon: <PeopleAltRoundedIcon fontSize="small" />,
    capability: 'customers',
    group: 'customers',
  },
  {
    to: '/app/sales',
    label: 'nav.sales',
    icon: <BadgeRoundedIcon fontSize="small" />,
    capability: 'sales.force',
    group: 'customers',
  },
  {
    // Cotizaciones y surtidos son ACUERDOS con un cliente, no documentos de
    // venta: lo que se pacta antes de que haya un pedido.
    to: '/app/quotes',
    label: 'nav.quotes',
    icon: <RequestQuoteRoundedIcon fontSize="small" />,
    capability: 'trade.quotes',
    group: 'customers',
  },
  {
    to: '/app/assortments',
    label: 'nav.assortments',
    icon: <FactCheckRoundedIcon fontSize="small" />,
    capability: 'trade.assortments',
    group: 'customers',
  },
  {
    to: '/app/orders',
    label: 'nav.orders',
    icon: <ReceiptLongRoundedIcon fontSize="small" />,
    capability: 'orders',
    group: 'sales',
  },
  {
    to: '/app/payments',
    label: 'nav.payments',
    icon: <PaymentsRoundedIcon fontSize="small" />,
    capability: 'payments',
    group: 'sales',
  },
  {
    // Cobranza va detrás de pagos: es lo que queda cuando el pago NO llegó.
    to: '/app/credit',
    label: 'nav.credit',
    icon: <AccountBalanceRoundedIcon fontSize="small" />,
    capability: 'credit.management',
    group: 'sales',
  },
  {
    // P12: entregas, devoluciones y la red de reparto. Va DESPUES de pedidos y
    // pagos porque ese es el orden real de la operacion: primero se vende, se
    // cobra, y despues se despacha.
    to: '/app/fulfillment',
    label: 'nav.fulfillment',
    icon: <LocalShippingRoundedIcon fontSize="small" />,
    capability: 'fulfillment',
    group: 'sales',
  },
  {
    to: '/app/content',
    label: 'nav.content',
    icon: <ArticleRoundedIcon fontSize="small" />,
    capability: 'content.cms',
    group: 'store',
  },
  {
    // P13: ventas, embudo y búsquedas. Va DESPUÉS del contenido porque se mira
    // cuando ya hay algo que medir, y su capacidad es baseline: la entrada se
    // ve siempre.
    to: '/app/analytics',
    label: 'nav.analytics',
    icon: <InsightsRoundedIcon fontSize="small" />,
    capability: 'analytics.basic',
    group: 'store',
  },
  {
    to: '/app/settings',
    label: 'nav.settings',
    icon: <SettingsRoundedIcon fontSize="small" />,
    group: 'system',
  },
  {
    // P13: salud, incidentes, rastro y auditoría. SIN capacidad —igual que
    // Ajustes— y CON permiso: quien no administra el tenant no tiene nada que
    // hacer en la bitácora de operaciones, que lleva dentro el correo de cada
    // operador.
    to: '/app/operations',
    label: 'nav.operations',
    icon: <HealthAndSafetyRoundedIcon fontSize="small" />,
    permission: 'tenant.manage',
    group: 'system',
  },
  {
    // P14: monitor de integraciones, webhooks y credenciales de la API de
    // socio. SIN capacidad y CON permiso, exactamente igual que Operación:
    // la observabilidad de las integraciones no se vende, y quien no
    // administra el tenant no tiene nada que hacer entre sus credenciales.
    to: '/app/integrations',
    label: 'nav.integrations',
    icon: <HubRoundedIcon fontSize="small" />,
    permission: 'tenant.manage',
    group: 'system',
  },
  {
    to: '/app/diagnostics',
    label: 'nav.diagnostics',
    icon: <MonitorHeartRoundedIcon fontSize="small" />,
    permission: 'tenant.manage',
    group: 'system',
  },
]

/**
 * Qué entradas se pintan. Función PURA para poder probarla sin montar el árbol.
 *
 * Mientras las capacidades cargan (`capabilitiesReady: false`) NO se esconde
 * nada: un menú que se vacía y se rellena en cada navegación se lee como un
 * error de la app, y esconder de más aquí no protege nada —la autoridad es la
 * RLS, y la ruta vuelve a comprobarlo con su propio gate—.
 */
export function visibleNavItems(
  items: readonly NavItem[],
  access: {
    can: (permission: Permission) => boolean
    has: (capability: CapabilityId) => boolean
    capabilitiesReady: boolean
  },
): NavItem[] {
  return items.filter((item) => {
    if (item.permission && !access.can(item.permission)) return false
    if (item.capability && access.capabilitiesReady && !access.has(item.capability)) return false
    return true
  })
}

/** Un bloque del sidebar ya resuelto: su cabecera y lo que va debajo. */
export interface NavSection {
  id: NavGroupId | null
  /** `null` en el bloque de arriba, que no lleva cabecera. */
  label: MessageKey | null
  items: NavItem[]
}

/**
 * Reparte en bloques lo que YA se puede ver. Función PURA, y separada a
 * propósito de `visibleNavItems`: primero se decide qué entra —rol y
 * capacidades— y solo después dónde se pinta.
 *
 * Un grupo sin entradas visibles NO se pinta. Es lo único que impide que un
 * tenant sin nada de comercial se encuentre una cabecera «VENTAS» presidiendo
 * el vacío, que se lee como una pantalla que se rompió al cargar.
 */
export function groupNavItems(items: readonly NavItem[]): NavSection[] {
  const sections: NavSection[] = []

  const sueltos = items.filter((item) => !item.group)
  if (sueltos.length > 0) sections.push({ id: null, label: null, items: sueltos })

  for (const grupo of NAV_GROUPS) {
    const dentro = items.filter((item) => item.group === grupo.id)
    if (dentro.length > 0) sections.push({ id: grupo.id, label: grupo.label, items: dentro })
  }

  return sections
}

/**
 * Migas a partir de la ruta: raíz del backoffice + sección actual. Se derivan
 * de `NAV_ITEMS` para que agregar una sección no obligue a tocar dos sitios.
 */
export function crumbsForPath(pathname: string, label: (key: MessageKey) => string): Crumb[] {
  const match = NAV_ITEMS.find((item) => !item.end && pathname.startsWith(item.to))
  if (!match) return [{ label: label('nav.dashboard') }]
  return [{ label: label('nav.dashboard'), to: '/app' }, { label: label(match.label) }]
}
