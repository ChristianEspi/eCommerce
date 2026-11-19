import type { fieldHelpEsAdmin } from './admin.es'

export const fieldHelpEnAdmin: Readonly<Record<keyof typeof fieldHelpEsAdmin, string>> = {
  // Settings · Support and legal details
  'help.admin.contact.legalName':
    'Your company’s registered legal name, exactly as it appears on its tax record. It is shown in the store footer and on the Complaints Book.',
  'help.admin.contact.whatsapp':
    'The number customers reach from the WhatsApp button. Include the country code, e.g. +51 987 654 321.',
  'help.admin.contact.note':
    'A short line shown next to your support details. Example: “We reply within 2 business hours”.',
  'help.admin.contact.socialUrl':
    'The full address of your profile, starting with https://. Example: https://www.instagram.com/mystore',
  // Settings · Identity and email
  'help.admin.settings.accentHex':
    'Your brand colour in hex format: # followed by six characters (0–9, A–F). Example: #5AA97F. Used for the store’s buttons and links.',
  'help.admin.settings.emailReplyTo':
    'When a customer replies to a store email (an order confirmation, for instance), the reply goes to this address.',
  // Settings · Home page
  'help.admin.home.maxItems':
    'The most items this home section shows, from 1 to 24. Leave it empty to use the theme’s default.',
  // Settings · Installments
  'help.admin.installments.count':
    'How many interest-free installments your payment provider allows, from 2 to 36. The product page shows the amount of each one.',
  'help.admin.installments.provider':
    'The name of the payment method that offers the installments, as customers know it. Example: Andes Card.',
  'help.admin.installments.min':
    'The price from which installments are advertised. Leave it empty to advertise them on every product.',
  // Settings · Members
  'help.admin.members.email':
    'The email of the person you are giving access to. If they have no account yet, you will be offered to create one with that email.',
  // Settings · Taxes
  'help.admin.taxes.code':
    'Internal identifier for the category, with no spaces. Example: vat-standard or exempt. Avoid changing it once created.',
  'help.admin.taxes.rate':
    'The tax percentage, from 0 to 100 with up to two decimals. Example: 18 for standard VAT; 0 for exempt products.',
  // Sales channels
  'help.channels.code':
    'Short channel identifier used by integrations and reports: lowercase letters, numbers, dashes or underscores. Example: wholesale or lima-store.',
  // Integrations
  'help.integrations.api.name':
    'A name that tells you which system uses this credential. Example: Central ERP or Sales rep app.',
  'help.integrations.webhooks.url':
    'The public https address of your system that will receive the notifications. Example: https://erp.mycompany.com/webhooks/ebim. Local and private addresses are rejected.',
  'help.integrations.sources.username':
    'The username your API accepts for basic authentication. The password goes in the field below and is stored encrypted.',
  'help.integrations.sources.clientId':
    'The client identifier (client_id) the API provider issued when you registered the OAuth 2.0 application.',
  'help.integrations.sources.tokenUrl':
    'The https address where the OAuth 2.0 access token is requested. Example: https://erp.mycompany.com/oauth/token',
  'help.integrations.sources.scope':
    'The permissions (scopes) requested with the token, separated by spaces. Leave it empty if your API does not use them.',
  'help.integrations.sources.timeout':
    'Seconds to wait for your API to answer before treating the call as failed, from 5 to 60. Raise it if your ERP is slow.',
  'help.integrations.sources.pageSize':
    'How many records are requested per call to your API, from 1 to 1000. Lower it if your ERP is slow or cuts off large responses.',
  // Stores
  'help.stores.slug':
    'The part of the public address that identifies the store: lowercase letters, numbers and dashes. Example: my-store → /s/my-store.',
  'help.stores.domain':
    'Your own domain, without https:// or slashes. Example: shop.mydomain.com. You then need to point it at us with your domain provider and verify it in Settings.',
  // Business sign-up
  'help.onboarding.storeSlug':
    'Your store’s public address: lowercase letters, numbers and dashes, 3 to 62 characters. Example: my-store. It is suggested from the name.',
}
