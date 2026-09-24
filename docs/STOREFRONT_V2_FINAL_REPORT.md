# Storefront V2 + Design Workspace V2 — informe final

Ejecución completa del pack `EBIM_ECOMMERCE_STOREFRONT_V2` (P00–P14) sobre este repositorio.
El detalle fase a fase —con sus ciclos correctivos y sus decisiones— está en
[`STOREFRONT_V2_STATUS.md`](./STOREFRONT_V2_STATUS.md). Esto es la síntesis.

- **Rama:** `feat/storefront-v2-design-workspace` (desde `dev`)
- **HEAD inicial (P00):** `cd7a82d1715dd346169572d99749434969119835`
- **HEAD final:** ver `git log -1` de la rama
- **PUSH: NO · DEPLOY: NO · MIGRACIONES REMOTAS: NO**

---

## 1 · Resumen ejecutivo

### El problema de partida

Una tienda de calzado abría su vitrina y leía **«Atención farmacéutica»**. Nadie había escrito
`if (esFarmacia)`: lo que pasaba es que los valores por defecto de la plataforma eran los de un
rubro. La franja de servicios traía dos afirmaciones de botica cableadas en el componente, la tabla
de iconos de categoría tenía diez entradas de farmacia sobre catorce, y la portada titulaba **«Lo
más vendido»** una lista que salía del orden por relevancia del buscador.

Y la pantalla donde se arregla todo eso —«Diseño de tienda»— era un formulario largo con la vista
previa **al final**: se elegía un tema arriba y se veía el efecto varias pantallas después, cuando
ya no se recordaba qué se había tocado.

### Lo que cambia

| | Antes | Ahora |
|---|---|---|
| Copy de servicios | cuatro frases cableadas, dos de farmacia | hasta 4 propuestas que **configura el comercio**, con 12 iconos genéricos; sin configurar, las 3 que la plataforma puede afirmar de cualquier tienda |
| Iconos de categoría | 14 entradas, 10 de farmacia | 27 entradas: calzado, moda, hogar, alimentación, ferretería, tecnología, deporte, juguetes, mascotas, papelería, automoción, belleza **y** salud |
| Marcas | solo nombre | **logotipo real** con recorte por sociedad en Storage, y monograma cuando no hay |
| Categorías | solo nombre e icono | **fotografía opcional**, con tinte de orientación como respaldo |
| `heroVariant` / `categoryVariant` | declarados y sin efecto | **dos composiciones reales** cada uno |
| Filas con 1–3 productos | media pantalla en blanco | la fila se adapta y añade una puerta al catálogo |
| Tarjeta de producto | una presentación | **cuatro presentaciones** reales por tema |
| Catálogo con pocos resultados | rejilla a medias | «También puedes explorar»: familias y marcas, **sin colar productos** en el recuento |
| «Lo más vendido» | orden por relevancia | **ranking real** de pedidos de 90 días; sin ventas, la sección se llama «Recomendados» |
| `business-info` | encendible y vacía | quién es el comercio y cómo se le encuentra; se **calla** si no hay contacto |
| Diseño de tienda | formulario + preview al final | **taller**: configuración a la izquierda, tienda fija a la derecha |
| Vista previa responsive | una caja estrujada | **simulación real** por marco, con Enfoque y Comparar |
| Selector de temas | cuatro frases | **miniaturas dibujadas con la definición del preset** |
| Editor de portada | 13 filas altas, pendientes mezcladas | filas compactas, **arrastrar** (sin perder las flechas) y grupo «Próximamente» |
| Vista previa | cinco tonos de gris | contenido de ejemplo **rotulado**, con las variantes visibles |
| Calidad de la tienda | ningún sitio | **«Cómo se ve tu tienda»**: 7 señales con cuentas reales, sin nota y sin bloquear |

### La regla que atraviesa todo

**La plataforma no sabe a qué se dedica el comercio, y lo que no sabe no lo inventa.** No hay una
sola condición por rubro, por cliente ni por catálogo. Lo que el comercio no escribió, no aparece
—sin hueco, sin marcador de posición y sin un guion donde iría el teléfono—, y lo que la plataforma
afirma de oficio es solo lo que hace el código: que hay envío, que el pago va cifrado y que se
puede escribir si hay a dónde.

`src/features/storefront/multi-industry.test.ts` convierte esa regla en una prueba: recorre los dos
diccionarios completos y falla si un texto de vitrina nombra un rubro.

---

## 2 · Síntesis técnica

### Migraciones nuevas (4)

| Migración | Qué añade |
|---|---|
| `20260923140000_storefront_value_props.sql` | `store_settings.value_props` con validación en la base (máximo 4, sin iconos repetidos, textos acotados), grants por columna y `public_stores` recreada |
| `20260923150000_brand_logos.sql` | ruta de Storage por **sociedad** (`{org}/company/{company}/brands/…`), 5 policies nuevas, `public.public_brands` |
| `20260923160000_category_media.sql` | `categories.image_url`/`image_alt` con validación de ruta, grants a `anon` y `public_categories` **conservando el filtro recursivo de ancestros** |
| `20260923170000_store_best_sellers.sql` | `store_best_sellers_for_slug`: agrega pedidos pagados o entregados de 90 días y devuelve **solo** ids y puestos |

