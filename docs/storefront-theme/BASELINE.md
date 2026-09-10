# Storefront Theme Engine — BASELINE (P00)

**Fecha:** 2026-09-10
**Rama:** `dev` · **Commit:** `a380e09`
**Alcance de esta fase:** auditoría y documentación. No se tocó código productivo, migraciones ni lógica de negocio.

---

## 1. Veredicto

**BASELINE = PASS**

Las seis puertas pasan, incluida `npm ci` sobre un árbol reinstalado desde `package-lock.json`. No hay fallos de test preexistentes.

El primer intento de `npm ci` sí falló, y con consecuencias que conviene leer antes de repetirlo en otra fase: está en §2.1. Y hay una inestabilidad por tiempo de espera bajo carga, documentada en §2.2, que no es un fallo pero puede parecerlo.

---

## 2. Puertas de calidad ejecutadas

| Comando | Resultado | Conteo real |
|---|---|---|
| `npm ci` | **PASS** (al segundo intento) | ver §2.1 |
| `npm run typecheck` | PASS | sin errores |
| `npm run lint` | PASS | sin avisos |
| `npm run test` | PASS | **164 archivos · 3102 tests** |
| `npm run build` | PASS | build en 13,19 s |
| `npm run test:db` | PASS | **72 archivos · 1911 tests** |

`test:db` es un subconjunto de `test` (`vitest run supabase/tests`), así que los 1911 están contenidos en los 3102.

### 2.1 · El fallo de `npm ci`, y lo que provocó

`npm ci` borra `node_modules` antes de reinstalar. Falló a mitad con `EPERM` sobre `esbuild.exe` porque había un proceso de desarrollo activo sosteniéndolo — se comprobó: un `esbuild` y varios `node` en marcha desde antes de esta sesión.

**Consecuencia:** el árbol quedó a medio borrar y `tsc`, `eslint` y `vite` desaparecieron. Se reparó con `npm install`, que terminó con éxito, y a partir de ahí las cinco puertas se ejecutaron con normalidad.

**Segundo intento: PASS.** Con el binario ya libre —se comprobó abriéndolo en exclusiva antes de arrancar, para no repetir el destrozo— `npm ci` terminó con éxito y `typecheck` y `lint` siguieron en verde sobre el árbol reinstalado desde `package-lock.json`. **La reproducibilidad del árbol de dependencias queda cerrada.**

`npm ci` reporta **4 vulnerabilidades de severidad media**, preexistentes y ajenas a este trabajo.

**La lección, que vale para las fases siguientes:** `npm ci` borra `node_modules` antes de reinstalar, así que con un servidor de desarrollo o un `vitest --watch` en marcha deja el árbol inservible a mitad. Conviene comprobar el bloqueo antes, o simplemente no ejecutarlo con la aplicación levantada.

### 2.2 · Fallos preexistentes

No hay fallos de test preexistentes. Sí hay **inestabilidad por carga**: en corridas anteriores de esta misma jornada, `src/features/content/content-ui.test.tsx` y algún archivo de `planning` agotaron su tiempo dentro de la suite completa (72 s) y pasaron al ejecutarlos solos (23 s). No es un defecto de código; es un tiempo de espera ajustado bajo paralelismo. **Conviene tenerlo presente para no atribuirle a una fase del Theme Engine un fallo que ya oscilaba.**

---

## 3. Estado del repositorio

- **Última migración:** `20260910210000_ai_features.sql`
- **Total de migraciones:** 138
- **`git status`** antes de esta fase:

```
?? .mcp.json
?? docs/storefront-theme/
```

`.mcp.json` es configuración local previa a esta fase y no pertenece a este trabajo.

> **Regla para P02:** la migración del Theme Engine debe numerarse **estrictamente después** de `20260910210000`. Ya hubo una colisión de versión en esta jornada —dos archivos con `20260910200000`— y el resultado fue que una migración no llegó a registrarse. Conviene comprobar la lista antes de elegir el número.

