import { Suspense, type ReactNode } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import type { CapabilityId } from '@/domain'
import { ProtectedArea } from '@/features/auth/ProtectedArea'
import { CapabilityGate } from '@/features/capabilities/CapabilityGate'
import { LoadingState } from '@/shared/ui/states'
import { lazyPage } from './lazyPage'
import { NotFoundPage } from './NotFoundPage'
import { RootErrorRoute } from './RootErrorRoute'

/**
 * Dos áreas separadas que comparten design system pero no rutas ni guards:
 *   `/app/*`        backoffice del tenant (sesión + membresía + sociedad activa)
 *   `/onboarding`   alta del espacio para quien tiene sesión y todavía no tiene tenant
 *   `/s/:storeSlug` vitrina pública (tenant resuelto por slug; el pedido lo
 *                   crea el servidor, que también resuelve la tienda)
 */

const LoginPage = lazyPage(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const ForgotPasswordPage = lazyPage(() =>
  import('@/features/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
)
const ResetPasswordPage = lazyPage(() =>
  import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
)
const OnboardingPage = lazyPage(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)
const AdminLayout = lazyPage(() =>
  import('@/features/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const DashboardPage = lazyPage(() =>
  import('@/features/admin/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const SettingsPage = lazyPage(() =>
  import('@/features/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const ProductsPage = lazyPage(() =>
  import('@/features/catalog/ProductsPage').then((m) => ({ default: m.ProductsPage })),
)
const CategoriesPage = lazyPage(() =>
  import('@/features/catalog/CategoriesPage').then((m) => ({ default: m.CategoriesPage })),
)
const PimPage = lazyPage(() =>
  import('@/features/catalog/pim/PimPage').then((m) => ({ default: m.PimPage })),
)
const PricingPage = lazyPage(() =>
  import('@/features/pricing/PricingPage').then((m) => ({ default: m.PricingPage })),
)
const InventoryPage = lazyPage(() =>
  import('@/features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })),
)
const CustomersPage = lazyPage(() =>
  import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
)
const SalesPage = lazyPage(() =>
  import('@/features/sales/SalesPage').then((m) => ({ default: m.SalesPage })),
)
const CreditPage = lazyPage(() =>
  import('@/features/credit/CreditPage').then((m) => ({ default: m.CreditPage })),
)
const QuotesPage = lazyPage(() =>
  import('@/features/trade/QuotesPage').then((m) => ({ default: m.QuotesPage })),
)
const AssortmentsPage = lazyPage(() =>
  import('@/features/trade/AssortmentsPage').then((m) => ({ default: m.AssortmentsPage })),
)
const PlanningPage = lazyPage(() =>
  import('@/features/planning/PlanningPage').then((m) => ({ default: m.PlanningPage })),
)
const OrdersPage = lazyPage(() =>
  import('@/features/orders/OrdersPage').then((m) => ({ default: m.OrdersPage })),
)
const PaymentsPage = lazyPage(() =>
  import('@/features/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage })),
)
const FulfillmentPage = lazyPage(() =>
  import('@/features/fulfillment/FulfillmentPage').then((m) => ({ default: m.FulfillmentPage })),
)
const PromotionsPage = lazyPage(() =>
  import('@/features/promotions/PromotionsPage').then((m) => ({ default: m.PromotionsPage })),
)
const ContentPage = lazyPage(() =>
  import('@/features/content/ContentPage').then((m) => ({ default: m.ContentPage })),
)
const AnalyticsPage = lazyPage(() =>
  import('@/features/analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
)
const OperationsPage = lazyPage(() =>
  import('@/features/ops/OperationsPage').then((m) => ({ default: m.OperationsPage })),
)
const IntegrationsPage = lazyPage(() =>
  import('@/features/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
)
const DiagnosticsPage = lazyPage(() =>
  import('@/features/capabilities/DiagnosticsPage').then((m) => ({ default: m.DiagnosticsPage })),
)
const StorefrontLayout = lazyPage(() =>
  import('@/features/storefront/StorefrontLayout').then((m) => ({ default: m.StorefrontLayout })),
)
const StoreHomePage = lazyPage(() =>
  import('@/features/storefront/StoreHomePage').then((m) => ({ default: m.StoreHomePage })),
)
const StoreProductPage = lazyPage(() =>
  import('@/features/storefront/StoreProductPage').then((m) => ({ default: m.StoreProductPage })),
)
const StoreFavoritesPage = lazyPage(() =>
  import('@/features/storefront/StoreFavoritesPage').then((m) => ({
    default: m.StoreFavoritesPage,
  })),
)
const StoreCartPage = lazyPage(() =>
  import('@/features/storefront/StoreCartPage').then((m) => ({ default: m.StoreCartPage })),
)
const StoreCheckoutPage = lazyPage(() =>
  import('@/features/storefront/StoreCheckoutPage').then((m) => ({ default: m.StoreCheckoutPage })),
)
const StoreAccountPage = lazyPage(() =>
  import('@/features/storefront/StoreAccountPage').then((m) => ({ default: m.StoreAccountPage })),
)
const QuickOrderPage = lazyPage(() =>
  import('@/features/storefront/quick-order/QuickOrderPage').then((m) => ({ default: m.QuickOrderPage })),
)
const StoreUnsubscribePage = lazyPage(() =>
  import('@/features/notifications/StoreUnsubscribePage').then((m) => ({ default: m.StoreUnsubscribePage })),
)
const StoreRegisterPage = lazyPage(() =>
  import('@/features/storefront/StoreRegisterPage').then((m) => ({ default: m.StoreRegisterPage })),
)
const StoreContentPage = lazyPage(() =>
  import('@/features/storefront/StoreContentPage').then((m) => ({ default: m.StoreContentPage })),
)
const StoreOrderPage = lazyPage(() =>
  import('@/features/storefront/StoreOrderPage').then((m) => ({ default: m.StoreOrderPage })),
)
const LandingPage = lazyPage(() =>
  import('@/features/storefront/pages').then((m) => ({ default: m.LandingPage })),
)

function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<LoadingState />}>{node}</Suspense>
}

/**
 * Ruta gateada por capacidad (P02-SaaS).
 *
 * Esconder la entrada del menú no basta: una URL se escribe a mano y se comparte
 * por correo. Con esto, entrar directo a `/app/products` sin el módulo enseña
 * «no contratado» en vez de un listado vacío, que es lo que hoy parecería un
 * fallo de la aplicación. Sigue sin ser seguridad: la autoridad es la RLS.
 */
function gated(capability: CapabilityId, node: ReactNode): ReactNode {
  return <CapabilityGate capability={capability}>{withSuspense(node)}</CapabilityGate>
}

export const routes: RouteObject[] = [
  { path: '/', element: withSuspense(<LandingPage />), errorElement: <RootErrorRoute /> },
  { path: '/login', element: withSuspense(<LoginPage />), errorElement: <RootErrorRoute /> },
  { path: '/recuperar', element: withSuspense(<ForgotPasswordPage />), errorElement: <RootErrorRoute /> },
  { path: '/nueva-clave', element: withSuspense(<ResetPasswordPage />), errorElement: <RootErrorRoute /> },
  {
    // Ruta sin path: agrupa TODO lo que exige sesión bajo un mismo guard y un
    // mismo `TenantProvider`, para que el alta de espacio y el backoffice
    // compartan el estado de tenant en vez de resolverlo dos veces.
    element: <ProtectedArea />,
    errorElement: <RootErrorRoute />,
    children: [
      { path: '/onboarding', element: withSuspense(<OnboardingPage />) },
      {
        path: '/app',
        element: withSuspense(<AdminLayout />),
        children: [
          { index: true, element: gated('analytics.basic', <DashboardPage />) },
          // P13: ventas, embudo y términos de búsqueda. Gateada por
          // `analytics.basic`, que es BASELINE: cualquier tenant entra. Lo
          // vendible es la SEGUNDA pestaña, y se gatea en la base
          // (`SIN_MODULO`), no aquí — así el comportamiento es el mismo si
          // alguien llama a la función desde fuera de la aplicación.
          { path: 'analytics', element: gated('analytics.basic', <AnalyticsPage />) },
          { path: 'products', element: gated('catalog', <ProductsPage />) },
          { path: 'categories', element: gated('catalog', <CategoriesPage />) },
          // El vocabulario del PIM es del módulo vendible, no del baseline.
          { path: 'pim', element: gated('catalog.advanced', <PimPage />) },
          // El precio por canal, segmento o cliente es el módulo vendible; el
          // precio de catálogo sigue viniendo con el producto.
          { path: 'pricing', element: gated('pricing.lists', <PricingPage />) },
          // Llevar existencia por almacen es el modulo vendible; la existencia
          // del catalogo (`products.stock`) sigue viniendo con el producto, y
          // por eso un tenant sin este addon vende igual que antes de P06.
          { path: 'inventory', element: gated('inventory.multiwarehouse', <InventoryPage />) },
          // La ficha de cliente es baseline: hasta un tenant sin nada
          // contratado necesita saber a quién le vendió. Lo vendible es la
          // CUENTA B2B, y su pestaña se gatea dentro de la pantalla.
          { path: 'customers', element: gated('customers', <CustomersPage />) },
          { path: 'sales', element: gated('sales.force', <SalesPage />) },
          // La cobranza va gateada por `credit.management`; la pestaña de
          // comprobantes lleva su propio gate sobre `invoicing` dentro de la
          // pantalla, porque son dos addons distintos: se puede llevar la
          // cuenta de lo que se debe sin emitir comprobante electrónico.
          { path: 'credit', element: gated('credit.management', <CreditPage />) },
          // Cotizaciones y surtidos son DOS rutas y no dos pestañas de una: son
          // dos addons distintos, y meterlas juntas dejaría fuera al tenant que
          // solo contrata una de las dos.
          { path: 'quotes', element: gated('trade.quotes', <QuotesPage />) },
          { path: 'assortments', element: gated('trade.assortments', <AssortmentsPage />) },
          { path: 'planning', element: gated('planning.demand', <PlanningPage />) },
          { path: 'orders', element: gated('orders', <OrdersPage />) },
          // P09: cobros, medios y conciliacion. Gateado por la capacidad
          // `payments`: sin el addon la tienda sigue vendiendo con el pago
          // pendiente, que es lo que hacia antes de esta fase.
          { path: 'payments', element: gated('payments', <PaymentsPage />) },
          // P12: cola de preparacion, devoluciones y red de entrega. Gateado
          // por la capacidad `fulfillment`: sin el addon los pedidos nacen con
          // transporte cero y sin promesa de entrega, que es exactamente lo que
          // hacian antes de esta fase. Se degrada, no se rompe.
          { path: 'fulfillment', element: gated('fulfillment', <FulfillmentPage />) },
          // P10: campanas, cupones y tarjetas regalo. Gateado por la capacidad
          // `promotions`: sin el addon los pedidos cuestan el precio de lista,
          // que es exactamente lo que costaban antes de esta fase.
          { path: 'promotions', element: gated('promotions', <PromotionsPage />) },
          // P11: portada, páginas, bloques y sinónimos de búsqueda. Gateado por
          // `content.cms`: sin el addon la vitrina pinta el hero de
          // `store_settings` y el catálogo, que es lo que pintaba antes de esta
          // fase. Se degrada, no se rompe.
          { path: 'content', element: gated('content.cms', <ContentPage />) },
          // Ajustes y diagnóstico NO se gatean por capacidad: son la salida de
          // un tenant sin nada contratado y el sitio donde se ve por qué.
          { path: 'settings', element: withSuspense(<SettingsPage />) },
          // Operación NO se gatea por capacidad, igual que Ajustes y
          // Diagnóstico y por la misma razón (P02): quien no puede ver por qué
          // fallan sus cobros acaba llamando por teléfono. Quien decide aquí es
          // el ROL, y lo decide la base: policy de `ops_events` y de
          // `audit_log`, más la comprobación dentro de `ops_health`.
          { path: 'operations', element: withSuspense(<OperationsPage />) },
          // P14: salud de conectores, cola, webhooks y credenciales de la API
          // de socio. SIN capacidad, por la misma razón que Operación: ver por
          // qué fallan tus integraciones es observabilidad, y quien no puede
          // verlo acaba llamando por teléfono. Lo vendible es PUBLICAR
          // —credenciales, endpoints, suscripciones— y su gate está en la
          // BASE (policy y `SIN_MODULO`), no en el router, para que el
          // comportamiento sea el mismo desde fuera de la aplicación.
          { path: 'integrations', element: withSuspense(<IntegrationsPage />) },
          { path: 'diagnostics', element: withSuspense(<DiagnosticsPage />) },
        ],
      },
    ],
  },
  {
    path: '/s/:storeSlug',
    element: withSuspense(<StorefrontLayout />),
    errorElement: <RootErrorRoute />,
    children: [
      { index: true, element: withSuspense(<StoreHomePage />) },
      { path: 'product/:productSlug', element: withSuspense(<StoreProductPage />) },
      // Página administrable del CMS (P11-SaaS). El slug va en la URL y no el
      // uuid porque una campaña se comparte por mensajería, y un uuid no se
      // comparte. NO se gatea por capacidad en el router: la vitrina es pública
      // y quien decide si hay algo que enseñar es la función de la base, que
      // sin `content.cms` devuelve «no hay página» — no «no contratado», que
      // sería contarle al comprador el plan de la tienda.
      { path: 'p/:pageSlug', element: withSuspense(<StoreContentPage />) },
      { path: 'favoritos', element: withSuspense(<StoreFavoritesPage />) },
      { path: 'cart', element: withSuspense(<StoreCartPage />) },
      { path: 'checkout', element: withSuspense(<StoreCheckoutPage />) },
      // Área de cuenta del comprador B2B. NO cuelga del guard del backoffice:
      // quien entra aquí es un comprador de un cliente, no un miembro del
      // tenant, y su contexto lo resuelve el servidor a partir del vínculo.
      { path: 'account', element: withSuspense(<StoreAccountPage />) },
      // Pedido rápido y CSV (cierre). Exige sesión dentro de la pantalla, no con
      // un guard del backoffice: quien entra es un comprador. Termina en el
      // carrito; el pedido lo sigue creando solo el checkout oficial.
      { path: 'pedido-rapido', element: withSuspense(<QuickOrderPage />) },
      // Alta de CONSUMIDOR dentro de la tienda (N02). No crea tenant: eso es `/onboarding`.
      { path: 'register', element: withSuspense(<StoreRegisterPage />) },
      // Baja de un clic de los recordatorios de carrito (cierre, ítem 8). Sin
      // sesión: el secreto del enlace es la autorización, y la página pide
      // confirmar antes de llamar para que un filtro de correo no dé de baja a
      // nadie al abrir el enlace.
      { path: 'unsubscribe', element: withSuspense(<StoreUnsubscribePage />) },
      // Confirmación del pedido. El número va en la URL para que el comprador
      // pueda guardarla o compartirla; el detalle llega por estado de
      // navegación, porque un comprador anónimo no puede releer el pedido.
      { path: 'order/:orderNumber', element: withSuspense(<StoreOrderPage />) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes)
