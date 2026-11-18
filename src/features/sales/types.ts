import { z } from 'zod'
import { matchesRule } from '@/shared/lib/fieldRules'

export {
  SALES_REPS_TABLE,
  SALES_REP_CUSTOMERS_TABLE,
  SALES_TERRITORIES_TABLE,
  SALES_REP_TERRITORIES_TABLE,
  SALES_ROUTES_TABLE,
  SALES_ROUTE_STOPS_TABLE,
  SALES_VISITS_TABLE,
  SALES_GOALS_TABLE,
  COMMISSION_RULES_TABLE,
  COMMISSION_STATEMENTS_TABLE,
} from '@/shared/lib/db-schema'

/**
 * Vocabulario de la fuerza de ventas en el CLIENTE.
 *
 * Es la mitad de pantalla de los CHECK de `20260902100100_sales_force.sql` y
 * `20260902110000_sales_territories.sql`. Existe para que el formulario diga
 * «ese código no vale» con el foco en el campo, **no para decidir**: si esto y
 * la base discrepan, manda la base.
 *
 * Cada regla de aquí tiene su gemela en una restricción de Postgres, y esa es
 * la que de verdad protege. Duplicarlas es deliberado —el mismo patrón que
 * `features/customers`— porque un 400 genérico no le dice a nadie qué arreglar.
 */

/** Mismo formato que `sales_reps_code_fmt`. */
const employeeCode = z
  .string()
  .trim()
  .min(1, 'sales.error.code')
  .max(40, 'sales.error.code')
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/, 'sales.error.code')

const optionalEmail = z
  .string()
  .trim()
  .max(320, 'sales.error.email')
  .refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'sales.error.email')
  // Contrato §13: `@ebim.pe` no es actor de negocio de un tenant. La base lo
  // rechaza igual (`sales_reps_not_suite`); aquí se dice antes de enviar.
  .refine((value) => !value.toLowerCase().includes('@ebim.pe'), 'sales.error.suiteEmail')

export const MEMBER_STATUSES = ['invited', 'active', 'disabled'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export const salesRepSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  user_id: z.string().uuid().nullable().default(null),
  employee_code: z.string(),
  full_name: z.string(),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  manager_id: z.string().uuid().nullable().default(null),
  status: z.enum(MEMBER_STATUSES).catch('active'),
  hired_at: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
})
export type SalesRep = z.infer<typeof salesRepSchema>

export const salesRepFormSchema = z.object({
  employee_code: employeeCode,
  full_name: z
    .string()
    .trim()
    .min(1, 'sales.error.name')
    .max(160, 'sales.error.name')
    .refine((value) => value === '' || matchesRule('personName', value), 'field.error.personName'),
  email: optionalEmail,
  phone: z
    .string()
    .trim()
    .max(40, 'sales.error.phone')
    .refine((value) => value === '' || matchesRule('phone', value), 'field.error.phone'),
  /** Cadena vacía = sin jefe. El `select` no puede emitir `null`. */
  manager_id: z.string(),
  status: z.enum(MEMBER_STATUSES),
  hired_at: z.string(),
  notes: z.string().trim().max(500, 'sales.error.notes'),
})
export type SalesRepFormValues = z.infer<typeof salesRepFormSchema>

export function emptyRepForm(): SalesRepFormValues {
  return {
    employee_code: '',
    full_name: '',
    email: '',
    phone: '',
    manager_id: '',
    status: 'active',
    hired_at: '',
    notes: '',
  }
}

export function repToForm(rep: SalesRep): SalesRepFormValues {
  return {
    employee_code: rep.employee_code,
    full_name: rep.full_name,
    email: rep.email ?? '',
    phone: rep.phone ?? '',
    manager_id: rep.manager_id ?? '',
    status: rep.status,
    hired_at: rep.hired_at ?? '',
    notes: rep.notes ?? '',
  }
}

/**
 * Los jefes que se le pueden ofrecer a un vendedor.
 *
 * Se excluye él mismo Y toda su descendencia. La base rechaza el ciclo con
 * `VENDEDOR_CICLO`, y un desplegable que ofrece lo que va a fallar es un
 * desplegable que miente — es la misma decisión que se tomó con el árbol de
 * categorías.
 */
export function managerOptions(reps: readonly SalesRep[], repId: string | null): SalesRep[] {
  if (!repId) return [...reps]

  const bloqueados = new Set<string>([repId])
  let crecio = true
  // Punto fijo en vez de recursión: la lista viene de la red y un ciclo que la
  // base no haya podido impedir colgaría el navegador.
  while (crecio) {
    crecio = false
    for (const rep of reps) {
      if (rep.manager_id && bloqueados.has(rep.manager_id) && !bloqueados.has(rep.id)) {
        bloqueados.add(rep.id)
        crecio = true
      }
    }
  }

  return reps.filter((rep) => !bloqueados.has(rep.id))
}

