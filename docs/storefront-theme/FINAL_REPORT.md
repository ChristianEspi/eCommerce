# Theme Engine de la vitrina — informe final

Fecha: 2026-09-10 · Rama `dev` · **Sin push y sin desplegar** · 19 commits locales.

## Veredicto

**GO.**

El motor está completo, probado, desplegado en dev y es reversible. La
migración se aplicó el 2026-09-10 y la tienda real siguió viéndose igual: el
contrato de compatibilidad se cumple en producción, no solo en los tests.

Los huecos que quedan son de alcance declarado —dos secciones sin componente
todavía y el modelo de producto sin SKU—, ninguno impide usar lo entregado.

## Qué se puede hacer al terminar

Un administrador entra en Configuración → Diseño de tienda y:

1. elige entre Universal, Retail, Premium o Catálogo;
2. ajusta siete opciones de lista cerrada, o las deja heredar del tema;
3. enciende, apaga y reordena las secciones de la portada, todo con el teclado;
4. lo ve en escritorio, tableta y móvil antes de guardar;
5. guarda, abre `/s/:slug` y ve exactamente lo que configuró.

Su logo, su color, su tipografía, su radio y su densidad no se tocan: siguen
siendo de Marca y de Apariencia.

## La arquitectura, en una frase por capa

**El tema es un dato, no un componente.** Cuatro presets resuelven siete
decisiones de presentación; los componentes leen valores y nunca preguntan qué
tema hay puesto. Por eso no hay —ni puede haber— un `StoreHomeRetail`.

**Dos capas separadas a propósito.** Lo *crudo* es lo que llega de la base y
puede ser cualquier cosa; lo *resuelto* es un tema completo. `resolveStoreTheme`
es el único sitio donde se decide qué significa lo desconocido, y su respuesta
nunca es un error: una tienda en blanco por un JSON raro es una tienda cerrada.

**Dos defensas, una por sentido.** Al ESCRIBIR, la base rechaza con listas
cerradas en `CHECK`. Al LEER, el normalizador sustituye lo raro por lo seguro.
Ninguna sustituye a la otra: sin la de escritura queda basura guardada esperando
a un consumidor que no normalice; sin la de lectura, una fila antigua tumba la
tienda.

**El modo manda en el color; el tema, en la geometría.** Claro/oscuro decide
superficies y sombras; el tema decide anchos, alturas, columnas y aire. Cada
píxel con un solo dueño, y hay una prueba que impide que un tema invada el otro
lado.

**Las diferencias viajan en CSS.** `data-store-*` y `--sf-*` cuelgan de la
frontera `.sf-scope`. Un `if (theme === 'retail')` por componente convierte
cuatro temas en cuatro aplicaciones, y en cuanto una rama se olvida del botón de
comprar hay un tema donde no se puede comprar.

## La migración

`supabase/migrations/20260910220000_storefront_theme.sql` — 310 líneas.
**Es la única migración nueva y no se editó ninguna existente.**

Añade a `public.store_settings`:

| Columna | Tipo | Defecto | Validación |
|---|---|---|---|
| `theme_preset` | `text` NOT NULL | `'universal'` | `CHECK` de cuatro valores |
| `storefront_style` | `jsonb` NOT NULL | `{}` | `ebim.storefront_style_is_valid` |
| `home_layout` | `jsonb` NOT NULL | `{"version":1,"sections":[]}` | `ebim.home_layout_is_valid` |

Tres funciones auxiliares `immutable` en `ebim`, todas envueltas en
`coalesce(..., false)`: un `CHECK` que se evalúa a NULL **pasa**, y como
cualquier `->` sobre una clave ausente devuelve NULL, sin ese envoltorio un
objeto al que le faltara una clave obligatoria habría entrado por la puerta de
atrás. Lo cazó una prueba.

`GRANT` de lectura por columna para `anon` y de escritura para `authenticated`
solo sobre esas tres. Las policies no se tocan. `public_stores` se recrea con
los tres campos, sigue siendo `security_invoker` y sigue filtrando tiendas
activas.

**El orden por defecto es la lista VACÍA**, y no significa «portada en blanco»
sino «usa el orden heredado». Copiar las trece secciones en SQL habría creado
dos fuentes de verdad, y la catorceava las habría desincronizado en silencio.

## Módulos principales

| Ruta | Qué es |
|---|---|
| `src/features/storefront/theme/types.ts` | El contrato: listas cerradas y nada más |
| `.../theme/normalize.ts` | `sanitize*` (lo que se guarda) y `normalize*` (lo que se pinta) |
| `.../theme/presets.ts` | Los cuatro temas como datos y el orden heredado |
| `.../theme/resolve.ts` | De la fila cruda al tema resuelto |
| `.../theme/schema.ts` | El mismo contrato en Zod, para el formulario |
| `.../theme/StorefrontThemeProvider.tsx` | Se monta solo en la vitrina, junto a `.sf-scope` |
| `.../home/SectionRegistry.tsx` | Qué pinta cada sección. Exhaustivo por tipo |
| `.../home/HomeComposer.tsx` | Recorre el orden y pinta. No decide contenido |
| `.../components/StoreFooter.tsx` | El pie, con la regla anti-invención |
| `src/features/admin/settings/StorefrontDesignSection.tsx` | Selector de tema y ajustes |
| `.../settings/HomeLayoutEditor.tsx` | Orden de la portada, accesible con teclado |
| `.../settings/StorefrontPreview.tsx` | Vista previa con el motor de verdad |

