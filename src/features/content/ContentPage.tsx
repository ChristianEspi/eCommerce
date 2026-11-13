import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { BlocksSection } from './BlocksSection'
import { PagesSection } from './PagesSection'
import { PreviewSection } from './PreviewSection'
import { SynonymsSection } from './SynonymsSection'

/**
 * Contenido: qué ve el comprador y cómo lo encuentra.
 *
 * Cuatro caras de la misma pregunta —«¿por qué la tienda se ve así?»— y por eso
 * van en tabs centrados con deep-link `#hash` (regla de suite §8) y no en
 * cuatro entradas de menú. El orden no es alfabético: primero las páginas, que
 * es a lo que se entra casi siempre; los sinónimos son la respuesta a un
 * problema («la gente busca X y no encuentra nada»), no la visita del lunes.
 *
 * La página seleccionada es estado de ESTA pantalla y no de la URL: bloques y
 * vista previa cuelgan de ella, y meterla en el `#hash` chocaría con el
 * deep-link de la pestaña, que es lo que la regla de suite pide compartir.
 *
 * La ruta está gateada por la capacidad `content.cms`. Sin el módulo,
 * `CapabilityGate` pinta «no está en tu plan» y la vitrina sigue pintando el
 * hero de `store_settings` y el catálogo — lo que pintaba antes de P11. Se
 * degrada, no se rompe.
 */
export function ContentPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  const [pageId, setPageId] = useState<string | null>(null)

  const items = useMemo(
    () => [
      {
        id: 'paginas',
        label: t('content.tab.pages'),
        content: <PagesSection selectedPageId={pageId} onSelectPage={setPageId} />,
      },
      { id: 'bloques', label: t('content.tab.blocks'), content: <BlocksSection pageId={pageId} /> },
      {
        id: 'vista-previa',
        label: t('content.tab.preview'),
        content: <PreviewSection pageId={pageId} />,
      },
      { id: 'sinonimos', label: t('content.tab.synonyms'), content: <SynonymsSection /> },
    ],
    [t, pageId],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<ArticleRoundedIcon />} title={t('content.title')} subtitle={t('content.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<ArticleRoundedIcon />} title={t('content.title')} subtitle={t('content.subtitle')} />
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
      <SectionTabs
        items={items}
        ariaLabel={t('content.title')}
        header={(tabs) => (
          <PageHeader
            icon={<ArticleRoundedIcon />}
            title={t('content.title')}
            subtitle={activeStore?.name ?? t('content.subtitle')}
            center={tabs}
          />
        )}
      />
    </>
  )
}
