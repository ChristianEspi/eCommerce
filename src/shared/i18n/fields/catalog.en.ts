import type { fieldHelpEsCatalog } from './catalog.es'

export const fieldHelpEnCatalog: Readonly<Record<keyof typeof fieldHelpEsCatalog, string>> = {
  'help.catalog.sku':
    'Internal product code, unique across the company. Letters, digits, hyphen, underscore, dot or slash, no spaces. Example: POL-BLUE-M.',
  'help.catalog.slug':
    'The last part of the web address: lowercase letters, digits and hyphens, 3 to 62 characters. Example: cotton-polo-blue.',
  'help.catalog.error.sku':
    'The SKU may only contain letters, digits, hyphens, underscores, dots and slashes, with no spaces.',
  'help.catalog.variantSku':
    "This variant's own code, different from the product SKU. Letters, digits, hyphen, underscore, dot or slash, no spaces. Example: POL-BLUE-M.",
  'help.catalog.barcode':
    "The number printed under the bars (EAN, UPC or your supplier's code), 4 to 64 characters with no spaces. Example: 7751234567890.",
  'help.catalog.error.barcode':
    'The barcode may only contain letters, digits, hyphens, underscores and dots, with no spaces.',
  'help.catalog.entryCode':
    'Internal identifier: lowercase letters, digits, hyphen or underscore, no spaces. It is suggested from the name. Example: personal-care.',
  'help.catalog.attributeCode':
    'Internal attribute identifier: starts with a letter and uses lowercase letters, digits or underscores. Example: main_color.',
  'help.catalog.attributeUnit':
    'Unit the value is expressed in, if any. It is shown next to the value on the product page. Example: kg, cm, ml.',
  'help.catalog.uomCode':
    'Short unit code, up to 16 characters: letters, digits, hyphen or underscore. Example: BOX12.',
  'help.catalog.uomSymbol':
    'Abbreviation the customer sees next to the price or quantity. Example: pc, kg, box.',
  'help.catalog.uomFactor':
    'How many base units this unit contains. Example: a box of 12 bottles has factor 12. The base unit is always 1.',
  'help.inventory.safetyStock':
    'It is subtracted from what the store can sell. Example: with 100 on hand and a buffer of 5, at most 95 are offered.',
  'help.inventory.reorderPoint':
    'When the available quantity reaches this figure or drops below it, the product shows up in Alerts. With 0 there is no alert. Example: 10.',
  'help.inventory.warehouseCode':
    'Short warehouse code, up to 31 characters: letters, digits, dot, hyphen or underscore, no spaces. Example: WH-LIMA01.',
  'help.inventory.staleMinutes':
    'Minutes without a fresh ERP sync after which the copied stock is treated as out of date. Example: 90.',
  'help.inventory.priority':
    'Order in which this warehouse is used to fulfil orders: the lowest number goes first. From 0 to 9999. Example: 10.',
  'help.inventory.country':
    'Two-letter ISO country code. Example: PE for Peru.',
  'help.pricing.code':
    'Internal list identifier: lowercase letters, digits, hyphen or underscore, no spaces, up to 41 characters. Example: wholesale-2026.',
  'help.pricing.segmentCode':
    'Internal segment identifier: lowercase letters, digits, hyphen or underscore, no spaces. It is suggested from the name. Example: distributors.',
  'help.pricing.currency':
    'Three-letter ISO currency code. Example: PEN for soles or USD for US dollars.',
  'help.pricing.priority':
    'If two lists with the same scope cover the same product, the one with the higher number wins. From 0 to 1000. Example: 10.',
  'help.pricing.validFrom':
    'Date and time from which the list starts to apply. Before that, the catalogue price is charged.',
  'help.pricing.validTo':
    'Date and time when the list stops applying. Leave it empty if it does not expire.',
  'help.pricing.minQuantity':
    'Volume pricing: it applies once the order line reaches this quantity, counted in base units. Example: with 12, it applies from 12 units.',
  'help.pricing.compareAt':
    'Previous price the store shows struck through next to the price. Leave it empty if this is not a sale.',
}