/** Una fila de la cartera, con el nombre del cliente ya resuelto. */
export const portfolioRowSchema = z.object({
  id: z.string().uuid(),
  sales_rep_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  is_primary: z.boolean(),
  assigned_at: z.string(),
  customer_code: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
})
export type PortfolioRow = z.infer<typeof portfolioRowSchema>

// ---------------------------------------------------------------------------
// Territorios y rutas (fase 03)
// ---------------------------------------------------------------------------

/** Mismo formato que `sales_territories_code_fmt` y `sales_routes_code_fmt`. */
const shortCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/, 'sales.error.code')

export const territorySchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable().default(null),
  code: z.string(),
  name: z.string(),
  is_active: z.boolean().default(true),
})
export type Territory = z.infer<typeof territorySchema>

export const territoryFormSchema = z.object({
  code: shortCode,
  name: z.string().trim().min(1, 'sales.error.name').max(120, 'sales.error.name'),
  /** Cadena vacía = raíz. El `select` no puede emitir `null`. */
  parent_id: z.string(),
  is_active: z.boolean(),
})
export type TerritoryFormValues = z.infer<typeof territoryFormSchema>

export function emptyTerritoryForm(): TerritoryFormValues {
  return { code: '', name: '', parent_id: '', is_active: true }
}

/**
 * Los padres que se le pueden ofrecer a un territorio.
 *
 * Mismo punto fijo que `managerOptions` y por la misma razón: la base rechaza
 * el ciclo con `TERRITORIO_CICLO`, y ofrecer una opción que va a fallar al
 * guardar es un desplegable que miente. Se excluye él y su descendencia.
 */
export function parentTerritoryOptions(
  territories: readonly Territory[],
  territoryId: string | null,
): Territory[] {
  if (!territoryId) return [...territories]

  const bloqueados = new Set<string>([territoryId])
  let crecio = true
  while (crecio) {
    crecio = false
    for (const territory of territories) {
      if (
        territory.parent_id &&
        bloqueados.has(territory.parent_id) &&
        !bloqueados.has(territory.id)
      ) {
        bloqueados.add(territory.id)
        crecio = true
      }
    }
  }

  return territories.filter((territory) => !bloqueados.has(territory.id))
}

/** Los siete días, en el orden de `sales_routes_weekday_range` (0 = domingo). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

export const routeSchema = z.object({
  id: z.string().uuid(),
  sales_rep_id: z.string().uuid(),
  territory_id: z.string().uuid().nullable().default(null),
  code: z.string(),
  name: z.string(),
  weekday: z.number(),
  frequency_weeks: z.number().default(1),
  is_active: z.boolean().default(true),
  rep_name: z.string().nullable().default(null),
})
export type Route = z.infer<typeof routeSchema>

export const routeFormSchema = z.object({
  code: shortCode,
  name: z.string().trim().min(1, 'sales.error.name').max(120, 'sales.error.name'),
  sales_rep_id: z.string().uuid('sales.error.rep'),
  territory_id: z.string(),
  /** El `select` emite texto; la base espera un `smallint`. */
  weekday: z.string(),
  frequency_weeks: z.string(),
  is_active: z.boolean(),
})
export type RouteFormValues = z.infer<typeof routeFormSchema>

export function emptyRouteForm(): RouteFormValues {
  return {
    code: '',
    name: '',
    sales_rep_id: '',
    territory_id: '',
    weekday: '1',
    frequency_weeks: '1',
    is_active: true,
  }
}

export const routeStopSchema = z.object({
  id: z.string().uuid(),
  route_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  sequence: z.number(),
  customer_code: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
})
export type RouteStop = z.infer<typeof routeStopSchema>

/**
 * El primer hueco libre en el orden de una ruta.
 *
 * `sales_route_stops_sequence_unique` impide dos paradas con el mismo número, y
 * dejar que la pantalla proponga uno ocupado convierte un alta normal en un
 * error que quien está delante no puede explicar.
 */
export function nextSequence(stops: readonly RouteStop[]): number {
  const usados = new Set(stops.map((stop) => stop.sequence))
  let candidato = 1
  while (usados.has(candidato)) candidato += 1
  return candidato
}

// ---------------------------------------------------------------------------
// Visitas, metas y comisiones (fase 12-13)
// ---------------------------------------------------------------------------

export const VISIT_OUTCOMES = [
  'planned',
  'completed',
  'no_order',
  'closed',
  'rescheduled',
] as const
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number]

export const visitSchema = z.object({
  id: z.string().uuid(),
  sales_rep_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  route_id: z.string().uuid().nullable().default(null),
  planned_at: z.string().nullable().default(null),
  checked_in_at: z.string().nullable().default(null),
  checked_out_at: z.string().nullable().default(null),
  outcome: z.enum(VISIT_OUTCOMES).catch('planned'),
  order_id: z.string().uuid().nullable().default(null),
  notes: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  rep_name: z.string().nullable().default(null),
})
export type Visit = z.infer<typeof visitSchema>