---

## 4. Flujo actual del storefront

```
URL /s/:storeSlug
  → StorefrontLayout
      → usePublicStore(slug) → vista pública `public_stores` (cliente anónimo)
      → AppearanceProvider  (modo, acento del tenant, tipografía, radio, densidad)
          → <div class="sf-scope">   ← frontera visual de la vitrina
              → cabecera + StoreCategoryNav + buscador + carrito
              → <Outlet/> → StoreHomePage | StoreProductPage | catálogo | carrito | checkout | cuenta
              → StorePagesFooter + CartDrawer + asistente flotante
```

- El tenant se resuelve **por slug contra el modelo público**, nunca por un parámetro de confianza del cliente.
- `AppearanceProvider` se monta dos veces en el archivo: una para la tienda resuelta y otra para los estados de error/404, de modo que una tienda inexistente también se pinta con la piel de suite.

---

## 5. Propiedad actual de lo visual

| Concepto | Dueño hoy |
|---|---|
| Modo claro/oscuro, acento, tipografía, radio, densidad | `AppearanceProvider` (`src/theme/`) |
| Tokens de piel de la vitrina (`--sf-radius`, `--sf-shadow`, `--sf-line`, tintes…) | `src/features/storefront/storefront.css`, bajo `.sf-scope` |
| Atributos de datos existentes en la raíz | `data-theme`, `data-density` |
| Variantes de presentación por preset | **no existe** — es lo que P01–P04 introducen |

`.sf-scope` ya es la frontera que el diseño pide reutilizar: el backoffice no lee esas variables. **No hay ningún `data-store-theme` todavía.**

---

## 6. Campos públicos de `PublicStore`

Validados con Zod en `src/features/storefront/types.ts` (`publicStoreSchema`):

`store_id`, `slug`, `name`, `currency`, `accent_color`, `logo_url`, `white_label`, `default_locale`, `support_email`, `banner_url`, `hero_title`, `hero_subtitle`, `contact_phone`, `contact_address`, `favicon_url`, `font_family`, `ui_radius`, `ui_density`, `business_display_name`, `checkout_requires_account`.

La vista `public_stores` expone además `domain`, que el esquema del cliente no lee.

**Patrón a imitar en P03:** los campos añadidos después del despliegue inicial usan `.nullable().catch(null).default(null)`, nunca `.optional()`. Así una respuesta anterior al despliegue se lee como la tienda que era, y un valor fuera de la lista cerrada cae al valor seguro en vez de llegar a un `font-family` que el navegador interprete. **El Theme Engine debe hacer exactamente lo mismo con `theme_preset`, `storefront_style` y `home_layout`.**

---

## 7. `store_settings` — branding

Columnas relevantes de las 31 de la tabla:

`accent_color`, `logo_url`, `favicon_url`, `banner_url`, `hero_title`, `hero_subtitle`, `font_family`, `ui_radius`, `ui_density`, `business_display_name`, `white_label`, `default_locale`, `support_email`, `contact_phone`, `contact_address`.

Existe ya una columna `config jsonb`. **P02 debe decidir explícitamente** si las claves nuevas van en columnas propias —como recomienda el diseño— o dentro de `config`; mezclarlas sin decidirlo dejaría el mismo dato en dos sitios.

---

## 8. Orden actual de la Home

De `StoreHomePage.tsx`, en orden de render. La portada y el catálogo son dos modos de la misma pantalla: `?ver=todo` (o cualquier filtro) cambia de uno a otro.