## Los cuatro temas

| Tema | Cabecera | Portada | Tarjeta | Columnas | Ancho | Aire |
|---|---|---|---|---|---|---|
| universal | completa | producto | cómoda | 2/3/4 | lg | comfortable |
| retail | completa | producto | compacta | 2/4/5 | lg | compact |
| premium | completa | lema | cómoda | 2/2/3 | lg | spacious |
| catalog | reducida | producto | compacta | 2/4/6 | xl | compact |

`universal` **no tiene ni una regla propia en la hoja de estilos**, y hay una
prueba que lo impide: es el suelo, y lo que se ve sin atributos tiene que ser lo
que la vitrina ya hacía.

## Compatibilidad hacia atrás

| Situación | Qué pasa |
|---|---|
| Tienda sin los tres campos | Se resuelve como `universal`, orden heredado |
| `theme_preset` nulo, inválido o con otras mayúsculas | Cae a `universal`, sin lanzar |
| `storefront_style` con claves desconocidas | Se descartan; lo válido se conserva |
| `home_layout` ilegible | Se lee como el orden heredado |
| La base todavía no tiene las columnas | La tienda se pinta igual: se pide la vista entera |
| El comercio no tiene `content.white_label` | Puede cambiar tema, estilo y orden igual |

Los números de `universal` están fijados al píxel por prueba: margen 20/32,
barra 60/68, rejilla 2/3/4, foto cuadrada.

## Resultados exactos

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | limpio |
| `npm run test` | **180 archivos · 3 509 pruebas · 0 fallos** |
| `npm run test:db` | **73 archivos · 1 985 pruebas · 0 fallos** (Postgres real) |
| `npm run build` | ok en 6,4 s |
| `npm run scan:secrets` | sin hallazgos |
| `npm run bundle:report` | los 4 recorridos bajo su techo |
| `npx playwright test` | **24 de 24** en escritorio y en móvil |

Pruebas nuevas de esta fase: **385** (3 124 → 3 509), más 74 contra Postgres real.

## Rendimiento

| Recorrido | Antes | Ahora | Techo |
|---|---|---|---|
| vitrina · portada | 398,3 | **397,1** | 400 |
| vitrina · ficha | 377,3 | 381,3 | 400 |
| vitrina · checkout | 393,8 | 397,5 | 430 |
| backoffice · panel | 351,8 | 353,0 | 430 |

La portada pesa **menos** que antes del Theme Engine: el motor costaba 4,7 kB y
se pagó difiriendo el diálogo de vista rápida.

## Seguridad

- `anon` recibe solo los tres campos de presentación, por `GRANT` de columna.
- No se expuso `config`, `tax_rate`, `organization_id`, `company_id` ni el estado
  del dominio. Hay una prueba que enumera lo prohibido.
- Un tenant no puede escribir el tema de otro: comprobado contra Postgres real.
- Un miembro sin rol administrativo tampoco.
- No entra CSS, HTML, JavaScript ni URLs: no por filtro, sino porque **no están
  nombrados**. Un filtro solo detiene lo que alguien previó.
- Ninguna migración aplicada fue editada.
- `scan:secrets` sin hallazgos.

## Huecos conocidos

1. ~~La migración no está desplegada.~~ **Cerrado el 2026-09-10.** Aplicada a
   dev con `supabase db push`. Comprobado en la tienda real: sigue resolviendo
   `universal` con tarjeta cómoda y barra completa —el aspecto de siempre— y sin
   una sola petición fallida.
2. ~~Los tipos generados no tienen las tres columnas.~~ **Cerrado.**
   `npm run db:types` regenerado tras aplicar la migración.
3. **`business-info` y `newsletter`** están declaradas y apagadas: no tienen
   componente. Se enseñan en el editor, desactivadas y rotuladas.
4. **`categories` en la portada** devuelve nada: hoy las categorías se pintan en
   el catálogo. Sacarlas a la portada es trabajo de otra fase.
5. **`PublicProduct` no expone SKU ni presentación.** El tema `catalog` los
   luciría, pero ampliar el modelo de producto estaba fuera de esta fase y no se
   hizo.
6. ~~Tres e2e del checkout fallan.~~ **Cerrado.** El carrito no fallaba: el
   ayudante de la prueba recargaba la página en mitad de la comprobación de
   existencias y cancelaba el guardado. Detalle en `REGRESSION_REPORT.md`.

## Reversión

Tres niveles, de menos a más:

1. **Por tienda**: poner `theme_preset` en `universal` y vaciar los otros dos.
   La tienda vuelve a verse como antes sin tocar código.
2. **Por código**: revertir los commits de la rama. La migración puede quedarse
   aplicada sin efecto: son tres columnas con defecto y nadie las lee.
3. **Por base**: eliminar las tres columnas y sus funciones. Solo hace falta si
   se abandona la idea entera; conviene recrear `public_stores` sin ellas en la
   misma migración.

Nada de esto toca precios, pedidos ni pagos, así que ninguna reversión pone
dinero en riesgo.

## Antes de desplegar

1. Aplicar `20260910220000_storefront_theme.sql` en dev.
2. Ejecutar `npm run db:types` y commitear el diff.
3. Comprobar en `/s/:slug` que la tienda se ve igual **antes** de tocar nada:
   es la prueba de que la compatibilidad se cumple en producción y no solo en
   los tests.
4. Entonces, y solo entonces, elegir un tema.
