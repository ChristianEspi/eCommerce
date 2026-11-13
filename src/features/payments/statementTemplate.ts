import type { ExcelBook, ExcelFormat, ImportColumn, ImportTable, Translate } from '@/shared/lib/excel'

/**
 * Plantilla Excel del extracto de conciliación.
 *
 * La conciliación sigue entrando por el cuadro de texto (`fecha;referencia;
 * bruto;comision;moneda`): el Excel no se sube a ningún sitio, se LEE en el
 * navegador y rellena ese cuadro. Así el operador ve lo que se va a cuadrar
 * antes de pulsar, y no hace falta bucket ni política de almacenamiento.
 */
const COLUMNS = [
  { key: 'settlement_date', id: 'date', format: 'date', required: true, width: 20 },
  { key: 'external_reference', id: 'reference', format: 'text', required: true, width: 28 },
  { key: 'gross_amount', id: 'gross', format: 'money', required: true, width: 16 },
  { key: 'fee_amount', id: 'fee', format: 'money', required: false, width: 14 },
  { key: 'currency', id: 'currency', format: 'text', required: false, width: 10 },
] as const satisfies readonly { key: string; id: string; format: ExcelFormat; required: boolean; width: number }[]

type ColumnId = (typeof COLUMNS)[number]['id']
const header = (id: ColumnId) => `payments.reconciliation.xlsx.col.${id}` as const
const description = (id: ColumnId) => `payments.reconciliation.xlsx.desc.${id}` as const

export function statementImportColumns(t: Translate): ImportColumn[] {
  return COLUMNS.map((column) => ({ key: column.key, header: t(header(column.id)) }))
}

export function statementTemplateBook(t: Translate): ExcelBook {
  const today = new Date()
  const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  return {
    fileName: 'plantilla-conciliacion',
    template: true,
    guide: {
      title: t('payments.reconciliation.xlsx.title'),
      paragraphs: [
        t('payments.reconciliation.xlsx.p1'),
        t('payments.reconciliation.xlsx.p2'),
        t('excel.guide.templateFormats'),
      ],
    },
    sheets: [
      {
        name: t('payments.reconciliation.xlsx.sheet'),
        columns: COLUMNS.map((column) => ({
          header: t(header(column.id)),
          description: t(description(column.id)),
          format: column.format,
          required: column.required,
          width: column.width,
        })),
        rows: [[day, 'OP-000123', 150, 4.5, 'PEN']],
      },
    ],
  }
}

/**
 * La tabla leída del Excel como las líneas del cuadro (`;`), en el orden que
 * espera el lector del extracto, sin importar el orden de las columnas en el
 * archivo. Las filas sin fecha, referencia ni importe se omiten.
 */
export function statementText(table: ImportTable): string {
  const at = (key: string) => table.keys.indexOf(key)
  const index = COLUMNS.map((column) => at(column.key))
  return table.rows
    .map((row) => index.map((position) => (position >= 0 ? (row[position] ?? '') : '')))
    .filter(([date, reference, gross]) => Boolean(date && reference && gross))
    .map((fields) => fields.map((field) => field.replace(/[;\r\n]/g, ' ')).join(';'))
    .join('\n')
}
