import type { fieldHelpEsStorefront } from './storefront.es'

export const fieldHelpEnStorefront: Readonly<Record<keyof typeof fieldHelpEsStorefront, string>> = {
  'sfHelp.checkout.country': 'Two-letter country code. For example: PE for Peru.',
  'sfHelp.checkout.coupon': 'The promo code exactly as you received it, with no spaces. For example: SUMMER10.',
  'sfHelp.checkout.giftCard': 'The code printed on your gift card, letters and numbers only. Check the balance before you pay.',
  'sfHelp.card.cvv': 'The 3 digits on the back of the card (4 on the front for American Express).',
  'sfHelp.addresses.error.country': 'Enter the two-letter country code, such as PE.',
  'sfHelp.complaints.amount': 'What you paid for the product or service, with up to 2 decimals. For example: 149.90',
  'sfHelp.complaints.order': 'The order number from your confirmation email, if you have it. For example: PED-000123.',
  'sfHelp.auth.error.passwordTooLong': 'Passwords can be at most 72 characters long.',
}
