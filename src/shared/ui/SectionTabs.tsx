import { Box, Tab, Tabs } from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'

export interface SectionTabItem {
  /** Se usa como `#hash` para el deep-link. */
  id: string
  label: string
  content: ReactNode
}

/**
 * Tabs centrados para pantallas largas/densas (contrato §8, regla gmao-025).
 * Deep-link por `#hash`: la pestaña abierta es compartible y sobrevive al refresco.
 */
export function SectionTabs({
  items,
  ariaLabel,
  header,
}: {
  items: SectionTabItem[]
  ariaLabel: string
  /**
   * Para subir las pestañas a la cabecera de la pantalla (p. ej. al `center`
   * de `PageHeader`): recibe las pestañas ya montadas y devuelve la cabecera.
   * Sin él, las pestañas van solas encima del panel, como siempre.
   */
  header?: (tabs: ReactNode) => ReactNode
}) {
  const fallback = items[0]?.id ?? ''
  const [active, setActive] = useState<string>(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '')
    return items.some((i) => i.id === hash) ? hash : fallback
  })

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace('#', '')
      if (items.some((i) => i.id === hash)) setActive(hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [items])

  function select(id: string) {
    setActive(id)
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${id}`)
  }

  const current = items.find((i) => i.id === active) ?? items[0]

  const tabs = (
    <Tabs
      value={current?.id ?? false}
      onChange={(_, value: string) => select(value)}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label={ariaLabel}
      sx={{
        borderBottom: header ? 'none' : '1px solid var(--border)',
        // En la cabecera ocupan todo el hueco: un scroller sin ancho propio
        // puede encogerse a cero dentro de una fila flex.
        width: header ? '100%' : undefined,
        '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 44 },
        '& .MuiTabs-flexContainer > :first-of-type': { ml: 'auto' },
        // En la cabecera van pegadas a la DERECHA, al final de la fila del
        // título (lo pidió el operador, 2026-11-13): centradas en el hueco
        // dejaban un vacío a su derecha que se leía como algo que falta.
        // Fuera de la cabecera siguen centradas.
        '& .MuiTabs-flexContainer > :last-of-type': { mr: header ? 0 : 'auto' },
      }}
    >
      {items.map((item) => (
        <Tab key={item.id} value={item.id} label={item.label} id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} />
      ))}
    </Tabs>
  )

  return (
    <Box>
      {/* Centradas cuando caben y desplazables cuando no.
          `centered` de MUI no admite desplazamiento: con seis pestañas a 390 px
          las de los extremos quedaban FUERA de la pantalla y no había forma de
          llegar a ellas (visto en el portal B2B en móvil, hardening H12). Con
          `scrollable` y márgenes automáticos en la primera y la última, el
          grupo se centra mientras sobra sitio y, cuando falta, los márgenes
          valen cero y todo se alcanza deslizando. */}
      {header ? header(tabs) : tabs}
      {current && (
        <Box role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} sx={{ pt: header ? 0 : 3 }}>
          {current.content}
        </Box>
      )}
    </Box>
  )
}
