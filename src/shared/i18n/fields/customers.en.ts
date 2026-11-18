import type { fieldHelpEsCustomers } from './customers.es'

export const fieldHelpEnCustomers: Readonly<Record<keyof typeof fieldHelpEsCustomers, string>> = {
  // Customers and B2B accounts
  'help.customers.code':
    'Internal identifier, matching your ERP if you have one. Letters, digits, dot, hyphen or underscore, no spaces. Example: CLI-020.',
  'help.customers.country': 'Two-letter ISO country code. Example: PE for Peru, CL for Chile.',
  'help.customers.systemCode': 'The system that uses this identifier, in lowercase. Example: erp, pos, marketplace.',
  'help.customers.externalId': 'The code that system uses for this customer. Example: C000123.',
  'help.customers.locationCode': 'Short branch code, no spaces. Example: LIM-01.',
  'help.customers.approvalThreshold':
    'Order amount from which a purchase needs approval, in the store currency. Example: 5000.',
  'help.customers.ruleMinAmount': 'The rule applies to orders from this amount on, up to two decimals. Example: 10000.',
  'help.customers.simulateAmount': 'Amount of a test order to see which rule it would hit. Nothing is saved.',
  'help.customers.creditLimit':
    'The most the account can owe at once, adding up its unpaid orders. Example: 20000.',
  'help.customers.paymentTerms': 'Days the customer has to pay each order. Example: 30.',
  'help.customers.watchAfter':
    'Days a payment can be late before the account moves to “On watch” on its own. Example: 15.',
  'help.customers.blockAfter':
    'Days late before the account is blocked automatically and cannot buy. Must be equal to or greater than the watch days.',

  // Credit and collections
  'help.credit.orderNumber': 'The number of the order the invoice comes from. Example: EC-20261117-00046.',
  'help.credit.receiptNumber':
    'Letters, digits and hyphens, no spaces. Leave it empty to get the day’s sequence number (RC-YYYYMMDD-001).',

  // Orders
  'help.orders.refSystem': 'The system where this order lives, lowercase and without spaces. Example: erp, accounting, marketplace.',
  'help.orders.refType': 'What kind of document it is in that system. Example: order, invoice, waybill.',
  'help.orders.refValue': 'The number or code that system uses for the order. Example: SO-004512.',

  // Payments
  'help.payments.confirmReference':
    'The number your bank or wallet gives the transaction. Example: 00451287.',
  'help.payments.refundAmount':
    'You can refund part or all of it, but never more than what is still collected. Up to two decimals.',
  'help.payments.code':
    'Internal identifier for the method, lowercase, no spaces; it cannot change later. Example: bank-transfer.',
  'help.payments.position': 'Order in which it shows at checkout: the lowest number comes first.',
  'help.payments.reconciliationPaste':
    'Paste the provider report rows separated by semicolons. Example: 2026-11-17;OP-1234;150.00;4.50;PEN',
}