Ninguna modifica una migración previa. Todas nacen con su RLS, sus grants por columna y su
comentario. Las cuatro se aplican y se prueban contra Postgres real (PGlite) en la suite de base.

### Seguridad

- La superficie anónima sigue siendo una **lista cerrada**: la única función nueva se registra con
  su clase y su justificación, y `docs/SECURITY_BASELINE.md` §1.6 se actualiza con ella.
- `anon` sigue **sin GRANT** sobre `orders` ni `order_items`; el ranking devuelve ids y puestos, no
  unidades ni importes. Hay una prueba que lo comprueba leyendo las dos tablas con la clave anónima.
- Las dos funciones `security definer` nuevas llevan su autorización **escrita en el cuerpo** y
  `search_path` vacío.
- Todas las URL de imagen (logotipos de marca, fotos de categoría) pasan por `assetRef`, el mismo
  filtro que ya protegía el logotipo de la tienda: `https://` o ruta del bucket, y nada más.
- `npm run scan:secrets`: sin hallazgos.

### Rendimiento

El rediseño llegó a dejar la portada en **417,0 kB** gzip, por encima de su techo de 405. Se cerró
difiriendo lo que de verdad no hace falta en el primer pintado:

| Diferido | kB | Por qué no hace falta al pintar |
|---|---|---|
| Panel de sugerencias del buscador | ~8,6 | solo aparece con dos caracteres escritos, y para entonces hay un rebote de 250 ms y una consulta en vuelo |
| Bloques del CMS | ~8,6 | el módulo de contenido es un addon; una tienda sin él recibe cero bloques |
| Cajón del asistente | ~3 | estaba montado siempre, cerrado; se abre pulsando un botón flotante |
| Puertas de categoría | ~4,1 | la sección viene apagada en los cuatro temas |
| «También puedes explorar» | ~1 | solo con cero o pocos resultados |
| `Tooltip` de la tarjeta | ~2,7 | decía lo mismo que el `aria-label` que el botón ya lleva; el `title` nativo hace lo mismo sin Popper |

**Resultado: 398,8 kB** — por debajo incluso de los 399,5 que medía *antes* de empezar el rediseño.
Ni el carrito ni la caja de búsqueda se difirieron: son la acción central de una tienda y su
landmark de accesibilidad, y ahorrar tres kilobytes ahí se paga en la venta.

### Lo que NO se tocó

- El contrato del Theme Engine: siguen siendo las mismas 7 claves cerradas, los mismos 4 presets y
  los mismos 13 identificadores de sección.
- Identidad, claims, jerarquía y Platform Context API: nada de lo que el contrato de plataforma
  declara *breaking*.
- Ninguna migración previa, ninguna base remota, ningún entorno QAS ni PRD.
- Los cambios ajenos del árbol de trabajo (11 borrados sin preparar bajo `claude-overnight/logs/` y
  el propio pack sin seguimiento) siguen exactamente como estaban: cada commit nombra sus rutas.

---

## 3 · Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 300 ficheros, 5925 tests |
| `npm run build` | **PASS** |
| `npm run scan:secrets` | **PASS** — sin hallazgos |
| `npm run bundle:report` | **PASS** — los cuatro recorridos dentro del techo |
| `npm run test:db` | **PASS** — 136 ficheros, 3595 tests contra Postgres real (PGlite) |
| Playwright (`e2e/`) | **NO EJECUTADO** — ver limitaciones |

---

## 4 · Limitaciones y pendientes reales

1. **Playwright no se pudo ejecutar.** La configuración levanta el servidor de desarrollo con el
   `.env` del repositorio y recorre el tenant de demo por red; en esta máquina no hay `.env` ni
   navegadores de Playwright instalados. `e2e/theme-engine.e2e.ts` quedó ampliado en P04 y **no se
   ha ejecutado**: no se da por verde.
2. **Los ficheros del contrato EBIM no son legibles en esta máquina.** La ruta de
   `.shortcut-targets-by-id` está vacía y no existe el acceso directo. Se trabajó contra la
   transcripción verificada de `docs/EBIM_GUIDELINES_TRACE.md` (contrato v1.15). **No se pudo
   revisar `coordinacion\BANDEJA.md` ni `coordinacion\pendientes\`**: queda pendiente para el
   operador.
3. **Las cuatro migraciones no se han aplicado a ninguna base remota.** Están probadas contra
   Postgres real en local; aplicarlas a QAS o PRD es una decisión del operador.
4. **Defecto latente ajeno, documentado y no corregido:** `ai-credit-payments-fulfillment-facts`
   usa `current_date` donde su función hermana usa la fecha UTC. Se corrigió únicamente la semilla
   del test que fallaba por reloj (P03) y se dejó constancia de la inconsistencia de producto.
5. **`newsletter` sigue sin implementar**, y a propósito: no hay dónde guardar una suscripción ni su
   consentimiento, y un formulario que pide un correo y lo tira es peor que no ofrecerlo.

---

**PUSH: NO** · **DEPLOY: NO**
