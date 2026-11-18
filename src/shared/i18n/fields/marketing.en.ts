import type { fieldHelpEsMarketing } from './marketing.es'

export const fieldHelpEnMarketing: Readonly<Record<keyof typeof fieldHelpEsMarketing, string>> = {
  // --- Promotions ------------------------------------------------------------
  'help.promotions.percent': 'Just the number, without the % sign. For example, 15 takes 15% off.',
  'help.promotions.buyQuantity': 'Units the customer must take to trigger the offer. In a 3-for-2 it is 3.',
  'help.promotions.minQuantity':
    'Minimum units in the cart for the campaign to apply. Leave empty for no minimum.',
  'help.promotions.requiredQuantity':
    'How many units of this product the bundle requires. For example: 2.',
  'help.promotions.tierQuantity': 'The quantity from which this tier applies. For example: 10.',
  'help.promotions.tierPercent': 'Tier discount, number only. For example, 5 for 5% off.',
  'help.promotions.couponCode':
    'What the customer types at checkout: letters and digits, 3 to 64 long. For example: SUMMER25.',
  'help.promotions.couponUsageLimit':
    'Total number of redemptions across all customers. Leave empty for no limit.',
  'help.promotions.couponUsageLimitPerCustomer':
    'How many times a single customer can redeem it. Leave empty for no limit.',
  'help.promotions.giftCardAdjust':
    'A positive amount adds balance and a negative one removes it. For example, -20 takes 20 off the card.',
  'help.promotions.giftCardReason':
    'Required, at least 3 characters: it is recorded in the card ledger.',

  // --- Content ---------------------------------------------------------------
  'help.content.seoTitle':
    'The title shown by Google and in the browser tab. Leave empty to use the page title.',
  'help.content.seoDescription':
    'The snippet under the link in search results. Up to 320 characters; 120 to 160 works best.',
  'help.content.itemLimit': 'The most products this block will show, from 1 to 48.',
  'help.content.synonymTerm':
    'The word shoppers type into the search box, 2 to 60 characters. For example: cellphone.',
}