export const visitFormSchema = z.object({
  sales_rep_id: z.string().uuid('sales.error.rep'),
  customer_id: z.string().uuid('sales.error.customer'),
  route_id: z.string(),
  /** `datetime-local`: se manda tal cual y Postgres lo interpreta. */
  planned_at: z.string().min(1, 'sales.error.date'),
  notes: z.string().trim().max(500, 'sales.error.notes'),
})
export type VisitFormValues = z.infer<typeof visitFormSchema>

export function emptyVisitForm(): VisitFormValues {
  const ahora = new Date()
  ahora.setMinutes(0, 0, 0)
  return {
    sales_rep_id: '',
    customer_id: '',
    route_id: '',
    planned_at: ahora.toISOString().slice(0, 16),
    notes: '',
  }
}

/**
 * ¿Se puede cerrar esta visita?
 *
 * `sales_visits_completed_needs_checkin` exige que una visita `completed` tenga
 * entrada registrada: sin ella, «visitado» sería una afirmación que nada
 * respalda. La pantalla apaga el botón por la misma razón que el CHECK existe.
 */
export function canComplete(visit: Visit): boolean {
  return visit.checked_in_at !== null && visit.outcome === 'planned'
}

export const GOAL_METRICS = ['amount', 'units', 'orders', 'coverage'] as const
export type GoalMetric = (typeof GOAL_METRICS)[number]

export const goalSchema = z.object({
  id: z.string().uuid(),
  sales_rep_id: z.string().uuid().nullable().default(null),
  territory_id: z.string().uuid().nullable().default(null),
  metric: z.enum(GOAL_METRICS).catch('amount'),
  currency: z.string().nullable().default(null),
  period_start: z.string(),
  period_end: z.string(),
  target_value: z.string(),
  rep_name: z.string().nullable().default(null),
})
export type Goal = z.infer<typeof goalSchema>

export const goalFormSchema = z
  .object({
    /** Exactamente uno de los dos: lo impone `sales_goals_one_owner`. */
    sales_rep_id: z.string(),
    territory_id: z.string(),
    metric: z.enum(GOAL_METRICS),
    currency: z
      .string()
      .trim()
      .refine((value) => value === '' || matchesRule('currency', value), 'sales.error.currency'),
    period_start: z.string().min(1, 'sales.error.date'),
    period_end: z.string().min(1, 'sales.error.date'),
    target_value: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'sales.error.target')
      .refine((value) => Number(value) > 0, 'sales.error.target'),
  })
  .refine((values) => values.period_end >= values.period_start, {
    path: ['period_end'],
    message: 'sales.error.period',
  })
  // Una meta es de UNO: de un vendedor o de un territorio, nunca de los dos ni
  // de ninguno. Sin esto, «vendiste 1.200» no tiene a quién atribuirse.
  .refine((values) => Boolean(values.sales_rep_id) !== Boolean(values.territory_id), {
    path: ['sales_rep_id'],
    message: 'sales.error.goalOwner',
  })
  // `sales_goals_currency_when_amount`: una meta en importe sin moneda es una
  // cifra que no se puede comparar con nada.
  .refine((values) => values.metric !== 'amount' || values.currency.length === 3, {
    path: ['currency'],
    message: 'sales.error.currency',
  })
export type GoalFormValues = z.infer<typeof goalFormSchema>

export function emptyGoalForm(currency: string): GoalFormValues {
  const hoy = new Date()
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
  return {
    sales_rep_id: '',
    territory_id: '',
    metric: 'amount',
    currency,
    period_start: primero.toISOString().slice(0, 10),
    period_end: ultimo.toISOString().slice(0, 10),
    target_value: '',
  }
}

export const COMMISSION_STATUSES = ['draft', 'approved', 'paid'] as const
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number]

export const commissionSchema = z.object({
  id: z.string().uuid(),
  sales_rep_id: z.string().uuid(),
  rule_id: z.string().uuid().nullable().default(null),
  period_start: z.string(),
  period_end: z.string(),
  currency: z.string(),
  base_amount: z.string(),
  rate: z.string(),
  amount: z.string(),
  status: z.enum(COMMISSION_STATUSES).catch('draft'),
  approved_at: z.string().nullable().default(null),
  paid_at: z.string().nullable().default(null),
  rep_name: z.string().nullable().default(null),
})
export type Commission = z.infer<typeof commissionSchema>

/**
 * A dónde puede ir una liquidación, calcado de `commission_statement_guard`.
 *
 * `paid` es terminal y de `approved` no se vuelve a borrador: una liquidación
 * pagada que alguien reabre es dinero que ya salió y una cifra que dice que no.
 */
export function nextCommissionStatuses(status: CommissionStatus): CommissionStatus[] {
  if (status === 'draft') return ['approved']
  if (status === 'approved') return ['paid']
  return []
}
