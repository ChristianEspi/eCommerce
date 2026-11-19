import type { fieldHelpEsOperations } from './operations.es'

export const fieldHelpEnOperations: Readonly<Record<keyof typeof fieldHelpEsOperations, string>> = {
  // Fulfillment: delivery network, pickup points, route sheets and deliveries
  'help.fulfillment.methodCode':
    'Identifies the method in reports and integrations; shoppers never see it. Example: lima-delivery.',
  'help.fulfillment.zoneCode': 'Identifies the zone in rates and reports. Example: lima-downtown.',
  'help.fulfillment.pickupCode':
    'Identifies the pickup point in reports and integrations. Example: miraflores-store.',
  'help.fulfillment.leadDays':
    'Days the order takes to arrive once confirmed, from 0 to 365. The minimum cannot exceed the maximum.',
  'help.fulfillment.baseAmount':
    'Always charged for shipping, before adding lines or weight. Up to two decimals. Example: 10.00.',
  'help.fulfillment.perItemAmount':
    'Added once for every order line. Leave it at 0 if you do not charge per line.',
  'help.fulfillment.ratePriority':
    'A number from 0 to 9999. When two rates match the same order, the lower number wins.',
  'help.fulfillment.pickupPosition':
    'Order in which the point is listed at checkout: lower numbers come first.',
  'help.fulfillment.planCode':
    'Identifies the route sheet for the driver and in reports. Example: ROUTE-20261118-01.',
  'help.fulfillment.documentId':
    "Recipient's national ID, foreign resident card or passport: 6 to 15 letters or digits, no spaces.",
  'help.fulfillment.error.documentId': 'Enter 6 to 15 letters or digits, no spaces.',

  // B2B trade: assortments and quotes
  'help.trade.assortmentCode':
    'Identifies the assortment when assigning it to customers or importing it. Example: PHARMA-SET.',
  'help.trade.quoteNumber':
    'One is suggested automatically; you can replace it with your ERP number. No spaces. Example: COT-20261118-103000.',
  'help.trade.currency': 'Three-letter ISO code. Example: PEN or USD.',
  'help.trade.quantity': 'Up to three decimals when the product is sold in fractions. Example: 2.5.',
  'help.trade.error.quoteNumber':
    'The number accepts letters, digits, dot, hyphen, underscore and slash, with no spaces.',

  // Sales force: reps, territories, routes and goals
  'help.sales.repCode':
    "The rep's code in your company or ERP; used to match sales and commissions. Example: VEN-014.",
  'help.sales.territoryCode': 'Identifies the territory in goals and reports. Example: LIM-NORTH.',
  'help.sales.routeCode': "Identifies the route in the rep's schedule. Example: ROUTE-MON-01.",
  'help.sales.currency': 'Three-letter ISO code of the goal currency. Example: PEN.',
  'help.sales.target':
    'The figure to reach in the period, in the unit of the chosen metric: amount, units, orders or customers.',
} as const
