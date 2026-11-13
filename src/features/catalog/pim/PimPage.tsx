import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { CatalogImportAction } from '../import/CatalogImportAction'
import { AttributesSection } from './AttributesSection'
import { CatalogEntrySection } from './CatalogEntrySection'
import { UnitsSection } from './UnitsSection'

/**
 * Catálogo avanzado: el vocabulario que comparten todos los productos de la
 * sociedad.
 *
 * Es una pantalla larga y densa con cuatro asuntos distintos, así que va con
 * tabs centrados y deep-link `#hash` (regla de suite §8) en vez de cuatro
 * entradas de menú: marca, familia, atributo y unidad se configuran juntos, al
 * dar de alta el catálogo, y separarlos multiplicaría la navegación sin separar
 * ninguna decisión.
 *
 * La ruta está gateada por `catalog.advanced` (P02-SaaS): sin el módulo
 * contratado, `CapabilityGate` pinta «no está en tu plan» y esta pantalla no
 * llega a montarse.
 */
export function PimPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status, can } = useTenant()

  // Importar va en la barra de cada pestaña, junto a actualizar: es una
  // acción sobre el listado, no sobre la pantalla. Es la MISMA importación
  // (el libro trae las cuatro hojas) desde cualquiera de las cuatro.
  const canWrite = can('catalog.write')
  const items = useMemo(() => {
    const tools = canWrite ? <CatalogImportAction kind="vocabulary" /> : undefined
    return [
      {
        id: 'marcas',
        label: t('pim.tab.brands'),
        content: <CatalogEntrySection kind="brands" tools={tools} />,
      },
      {
        id: 'familias',
        label: t('pim.tab.families'),
        content: <CatalogEntrySection kind="families" tools={tools} />,
      },
      { id: 'atributos', label: t('pim.tab.attributes'), content: <AttributesSection tools={tools} /> },
      { id: 'unidades', label: t('pim.tab.units'), content: <UnitsSection tools={tools} /> },
    ]
  }, [t, canWrite])

  // Mismo criterio que el listado de productos: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<TuneRoundedIcon />} title={t('pim.title')} subtitle={t('pim.subtitle')} />
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<TuneRoundedIcon />} title={t('pim.title')} subtitle={t('pim.subtitle')} />
        <Card>
          <EmptyState
            title={t('admin.store.none')}
            description={t('admin.store.noneBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  return (
    <>
      {/* Las pestañas suben a la fila del título: ahorran una franja entera
          antes de la tabla, que es lo que se viene a mirar. */}
      <SectionTabs
        items={items}
        ariaLabel={t('pim.title')}
        header={(tabs) => (
          <PageHeader
            icon={<TuneRoundedIcon />}
            title={t('pim.title')}
            subtitle={activeStore?.name ?? t('pim.subtitle')}
            center={tabs}
          />
        )}
      />
    </>
  )
}
