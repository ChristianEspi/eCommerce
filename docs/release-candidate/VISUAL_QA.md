# QA visual del Release Candidate (R08)

Pila local desechable, servidor de desarrollo en el 5199, Chromium de Playwright. Recorrido automatizado (script
fuera del repositorio) con **4 temas × 3 audiencias × 3 viewports** = 36 combinaciones.

| Eje | Valores |
|---|---|
| Temas | Universal, Retail, Premium, Catalog (se cambió `store_settings.theme_preset` de la tienda LOCAL y se encendió la sección `categories`; al terminar se restauró `universal` y el orden de portada original) |
| Audiencias | Consumer (`consumer@hardening.test`), Trade (usuario multi-cuenta con la cuenta Boreal elegida: selector + precio comercial), Enterprise (`enterprise@hardening.test`: convenio + OC obligatoria) |
| Viewports | 1440×900, 1024×768, 390×844 |
| Páginas | portada, catálogo (`?ver=todo`), carrito, checkout (pasos 1→3), cuenta |

## Resultado: **792 comprobaciones · 792 OK · 0 fallos**

| Comprobación | Veces | Resultado |
|---|---|---|
| Tema aplicado (`data-store-theme` = el configurado) | 36 | OK |
| Sin desbordamiento horizontal (portada, catálogo, carrito, cuenta) | 144 | OK |
| Checkout pasos 1, 2 y 3 sin desbordamiento | 108 | OK |
| Cabecera visible · pie presente | 72 | OK |
| Sección «Compra por categoría» pintada | 36 | OK |
| Tarjetas de producto (≥ 4) y ninguna más ancha que su columna | 72 | OK |
| Consumer: sin barra de empresa · sin precio comercial · cuenta de consumidor | 36 | OK |
| Trade/Enterprise: barra de contexto visible, dentro del viewport y con su audiencia | 72 | OK |
| Trade: selector de cuenta visible · «Tu precio comercial» en tarjeta | 24 | OK |
| Enterprise: campo de orden de compra visible y dentro del viewport · Trade/Consumer sin campo | 48 | OK |
| Carrito: total confirmado por el servidor | 36 | OK |
| Checkout sin asistente flotante (N07) | 36 | OK |
| Portal B2B / cuenta del consumidor · todas las pestañas alcanzables | 72 | OK |
| Sin errores de consola (por tema y audiencia) | 12 | OK |

## Capturas representativas

En [`visual/`](visual/) (fuera de `src/` y de `dist/`): portada Universal consumidor 1440, portada Premium trade 390
(selector con nombre largo recortado), portada Catalog enterprise 1440 («Comprando para · Precio convenio activo»),
checkout Retail enterprise 390 con la orden de compra, cuenta trade y consumidor a 390. El resto de capturas del
recorrido (31) quedó en el directorio temporal de la sesión.

## Cambios de diseño

**Ninguno.** No se observó ningún defecto: no se tocó el Theme Engine, la composición ni el branding.
