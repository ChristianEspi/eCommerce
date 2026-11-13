import type { MessageKey } from '@/shared/i18n/messages'
import type { ExcelBook, ExcelFormat, ImportColumn, Translate } from '@/shared/lib/excel'
import { PRICE_CSV_HEADERS } from './importCsv'

type PriceKey = (typeof PRICE_CSV_HEADERS)[number]

/**
 * Las columnas de la plantilla de precios, en el orden de `PRICE_CSV_HEADERS`.
 *
 * La cabecera del libro es la CLARA («Precio unitario»); la importación la
 * traduce a la técnica (`unit_price`) antes de pasar por `parsePriceCsv`, así
 * que la validación sigue siendo una sola. Un CSV con las cabeceras técnicas
 * de siempre se sigue aceptando.
 */
const COLUMNS: Record<PriceKey, { id: string; format: ExcelFormat; required: boolean; width?: number }> = {
  sku: { id: 'sku', format: 'text', required: true, width: 20 },
  variant_sku: { id: 'variantSku', format: 'text', required: false, width: 20 },
  uom_code: { id: 'uom', format: 'text', required: false, width: 12 },
  min_quantity: { id: 'minQuantity', format: 'decimal', required: true, width: 18 },
  unit_price: { id: 'unitPrice', format: 'money', required: true, width: 18 },
  compare_at_price: { id: 'compareAt', format: 'money', required: false, width: 26 },
}

const header = (key: PriceKey) => `exports.pricing.col.${COLUMNS[key].id}` as MessageKey
const description = (key: PriceKey) => `exports.pricing.desc.${COLUMNS[key].id}` as MessageKey

export function priceImportColumns(t: Translate): ImportColumn[] {
  return PRICE_CSV_HEADERS.map((key) => ({ key, header: t(header(key)) }))
}

/** La plantilla de una lista: hoja «Precios» con una fila de ejemplo y su guía. */
export function priceTemplateBook(listCode: string, t: Translate): ExcelBook {
  return {
    fileName: `plantilla-precios-${listCode}`,
    template: true,
    guide: {
      title: t('exports.pricing.title').replace('{code}', listCode),
      paragraphs: [
        t('exports.pricing.p1'),
        t('exports.pricing.p2'),
        t('exports.pricing.p3'),
        t('exports.pricing.p4'),
        t('excel.guide.templateFormats'),
        t('excel.guide.leadingZeros'),
      ],
    },
    sheets: [
      {
        name: t('exports.pricing.sheet'),
        columns: PRICE_CSV_HEADERS.map((key) => ({
          header: t(header(key)),
          description: t(description(key)),
          format: COLUMNS[key].format,
          required: COLUMNS[key].required,
          ...(COLUMNS[key].width ? { width: COLUMNS[key].width } : {}),
        })),
        rows: [['SKU-EJEMPLO', null, null, 1, 99.9, null]],
      },
    ],
  }
}
