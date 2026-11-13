import type { MessageKey } from '@/shared/i18n/messages'
import { excelDate, excelNumber, type ExcelBook, type Translate } from '@/shared/lib/excel'
import type { Complaint } from './api'

const KIND_LABEL: Record<Complaint['kind'], MessageKey> = {
  reclamo: 'store.complaints.kind.reclamo',
  queja: 'store.complaints.kind.queja',
}

const STATUS_LABEL: Record<Complaint['status'], MessageKey> = {
  received: 'complaints.status.received',
  in_progress: 'complaints.status.inProgress',
  answered: 'complaints.status.answered',
}

type ComplaintColumn =
  | 'code' | 'date' | 'kind' | 'status' | 'consumer' | 'document' | 'email'
  | 'item' | 'amount' | 'detail' | 'request' | 'response'

/**
 * El Libro de Reclamaciones a Excel (antes CSV, con las cabeceras escritas a
 * mano en español y el tipo y estado en clave interna: `in_progress`).
 */
export function complaintsBook(rows: readonly Complaint[], t: Translate, fileName: string): ExcelBook {
  const col = (id: ComplaintColumn, format: 'text' | 'money' | 'datetime', width?: number) => ({
    header: t(`complaints.xlsx.col.${id}`),
    description: t(`complaints.xlsx.desc.${id}`),
    format,
    ...(width ? { width } : {}),
  })
  return {
    fileName,
    guide: { title: t('complaints.xlsx.title'), paragraphs: [t('complaints.xlsx.intro')] },
    sheets: [
      {
        name: t('complaints.xlsx.sheet'),
        columns: [
          col('code', 'text', 16),
          col('date', 'datetime', 18),
          col('kind', 'text'),
          col('status', 'text'),
          col('consumer', 'text', 28),
          col('document', 'text'),
          col('email', 'text', 30),
          col('item', 'text', 32),
          col('amount', 'money'),
          col('detail', 'text', 60),
          col('request', 'text', 40),
          col('response', 'text', 60),
        ],
        rows: rows.map((c) => [
          c.code,
          excelDate(c.created_at),
          t(KIND_LABEL[c.kind]),
          t(STATUS_LABEL[c.status]),
          c.consumer_name,
          `${c.doc_type.toUpperCase()} ${c.doc_number}`,
          c.consumer_email,
          c.item_description,
          excelNumber(c.amount),
          c.detail,
          c.request,
          c.response ?? null,
        ]),
      },
    ],
  }
}
