import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import { Fab, Zoom } from '@mui/material'
import { useEffect, useState } from 'react'
import { useT } from '@/shared/i18n/i18n-context'

/** A partir de aqui ya no se ve la cabecera: es cuando el boton hace falta. */
const UMBRAL = 700

/**
 * Volver arriba.
 *
 * Con carga al desplazarse, la pagina no tiene fondo: se puede acabar a tres
 * mil pixeles del buscador y de las categorias, y volver a rueda es una cuesta.
 * Este boton es la salida.
 *
 * ## Decisiones
 *
 * **No existe hasta que hace falta.** Se monta al pasar el umbral y desaparece
 * al volver: un boton flotante permanente tapa una esquina del catalogo desde
 * el primer momento a cambio de nada. Y al no estar en el DOM, tampoco esta en
 * el orden de tabulacion cuando no sirve.
 *
 * **Mueve el FOCO, no solo el scroll.** Llevar la vista arriba y dejar el foco
 * abajo deja a quien navega con teclado en el sitio de antes: el siguiente
 * tabulador seguiria en el pie. Por eso enfoca el `<main>`, que ya existe con
 * `tabIndex={-1}` para el enlace de saltar al contenido.
 *
 * **Respeta `prefers-reduced-motion`**: el desplazamiento suave de dos mil
 * pixeles es justo lo que marea a quien pide no ver movimiento.
 */
export function BackToTop({ anchorId }: { anchorId: string }) {
  const t = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > UMBRAL)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function subir() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    document.getElementById(anchorId)?.focus({ preventScroll: true })
  }

  return (
    <Zoom in={visible} unmountOnExit>
      <Fab
        size="medium"
        onClick={subir}
        aria-label={t('store.catalog.backToTop')}
        sx={{
          position: 'fixed',
          right: { xs: 16, md: 24 },
          bottom: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', md: 24 },
          zIndex: 3,
          bgcolor: 'var(--card)',
          color: 'var(--accent-deep)',
          border: '1px solid var(--sf-line-strong)',
          boxShadow: 'var(--sf-shadow-hover)',
          '&:hover': { bgcolor: 'var(--accent-soft)' },
        }}
      >
        <KeyboardArrowUpRoundedIcon />
      </Fab>
    </Zoom>
  )
}
