# Rendimiento del Release Candidate (R09)

Techos **sin cambios**: portada 405 · ficha 400 · checkout 430 · panel 430 kB gzip (`scripts/bundle-report.mjs`).

| Recorrido | R00 | R09 | Techo | Margen |
|---|---|---|---|---|
| vitrina · portada | 402,3 | **402,3** | 405 | 2,7 kB (0,7 %) |
| vitrina · ficha | 386,2 | **386,2** | 400 | 13,8 kB |
| vitrina · checkout | 404,6 | **404,6** | 430 | 25,4 kB |
| backoffice · panel | 360,7 | **360,7** | 430 | 69,3 kB |

R01 y R02 no movieron un byte de la portada (invalidación de una clave más al cambiar de cuenta, en un chunk
perezoso; `satisfies` no genera código).

## Qué pesa en la portada (medido)

Archivos del recorrido, gzip real del build:

| Pieza | kB | Nota |
|---|---|---|
| Entrada `index-*.js` (shell de la app) | 126,9 | ver desglose |
| `vendor-supabase` | 56,3 | cliente anónimo del catálogo: necesario para pintar |
| `vendor-react` | 44,9 | |
| `vendor-router` | 21,7 | |
| `StoreHomePage` | 14,3 | |
| `vendor-query` | 12,1 | |
| `Tooltip` (MUI + Popper) | 11,3 | lo usa el corazón de favoritos de `ProductCard` |
| `StorefrontLayout` | 11,1 | |
| `vendor-emotion` | 10,9 | |
| `ContentBlocks` | 7,8 | bloques CMS de la portada |

Desglose aproximado de la entrada (gzip de las fuentes desde el sourcemap; sobrestima porque incluye comentarios):
`@mui/material` ~73, diccionario ES ~51, `@mui/system` ~39, `zod` ~23, `db-schema.ts` ~10 (casi todo comentario),
`@mui/utils` ~10, `react-transition-group` ~9, `domain/boundaries` y `domain/capabilities` ~9 cada uno.

## Opciones evaluadas y por qué no se aplicaron

| Opción | Medición / razón | Decisión |
|---|---|---|
| Sacar `zod` de la entrada importando `@/domain/capabilities` en vez del barril `@/domain` (`CapabilitiesProvider`, `CapabilityGate`) | **Probado**: portada 402,3 → **402,8** (peor). `zod` sigue entrando por la validación del contexto de plataforma (`effectiveCapabilitiesSchema`) en el arranque; el cambio solo reparte chunks peor | Revertido |
| Quitar el `Tooltip` del corazón de favoritos (11,3 kB) | Cambia comportamiento visible (tooltip de «Guardar»/«Quitar») y accesibilidad percibida | No |
| Tooltip perezoso | Separación no natural (un componente de hover con import dinámico) para un control de la tarjeta más caliente de la tienda | No |
| Partir el diccionario ES por área | Contradice la regla 1 de `messages.ts` (ES estático como suelo del fallback) y toca la base de i18n de toda la app | No en un RC |
| Carga perezosa del cliente Supabase | La portada lee el catálogo con él en el primer render | No aplica |

**Conclusión:** no hay una mejora clara, natural y sin cambio de comportamiento. No se tocó nada. El margen de la
portada (2,7 kB) sigue siendo el riesgo principal de rendimiento para la próxima funcionalidad de vitrina; la
palanca con mejor relación es una fase dedicada de i18n por áreas, fuera de este RC (ver
`docs/performance-budget.md` §2.2).