| # | Sección | Componente | Condición |
|---|---|---|---|
| 0 | Esqueleto de carga | `StoreLandingSkeleton` | mientras cargan portada, ofertas y CMS |
| 1 | Portada | `StoreFeaturedHero` | si hay productos rebajados |
| 1b | Portada de reserva | `StoreHero` | si no hay rebajas y el CMS no trae portada |
| 2 | Franja de servicios | `StoreServicesStrip` | solo portada |
| 3 | Ofertas + destacados | `OffersFeaturedBand` | solo portada |
| 4 | Bloques del CMS | `ContentBlocks` | solo portada |
| 5 | Ofertas vigentes | `PromoCarousel` | si hay promociones vivas |
| 6 | Píldoras de categoría | `CategoryBar` | **solo catálogo** |
| 7 | Compra por marca | `BrandRow` | solo portada |
| 8 | Novedades | `ProductRow` | solo portada |
| 9 | Lo más vendido | `ProductRow` | solo portada, y solo si el CMS no trae ya productos |
| 10 | Rejilla del catálogo | `ProductGrid` + `StoreFilterPanel` | **solo catálogo** |
| 11 | Marcas de confianza | `BrandTrustStrip` | solo portada |
| 12 | Volver arriba | `BackToTop` | siempre |
| 13 | Vista rápida | `ProductQuickView` | según `?p=` |

**El pie (`StorePagesFooter`) y el asistente flotante viven en `StorefrontLayout`, no en la Home.**

Comparado con los IDs de sección que propone el diseño, hoy **no existen** `newsletter` ni `business-info` como secciones de la Home, y `trust` está resuelto por `BrandTrustStrip`. P06 tendrá que decidir si los crea o los declara pendientes.

---

## 9. Tipos de bloque del CMS

Enumeración `public.content_block_type`: `hero`, `banner`, `carousel`, `product_collection`, `category_collection`, `rich_text`, `campaign`, **`slider`** (añadido después, en `20260901160000`).

`ContentBlocks.tsx` los pinta todos, agrupa campañas contiguas en un mural y tiñe secciones alternas con el acento del tenant.

---

## 10. Archivos grandes o de riesgo

| Archivo | Líneas | Por qué es riesgoso |
|---|---|---|
| `components/ContentBlocks.tsx` | 1345 | Un componente por tipo de bloque, todos en un archivo. Es el que más probable es que se toque en P06–P08 y el que peor tolera un conflicto con otra rama. |
| `SettingsPage.tsx` (admin) | 885 | Pestañas con formularios largos. P14 y P15 añaden dos secciones más. |
| `StoreHomePage.tsx` | 810 | Concentra composición, tres consultas de catálogo, reparto sin repetidos entre secciones, modo portada/catálogo, filtros y orden. **Es el objetivo directo de P06.** |
| `StorefrontLayout.tsx` | 755 | Cabecera, navegación, buscador, carrito, pie, asistente y los estados de error. **Objetivo de P05.** |
| `components/ProductCard.tsx` | 413 | Una sola variante hoy; P07 introduce las demás. |
| `createEbimTheme.ts` | 252 | Tema de suite compartido con el backoffice. Tocarlo cambia las dos áreas. |
| `storefront.css` | 156 | Tokens de `.sf-scope`. Punto de extensión natural para los presets. |

**Nota de coordinación:** durante esta jornada hubo otra sesión trabajando en el mismo repositorio (`planning`, `sales`, `trade`, `EntityPicker`, la migración `my_stores`). Conviene confirmar que no haya trabajo en vuelo sobre `StoreHomePage`, `StorefrontLayout` o `SettingsPage` antes de empezar P05/P06/P14.

---

## 11. Tests que protegen el área

**Vitrina y contenido (`src/features/storefront/`):** `storefront-ui`, `storefront-content`, `storefront-a11y-seo`, `landing`, `category-nav`, `promos-ui`, `checkout-ui`, `cart`, `cart-quote`, `b2b-price`, `favorites`, `favorites-shared`, `seo`, `analytics`, `assistant`, `categoryTree`, `signed-url-cache`, `storefront`.

**Componentes:** `ProductCard`, `ProductMedia`, `SliderBlock`, `StoreFilterPanel`, `LoopingRow`.

