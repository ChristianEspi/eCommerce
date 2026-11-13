import { excelDate, excelNumber, type ExcelBook, type Translate } from '@/shared/lib/excel'
import type { TimeseriesRow } from './types'

/**
 * La serie diaria de ventas a Excel (antes CSV): una fila por día, el día como
 * FECHA y el importe como número, para cruzarla con el ERP sin convertir nada.
 */
export function analyticsBook(rows: readonly TimeseriesRow[], days: number, t: Translate): ExcelBook {
  return {
    fileName: `${t('exports.analytics.sheet').toLowerCase()}-${days}d`,
    guide: {
      title: t('exports.analytics.title'),
      paragraphs: [t('exports.analytics.intro').replace('{days}', String(days))],
    },
    sheets: [
      {
        name: t('exports.analytics.sheet'),
        columns: [
          { header: t('analytics.csv.day'), description: t('exports.analytics.desc.day'), format: 'date', width: 14 },
          { header: t('analytics.csv.orders'), description: t('exports.analytics.desc.orders'), format: 'integer' },
          { header: t('analytics.csv.units'), description: t('exports.analytics.desc.units'), format: 'integer' },
          { header: t('analytics.csv.revenue'), description: t('exports.analytics.desc.revenue'), format: 'money', width: 16 },
          { header: t('analytics.csv.currency'), description: t('exports.analytics.desc.currency'), format: 'text', width: 10 },
        ],
        rows: rows.map((row) => [
          excelDate(row.day),
          row.orders,
          row.units,
          excelNumber(row.revenue),
          row.currency ?? null,
        ]),
      },
    ],
  }
}
