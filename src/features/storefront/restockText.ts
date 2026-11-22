import type { MessageKey } from '@/shared/i18n/messages'

/**
 * «Sueles pedirlo cada 15 días · te toca en 3 días». El motivo de cada línea de
 * reposición, el mismo en el chat y en la cuenta: un número sin motivo es un
 * número que nadie discute y por tanto nadie corrige.
 */
export function restockNote(
  t: (key: MessageKey) => string,
  item: { readonly cada_dias: number; readonly dias_restantes: number },
): string {
  const cada = t('store.restock.every').replace('{days}', String(item.cada_dias))
  const d = item.dias_restantes
  const cuando =
    d === 0
      ? t('store.restock.dueToday')
      : d === 1
        ? t('store.restock.dueTomorrow')
        : d > 1
          ? t('store.restock.dueIn').replace('{days}', String(d))
          : d === -1
            ? t('store.restock.overdueYesterday')
            : t('store.restock.overdue').replace('{days}', String(-d))
  return `${cada} · ${cuando}`
}