**Base de datos (`supabase/tests/`):** `storefront-public`, `storefront-seo`, `cms-content`, `catalog-search`, `catalog-admin`, `pim-catalog`, `carts`, `guest-cart-retention`, `checkout-order`, `checkout-pipeline`, `checkout-orchestrator`, `checkout-rate-limit`, `pricing-checkout`, `promotions-checkout`, `rls-tenant-isolation`, `schema-invariants`, `capability-enforcement`.

**Tres guardianes transversales que cualquier fase puede romper sin darse cuenta:**

- `schema-invariants` — RLS activa y forzada, `organization_id`/`company_id` en toda tabla de negocio, sin importes en coma flotante, sin `search_path` mutable.
- `capability-enforcement` — qué capacidades tienen candado en servidor y cuáles solo en la interfaz. **Su detector lee literales en las migraciones**; un gate dinámico lo ciega, como ya pasó con la IA en esta jornada.
- `rls-tenant-isolation` — un tenant no ve ni escribe lo del otro.

---

## NO-REGRESSION CONTRACT

Lo que sigue **no puede cambiar de comportamiento** en ninguna fase del Theme Engine. Si una fase parece necesitarlo, se detiene y se consulta; el trabajo visual no es autorización para tocar negocio.

### Resolución y acceso
1. La vitrina resuelve la tienda **por slug contra `public_stores`** con el cliente anónimo.
2. El comprador anónimo lee solo lo publicado. RLS y grants intactos.
3. `checkout_requires_account` sigue decidiéndose en el servidor (`validate_account`), no en la pantalla.
4. Aislamiento entre tenants.

### Dinero y catálogo
5. Precios, listas de precios y precio B2B por segmento.
6. Descuentos, promociones y el motor que las aplica.
7. Impuestos y la cascada de categoría fiscal.
8. Inventario, disponibilidad y variantes.
9. La búsqueda del catálogo pasa por la función de búsqueda, **nunca leyendo `public_products` desde el navegador** (hay un test que lo vigila).

### Compra
10. Propiedad y persistencia del carrito.
11. Semántica de la vista rápida.
12. Checkout, métodos de entrega y de pago.
13. Creación y estados de pedido.

### Plataforma
14. Capacidades y entitlements, incluida la lectura del hub.
15. Rutas y contratos de URL, incluidos `?ver=todo`, `?c=`, `?b=`, `?oferta=1`, `?p=`, `?q=`, `?sort=`.
16. SEO, `noindex` y metadatos.
17. Accesibilidad ya cubierta por tests: nombres accesibles, foco, teclado, `prefers-reduced-motion`.
18. Eventos de analítica.
19. Comportamiento de degradación del CMS cuando la sociedad no tiene `content.cms`.

### Compatibilidad hacia atrás
20. Una tienda sin configuración nueva **debe renderizar la experiencia actual** a través de los valores por defecto de `universal`.
21. Una respuesta pública sin los campos nuevos —despliegue escalonado— no puede dejar la vitrina en blanco.
22. El backoffice no cambia de aspecto al introducir los temas de la vitrina.

### Reglas de proceso
23. No se editan migraciones ya aplicadas.
24. Nada de CSS, HTML o JavaScript arbitrario del tenant.
25. Sin `service_role` en el navegador; la vista previa usa los datos que el administrador ya puede leer.
26. Sin ramas de negocio por rubro: nada de `if farmacia`.
27. Cada fase cierra con `typecheck`, `lint`, `test` y `build`; las de base de datos añaden `test:db` y regenerar tipos.

---

## Qué queda abierto para P01

1. ~~`npm ci` sin ejecutar limpiamente.~~ **Cerrado**: repetido con éxito, árbol reinstalado desde el lock.
2. **Decidir columnas nuevas contra `config jsonb`** en `store_settings` (P02).
3. **`newsletter` y `business-info` no existen** como secciones. P06 decide si se crean o se declaran pendientes.
4. **Coordinar con la otra sesión** antes de tocar `StoreHomePage`, `StorefrontLayout` o `SettingsPage`.
5. **Numerar la migración por encima de `20260910210000`**, comprobando que nadie haya tomado el número.
