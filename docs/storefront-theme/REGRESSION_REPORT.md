# Regresión completa del eCommerce tras el Theme Engine

Fecha: 2026-09-10 · Rama `dev` · Sin desplegar · Base de comparación: `a380e09`.

## Resumen

| Puerta | Antes (`a380e09`) | Ahora | Estado |
|---|---|---|---|
| `npm run typecheck` | limpio | limpio | PASA |
| `npm run lint` | limpio | limpio | PASA |
| `npm run test` | 3 124 pruebas | **3 509** pruebas, 180 archivos | PASA |
| `npm run test:db` | — | **1 985** pruebas, 73 archivos | PASA |
| `npm run build` | ok | ok, 6,4 s | PASA |
| `npm run scan:secrets` | sin hallazgos | sin hallazgos | PASA |
| `npm run bundle:report` | portada 398,3 kB | portada **397,1 kB** | PASA |
| `npx playwright test` | 3 fallos preexistentes | los **mismos 3** | Ver abajo |

Ninguna prueba se borró ni se saltó para pasar una puerta. Dos se **invirtieron**
a propósito, y las dos están explicadas más abajo.

## Regresión comercial

Lo que sigue está cubierto por la suite existente, que pasa entera:

| Área | Cobertura |
|---|---|
| Carrito de invitado y carrito con sesión | `cart.test.ts`, `cart-quote.test.tsx`, `guest-cart-retention` |
| Producto simple y producto con variantes | `ProductCard.test.tsx`, `ProductCard.theme.test.tsx` (× 4 temas) |
| Favoritos | `favorites.test.tsx`, `favorites-shared.test.tsx` |
| Búsqueda y facetas | `catalog-search`, `storefront-ui.test.tsx` |
| Promociones y descuentos | `storefront-content.test.tsx`, `theme-parity.test.tsx` |
| Precios B2B | `b2b-price.test.tsx` |
| Checkout que exige cuenta | `checkout-ui.test.tsx`, `checkout-pipeline` |
| Impuestos | `currencies_and_taxes`, `taxes.test.ts` |
| Pipeline de pago y pedido | `checkout-order`, `checkout-orchestrator` |
| Creación, estado y seguimiento de pedido | `orders`, `order-status` |
| CMS sin capacidad contratada | `cms-content`, `content_capability` |
| Aislamiento entre tenants (RLS real) | `supabase/tests/*` contra Postgres |
| Campos públicos de `anon` | `storefront-theme.test.ts` (bloque J) |
| SEO y accesibilidad | `storefront-a11y-seo.test.tsx`, `theme-hardening.test.tsx` |

## Las dos pruebas invertidas

**1. El contacto del comercio en el pie.** Existía un test que fijaba su AUSENCIA
(«constancia de una pérdida»), con la nota de que un bloque del CMS podía
pintarlo donde el comercio quisiera. En la práctica eso había que hacerlo y no
ocurría solo: una tienda publicaba su correo en la configuración y no salía en
ninguna parte. P13 lo recupera con la condición que lo hacía peligroso resuelta
—solo lo que el comercio escribió—, y el test pasa a fijar lo contrario.

**2. La descripción en la vista rápida.** Pasa de `getBy` a `findBy` porque el
diálogo ahora se carga aparte y aparece un instante antes que su contenido. No
cambia lo que se afirma; cambia cuándo se afirma.

## Hallazgos reales de P17

**Desbordamiento horizontal de 8 px (CORREGIDO).** En el `sx` de MUI un número
entre 0 y 1 es un porcentaje: `width: 1` valía «100 %». El enlace «Ir al
contenido», escondido y colocado a 8 px del borde, medía la pantalla entera y
sobresalía esos 8 px, así que **la tienda se arrastraba de lado en un teléfono**
por culpa de un enlace que nadie ve. Es anterior al Theme Engine y solo se veía
en un navegador de verdad: jsdom no calcula diseño. Corregido y cubierto con e2e
a 320 y 360 px.

**Un 400 en cada primera carga (CORREGIDO).** La vitrina pedía la tienda con una
lista explícita de columnas. PostgREST no ignora una columna que no existe:
devuelve 400 y tumba la consulta entera, así que durante un despliegue en el que
la app sale antes que su migración la vitrina se quedaría **sin tienda**, no sin
tema. Se probó con un reintento sin las columnas nuevas; funcionaba, pero dejaba
un 400 en el registro de cada carga. Ahora se pide la vista entera: la frontera
de lo publicable es `public_stores`, no la lista de columnas.

**La portada se pasaba del techo (CORREGIDO).** El Theme Engine costaba 4,7 kB
gzip y la portada ya estaba a 1,7 kB de su límite de 400. Se pagó con una mejora
real: la vista rápida —cuatrocientas líneas de diálogo que la mayoría de las
visitas no abre— viaja en su propio trozo. Resultado: **397,1 kB**, por debajo
del techo y por debajo de lo que pesaba antes de esta fase.

## Lo que sigue roto y no es de esta fase

Tres pruebas e2e del checkout fallan (`el checkout avanza por tres pasos`,
`volver atrás sin perder lo escrito`, `las instrucciones antes de pedir`), en
escritorio y en móvil. El carrito llega VACÍO a `/checkout`.

**Se verificó que es anterior al Theme Engine**: se recuperó el commit `a380e09`
y la misma prueba falla igual. No es una regresión de este trabajo y no se toca
aquí, pero queda anotado porque afecta a la demo.

Las otras 18 pruebas e2e pasan en escritorio y en móvil, incluidas las cuatro
nuevas del Theme Engine.

## Rendimiento

| Recorrido | Antes | Ahora | Techo |
|---|---|---|---|
| vitrina · portada | 398,3 | **397,1** | 400 |
| vitrina · ficha de producto | 377,3 | 381,3 | 400 |
| vitrina · checkout | 393,8 | 397,5 | 430 |
| backoffice · panel | 351,8 | 353,0 | 430 |

Sin consultas nuevas: una prueba cuenta las llamadas de la portada con todas las
secciones encendidas y con todas apagadas, y son las mismas que por defecto.
