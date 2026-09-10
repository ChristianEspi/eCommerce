# Claude VS Code Prompt Pack — EBIM eCommerce Storefront Theme Engine

Fecha base del repositorio revisado: 2026-09-10.

## Cómo usar este pack

Ejecuta los prompts **en orden, uno por uno, en la misma rama de trabajo**. No envíes P01 hasta revisar el reporte de P00. No ejecutes dos fases en paralelo porque varias modifican los mismos contratos de storefront/settings.

Claude debe trabajar sobre el repositorio real abierto en VS Code, no sobre una copia mental del proyecto. Cada fase debe terminar con un reporte verificable y no debe desplegar ni hacer push por su cuenta.

---

## P00 — Baseline, mapa real y guardarraíles

```text
Trabaja sobre el repositorio eCommerce by EBIM que tengo abierto en VS Code.

OBJETIVO DE ESTA FASE
Antes de tocar código, establece una línea base verificable y un mapa real de la arquitectura actual del storefront. Esta fase es SOLO auditoría/documentación: no cambies código productivo, migraciones aplicadas ni lógica de negocio.

CONTEXTO APROBADO
Vamos a evolucionar el storefront actual hacia un Theme Engine SaaS multirrubro con cuatro presets: universal, retail, premium y catalog. No se crearán cuatro aplicaciones ni cuatro StoreHomePage. El mismo código deberá servir para ropa, calzado, farmacia, droguería, abarrotes, tecnología, hogar, ferretería, distribuidores y otros rubros mediante configuración.

REGLAS INNEGOCIABLES
1. Lee primero CLAUDE.md, docs/STATE.md, docs/architecture.md, docs/VISUAL_QA_REPORT.md y package.json.
2. Inspecciona especialmente:
   - src/theme/
   - src/features/storefront/StoreHomePage.tsx
   - src/features/storefront/StorefrontLayout.tsx
   - src/features/storefront/components/ContentBlocks.tsx
   - src/features/storefront/components/ProductCard.tsx
   - src/features/storefront/components/ProductGrid.tsx
   - src/features/admin/SettingsPage.tsx
   - src/features/admin/settings/
   - src/features/content/
   - src/features/storefront/types.ts
   - src/features/storefront/api.ts
   - supabase/migrations/
   - supabase/tests/
3. NO modifiques pricing, descuentos, promociones, impuestos, stock, variantes, favoritos, búsqueda, carrito, checkout, pagos, órdenes, B2B pricing, RLS, sesión, resolución del tenant, rutas, SEO ni capabilities.
4. NO edites migraciones ya aplicadas.
5. No inventes resultados de tests.

TAREAS
A. Ejecuta npm ci.
B. Ejecuta y registra exactamente:
   npm run typecheck
   npm run lint
   npm run test
   npm run build
   npm run test:db
C. Si una suite falla antes de nuestros cambios, identifica si es un fallo preexistente y documenta el error exacto. No arregles todavía nada que no pertenezca al Theme Engine.
D. Registra git status y el nombre de la migración más reciente.
E. Documenta el flujo actual:
   URL /s/:storeSlug -> resolución public_stores -> AppearanceProvider -> StorefrontLayout -> StoreHomePage.
F. Documenta:
   - campos públicos actuales de PublicStore;
   - store_settings relevantes al branding;
   - orden actual de la Home;
   - tipos de bloque CMS soportados;
   - componentes actuales reutilizables;
   - tests que protegen storefront, CMS, settings, SEO, accesibilidad, carrito y checkout.
G. Crea docs/storefront-theme/BASELINE.md con esta información y un apartado NO-REGRESSION CONTRACT.

NO IMPLEMENTES EL THEME ENGINE EN P00.

SALIDA OBLIGATORIA
Devuélveme al terminar:
1. BASELINE = PASS / PASS_WITH_PREEXISTING_FAILURES / FAIL.
2. Tabla con comando, resultado y conteo real de tests cuando aplique.
3. Última migración detectada.
4. Archivos grandes/riesgosos y por qué.
5. Orden exacto actual de las secciones de StoreHomePage.
6. Lista de lógica que queda prohibido alterar en las siguientes fases.
7. git diff --stat, que en esta fase solo debería incluir documentación.
No hagas push ni deploy.
```

---

## P01 — Contratos TypeScript del Theme Engine

```text
Continuamos el Theme Engine del eCommerce SaaS EBIM. Lee primero docs/storefront-theme/BASELINE.md y revisa el estado actual del repo antes de modificar nada.

OBJETIVO
Crear los contratos TypeScript, presets y normalizadores seguros que serán la única fuente de verdad del Theme Engine. Aún NO conectes Supabase, NO cambies la Home y NO cambies estilos visibles salvo lo imprescindible para tests aislados.

ARQUITECTURA APROBADA
- AppearanceProvider sigue siendo dueño de light/dark, accent_color, font_family, ui_radius y ui_density.
- El nuevo Theme Engine será exclusivo del storefront.
- Presets cerrados: universal | retail | premium | catalog.
- No existen themes por rubro: nada de pharmacy/fashion/grocery en lógica.
- Branding, theme, layout y CMS son conceptos separados.
- Universal debe ser el fallback absoluto.

CREA
src/features/storefront/theme/types.ts
src/features/storefront/theme/presets.ts
src/features/storefront/theme/normalize.ts
src/features/storefront/theme/theme.test.ts

CONTRATOS MÍNIMOS
Define tipos cerrados equivalentes a:
ThemePreset = 'universal' | 'retail' | 'premium' | 'catalog'

HomeSectionId con:
hero
services
categories
offers
cms
promotions
best-sellers
new-arrivals
featured
brands
trust
business-info
newsletter

HomeSectionConfig:
- id
- enabled
- maxItems opcional y acotado solo donde tenga sentido

HomeLayout:
- version: 1
- sections: HomeSectionConfig[]

StorefrontStyle con una whitelist pequeña de overrides PRESENTACIONALES, por ejemplo:
- headerVariant
- heroVariant
- productCardVariant
- categoryVariant
- contentWidth
- imageRatio
- sectionSpacing
No agregues campos por especulación. Si alguno no se justifica con componentes reales, omítelo y explica por qué.

ThemeDefinition debe resolver como datos y no con JSX duplicado al menos:
- headerVariant
- heroVariant
- productCardVariant
- categoryVariant
- contentWidth
- imageRatio
- sectionSpacing
- grid columns/density

Crea:
DEFAULT_THEME_PRESET
DEFAULT_HOME_LAYOUT
THEME_PRESETS
normalizeThemePreset(value)
normalizeStorefrontStyle(value, preset)
normalizeHomeLayout(value)

REQUISITOS DE SEGURIDAD
- Nada de CSS libre.
- Nada de HTML.
- Nada de JavaScript.
- Nada de URLs en storefront_style/home_layout.
- Ignora claves desconocidas.
- Un preset desconocido cae a universal.
- JSON malformado cae a defaults seguros.
- IDs de sección desconocidos se ignoran.
- IDs duplicados no pueden generar dos secciones iguales.
- maxItems debe tener límites razonables y constantes tipadas.

TDD OBLIGATORIO
Escribe primero tests que fallen para cada uno de esos casos. Luego implementa lo mínimo.

IMPORTANTE
No crees StoreHomeUniversal/StoreHomeRetail/etc.
No metas if(theme === ...) en componentes de negocio.
No toques pricing, stock, checkout ni consultas.

GATES
Ejecuta como mínimo:
npx vitest run src/features/storefront/theme/theme.test.ts
npm run typecheck
npm run lint
npm run test
npm run build

SALIDA
1. P01 PASS/FAIL.
2. Archivos creados/modificados.
3. Contratos finales exactos.
4. Qué diferencias define cada preset como datos.
5. Tests ejecutados y resultados reales.
6. git diff --stat.
No push, no deploy.
```

---

## P02 — Persistencia Supabase segura y backward-compatible

```text
Implementa P02 del Theme Engine sobre el repo actual. Revisa P00/P01 y la migración más reciente REAL antes de crear nada.

OBJETIVO
Persistir la configuración del storefront en store_settings de forma segura, RLS-compatible y backward-compatible, y exponer SOLO los campos presentacionales necesarios mediante public_stores.

MODELO APROBADO
Agregar a public.store_settings:
1. theme_preset text NOT NULL DEFAULT 'universal'
2. storefront_style jsonb NOT NULL DEFAULT '{}'::jsonb
3. home_layout jsonb NOT NULL con layout V1 seguro por defecto

REGLAS
- Crea una NUEVA migración con timestamp estrictamente posterior a la última del repo.
- JAMÁS edites migraciones aplicadas.
- theme_preset tiene CHECK cerrado: universal/retail/premium/catalog.
- storefront_style y home_layout deben validarse también en DB. Crea helpers ebim.* si son necesarios, pero mantenlos pequeños y deterministas.
- storefront_style solo admite las claves/valores definidos en P01.
- home_layout solo admite version=1, section IDs conocidos, enabled boolean y maxItems acotado cuando aparezca.
- Rechaza CSS/HTML/JS/URLs/keys arbitrarias por diseño de esquema, no por heurística de strings.
- Estos tres campos NO son premium de white_label.
- Mantén las policies actuales de owner/admin y tenant isolation.
- Extiende GRANT UPDATE autenticado únicamente con las columnas presentacionales nuevas.
- Extiende lectura anon solo porque public_stores necesita esos campos.
- public_stores debe continuar security_invoker=on y filtrar tiendas activas.
- No expongas organization_id, company_id, tax_rate, config, estados internos ni secretos.

TDD DB PRIMERO
Crea supabase/tests/storefront-theme.test.ts y cubre:
A. defaults de tienda existente/nueva;
B. los cuatro presets válidos;
C. preset inválido rechazado;
D. storefront_style válido;
E. claves/valores inválidos rechazados;
F. home_layout válido;
G. section id inválido/estructura inválida rechazada;
H. usuario de otro tenant no puede modificar;
I. miembro sin rol administrativo no puede modificar;
J. anon puede leer los tres campos vía public_stores pero no obtiene columnas internas;
K. theme no depende de content.white_label.

Después implementa la migración hasta que los tests pasen.

TIPOS
Ejecuta npm run db:types y verifica el diff generado. No edites database.types.ts a mano.

GATES
npm run test:db
npm run db:types
npm run typecheck
npm run lint
npm run test
npm run build

SALIDA
1. Nombre exacto de la migración nueva.
2. Resumen de columnas/checks/helpers/grants/views.
3. Evidencia de RLS/anon.
4. Conteos reales de tests.
5. git diff --stat.
6. P02 PASS/FAIL.
No push, no deploy.
```

---

## P03 — Conectar PublicStore + Settings al nuevo contrato

```text
Implementa P03. La DB y los contratos del Theme Engine ya deben existir. No avances si P01/P02 no están presentes en el árbol; en ese caso reporta el bloqueo sin inventar código alternativo.

OBJETIVO
Hacer que storefront y backoffice lean/escriban theme_preset, storefront_style y home_layout con parsing robusto y rolling-deploy safety.

ARCHIVOS A REVISAR/MODIFICAR
src/features/storefront/types.ts
src/features/storefront/api.ts
src/features/admin/settings/types.ts
src/features/admin/settings/api.ts
src/features/admin/settings/useStoreSettings.ts si realmente lo requiere
src/features/storefront/theme/*
tests correspondientes

REQUISITOS
1. Extiende publicStoreSchema y PublicStore.
2. Extiende STORE_SELECT en storefront/api.ts.
3. Un response antiguo o inesperado NO puede dejar la tienda en blanco: theme_preset faltante/inválido => universal; JSON inesperado => defaults.
4. Mantén separadas dos capas:
   - raw data que viene de DB;
   - normalized/resolved theme presentation.
5. Extiende storeSettingsSchema, StoreSettings, storeFormSchema, StoreFormValues y toForm.
6. Extiende SETTINGS_SELECT y saveStoreSettings.
7. theme/layout/style se guardan SIEMPRE para owner/admin y NO dependen de canWhiteLabel.
8. No cambies el gating existente de font/email/domain/white_label.
9. No cambies store identity, contact, checkout_requires_account ni require_payment_before_dispatch.
10. No modifiques RLS desde frontend.

TESTS PRIMERO
- Public store antiguo/sin campos nuevos parsea y obtiene fallback.
- Public store con cada preset conserva su valor.
- JSON inválido no rompe render/normalización.
- Settings toForm produce defaults seguros.
- saveStoreSettings incluye los tres campos nuevos.
- canWhiteLabel=false NO impide guardar theme/layout/style.
- canWhiteLabel=false sigue sin poder escribir campos premium existentes.

GATES
Ejecuta tests focalizados de storefront/settings, luego:
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:db

SALIDA
P03 PASS/FAIL + archivos + contratos raw vs resolved + tests reales + diff stat.
No push, no deploy.
```

---

## P04 — StorefrontThemeProvider y frontera visual

```text
Implementa P04 del Theme Engine.

OBJETIVO
Crear un StorefrontThemeProvider que se monte SOLO en la vitrina pública y convierta los valores raw de PublicStore en una configuración de presentación segura y lista para consumir por componentes.

CREA
src/features/storefront/theme/theme-context.ts
src/features/storefront/theme/StorefrontThemeProvider.tsx
src/features/storefront/theme/useStorefrontTheme.ts

MODIFICA
src/features/storefront/StorefrontLayout.tsx
src/features/storefront/theme/theme.test.ts

REGLA DE ARQUITECTURA
AppearanceProvider sigue resolviendo color/font/radius/density y NO debe ser reemplazado.
StorefrontThemeProvider se monta en la rama donde la tienda ya fue resuelta, junto a la frontera `.sf-scope`.

EL CONTEXTO DEBE EXPONER
- preset resuelto
- ThemeDefinition resuelto
- StorefrontStyle normalizado
- HomeLayout normalizado
No expongas el JSON raw a todos los componentes.

DOM/CSS
Añade a la frontera de storefront atributos estables del tipo:
data-store-theme="universal|retail|premium|catalog"
y, solo si ayuda a CSS, atributos de variantes resueltas. No uses data attributes con contenido libre del tenant.

TESTS
- default universal;
- retail/premium/catalog;
- override válido;
- override inválido ignorado;
- no cambia AppearanceProvider;
- backoffice no recibe data-store-theme;
- un PublicStore viejo sigue montando storefront.

PROHIBIDO
- Cambiar CartProvider, sesión, StorefrontOutlet, storeSlug resolution o navegación.
- Condicionar cart/checkout por theme.
- Duplicar árboles completos por theme.

GATES
focused tests + npm run typecheck + npm run lint + npm run test + npm run build.

REPORTA P04 PASS/FAIL, archivos, shape del contexto, tests y diff stat.
```

---

## P05 — Refactor seguro del StorefrontLayout

```text
Implementa P05.

OBJETIVO
Hacer el shell/header/footer/container del storefront theme-aware sin duplicar StorefrontLayout ni modificar flujos públicos existentes.

ANTES DE TOCAR
Lee StorefrontLayout.tsx completo y sus tests. Identifica responsabilidades y extrae subcomponentes SOLO si reduce claramente el tamaño/riesgo del archivo. No hagas refactors cosméticos fuera del alcance.

DEBE CONSERVARSE
- resolución por slug/public_stores;
- loading/not found/error;
- noindex soft-404;
- AppearanceProvider;
- CartProvider y propiedad del carrito;
- StoreQuickSearch;
- StoreCategoryNav;
- account/cart actions;
- SkipToContentLink y focus target;
- AssistantDrawer/Fab;
- páginas públicas/legal;
- mobile behavior.

THEME-AWARE
Usa useStorefrontTheme() y/o variables CSS resueltas para:
- ancho de contenido;
- altura/densidad del header;
- espaciado principal;
- tratamiento de navegación;
- superficie/borde/sombra del header;
- comportamiento visual del footer si ya existe.

NO quiero if(theme === 'retail') repetidos por JSX. Las diferencias deben venir principalmente de ThemeDefinition + CSS vars/data attributes.

TESTS PRIMERO
Añade casos parametrizados para los cuatro presets y prueba que siguen presentes/alcanzables:
- logo/nombre;
- búsqueda;
- cuenta;
- carrito;
- categorías;
- skip link;
- páginas públicas/legal.
También verifica que el backoffice no cambió.

CSS
Mantén todo bajo `.sf-scope`. Nada global que afecte admin.

GATES
storefront UI/a11y tests + full typecheck/lint/test/build.

SALIDA: P05 PASS/FAIL, qué se extrajo, qué NO se tocó, tests, diff stat.
```

---

## P06 — HomeComposer + SectionRegistry

```text
Implementa P06, una de las fases más sensibles.

OBJETIVO
Sacar de StoreHomePage el ORDEN y la decisión de qué secciones pintar, sin mover la lógica de negocio ni multiplicar queries. Crear un HomeComposer + SectionRegistry tipados.

CREA
src/features/storefront/home/types.ts
src/features/storefront/home/SectionRegistry.tsx
src/features/storefront/home/HomeComposer.tsx
src/features/storefront/home/HomeComposer.test.tsx

MODIFICA
src/features/storefront/StoreHomePage.tsx

PRINCIPIO
StoreHomePage sigue siendo dueño de hooks/query state/search/filter/catalog state. Debe construir un objeto de datos ya resueltos y pasarlo al composer. NO hagas que cada section adapter lance las mismas consultas por separado.

REGISTRY IDS
hero, services, categories, offers, cms, promotions, best-sellers, new-arrivals, featured, brands, trust, business-info, newsletter.
Si una sección todavía no tiene implementación/datos reales, el adapter debe poder devolver null limpiamente. No inventes contenido.

COMPATIBILIDAD CRÍTICA
Preserva exactamente las reglas existentes cubiertas por tests, incluyendo:
- hero CMS sustituye al hero fallback de store_settings cuando corresponde;
- ausencia de CMS no rompe Home;
- promociones/ofertas se muestran solo con datos reales;
- catálogo/búsqueda/filtros/query params siguen funcionando;
- quick view/favorites/prefetch siguen iguales;
- BrandTrustStrip y demás secciones existentes mantienen sus datos.

TDD
Prueba:
1. orden configurable;
2. disabled=false/true según contrato;
3. unknown id ignorado;
4. falta de datos => sección omitida sin crash;
5. default layout reproduce orden legacy-equivalent;
6. CMS hero replacement;
7. no nuevas consultas por duplicación de adapters.

NO metas contenido CMS dentro de home_layout.
NO alteres fetchers, pricing o catálogo por motivos de theme.

GATES
HomeComposer tests + storefront-content + storefront-ui + typecheck/lint/test/build.

REPORTA P06 PASS/FAIL, reducción de responsabilidades de StoreHomePage, tests y diff stat.
```

---

## P07 — Variantes compartidas de ProductCard/ProductGrid

```text
Implementa P07.

OBJETIVO
Preparar los componentes de producto para los cuatro themes con UNA sola lógica comercial y varias presentaciones cerradas.

MODIFICA
src/features/storefront/components/ProductCard.tsx
src/features/storefront/components/ProductGrid.tsx
src/features/storefront/components/ProductCard.test.tsx
src/features/storefront/storefront.css
src/features/storefront/theme/presets.ts si hace falta completar definición

DISEÑO
Crea una variante cerrada equivalente a:
- standard
- retail
- editorial
- compact
Los nombres pueden variar si P01 ya fijó otros; NO rompas el contrato existente.

MAPEO ESPERADO
universal -> standard
retail -> retail
premium -> editorial
catalog -> compact

INVARIANTES FUNCIONALES
TODAS las variantes deben conservar:
- href real de producto;
- ctrl/middle click semantics;
- quick view opcional;
- favorite heart;
- add-to-cart para producto simple;
- choose-options para producto con variantes;
- no agregar una variante arbitraria;
- price/compare-at/discount provenientes del mismo producto;
- stock/in_stock proveniente de la lectura actual;
- analytics add_to_cart;
- accesibilidad de botones y foco.

DIFERENCIAS SOLO VISUALES
Retail: precio/descuento/CTA más protagonista.
Editorial: imagen/espacio/nombre protagonista, menor ruido.
Compact: mayor densidad, menos alto por card, apto para catálogos grandes.
Standard: continuidad visual de la tienda actual.

ProductGrid debe resolver columnas/gaps desde ThemeDefinition, sin hardcodear business vertical.

TDD
Parametriza los tests del ProductCard para las cuatro variantes y asegura que las acciones disparan lo mismo.

GATES
ProductCard tests + storefront UI + typecheck/lint/test/build.

REPORTA P07 PASS/FAIL, diferencias visuales por variante, invariantes verificadas, tests, diff stat.
```

---

## P08 — Variantes compartidas de Hero, categorías y encabezados

```text
Implementa P08.

OBJETIVO
Hacer theme-aware las piezas principales de descubrimiento sin duplicar datos ni componentes.

REVISAR/MODIFICAR SEGÚN NECESIDAD REAL
src/features/storefront/components/StoreHero.tsx
src/features/storefront/components/StoreFeaturedHero.tsx
src/features/storefront/components/StoreCategoryNav.tsx
src/features/storefront/components/CategoryBar.tsx
src/features/storefront/components/SectionHeading.tsx
src/features/storefront/storefront.css
src/features/storefront/theme/presets.ts
tests de estos componentes/storefront

PRESENTACIONES
Universal: balanceado y neutro.
Retail: promoción, precio/categoría y CTA visibles.
Premium: media grande, whitespace, tratamiento editorial.
Catalog: hero discreto; búsqueda/categorías y acceso al catálogo tienen mayor jerarquía.

REGLAS
- Hero sin imagen debe seguir viéndose profesional.
- El h1/h2 debe conservar jerarquía semántica real.
- CTAs deben usar href/routes reales existentes.
- Category data viene de las mismas queries.
- No inventes imágenes ni categorías.
- No uses lógica tipo `if store.name contains farmacia`.
- No alteres CMS hero replacement.
- No quites accesibilidad para lograr diseño.

TDD
Incluye tests de heading level, CTA, ausencia de imagen, keyboard/focus y categorías.

GATES
focused + storefront-content + storefront-a11y-seo + typecheck/lint/test/build.

REPORTA P08 PASS/FAIL, variantes implementadas, tests y diff stat.
```

---

## P09 — Theme Universal: baseline de compatibilidad

```text
Implementa P09: cerrar el preset UNIVERSAL.

OBJETIVO
Universal es el theme por defecto para tiendas existentes. Debe modernizar y ordenar sin producir una ruptura visual/funcional inesperada. Es la referencia de backward compatibility.

TRABAJO
1. Revisa la apariencia actual previa al Theme Engine usando BASELINE y tests.
2. Define en presets.ts todos los defaults de Universal sin depender de overrides del tenant.
3. Asegura Home legacy-equivalent cuando home_layout no está configurado.
4. Ajusta storefront.css bajo data-store-theme='universal' solo donde el nuevo contrato lo necesite.
5. Reutiliza ProductCard standard, hero universal, categories universal y layout universal.
6. No hagas una segunda Home.

CRITERIOS VISUALES
- limpio;
- moderno;
- atractivo;
- neutro respecto al rubro;
- bastante aire sin sacrificar densidad comercial;
- mobile-first;
- productos y precios muy fáciles de escanear.

COMPATIBILIDAD
Prueba explícitamente un PublicStore sin los tres campos nuevos y otro con theme_preset=null/invalid simulado en parser. Ambos deben resolverse a Universal sin crash.

GATES
full storefront tests + global gates.

SALIDA P09 PASS/FAIL + evidencia de backward compatibility + tests + diff stat.
```

---

## P10 — Theme Retail

```text
Implementa P10: cerrar el preset RETAIL usando exclusivamente el Theme Engine y componentes compartidos.

OBJETIVO VISUAL
Una tienda comercial/promocional ideal para farmacia, droguería, abarrotes, belleza, consumo masivo y retail frecuente, PERO sin codificar esos rubros en lógica.

DEBE PRIORIZAR
- buscador y categorías claras;
- ofertas/promociones;
- precios y descuentos;
- quick add;
- más productos visibles;
- banners/campaigns CMS;
- confianza/servicios;
- buena lectura mobile.

NO DEBE
- saber qué es una farmacia;
- hardcodear verde, productos médicos ni textos de salud;
- inventar promociones;
- alterar descuento/stock/precio;
- duplicar ProductCard/Home/Header.

USA
ThemeDefinition retail + variantes ya creadas + CSS scope data-store-theme='retail'.

TESTS
- mismo producto produce mismo precio/discount/action que Universal;
- layout visual/variant diferente;
- mobile sin overflow;
- dark/reduced-motion no se rompen.

GATES
focused + full typecheck/lint/test/build.

REPORTA P10 PASS/FAIL, diferencias contra Universal, tests y diff stat.
```

---

## P11 — Theme Premium

```text
Implementa P11: cerrar el preset PREMIUM.

OBJETIVO VISUAL
Una presentación elegante/editorial apta para moda, calzado, joyería, cosmética, muebles o marcas premium sin lógica por industria.

DEBE PRIORIZAR
- imagen del producto;
- hero/campaign visual;
- whitespace;
- tipografía y jerarquía;
- colecciones;
- bordes/sombras más contenidos;
- CTA claro pero menos agresivo que Retail.

NO SACRIFIQUES
- precio;
- disponibilidad;
- navegación;
- búsqueda;
- favoritos;
- quick view;
- carrito;
- mobile;
- accesibilidad.

NO hardcodees nombres/marcas/industria.

IMPLEMENTACIÓN
ThemeDefinition premium + ProductCard editorial + hero/category/section variants existentes + CSS acotado.
No copies componentes enteros.

TESTS
Mismos invariantes comerciales que Universal/ Retail. Añade casos de producto sin imagen y texto largo para asegurar layout robusto.

GATES
focused + global.

REPORTA P11 PASS/FAIL, diferencias, tests y diff stat.
```

---

## P12 — Theme Catalog

```text
Implementa P12: cerrar el preset CATALOG.

OBJETIVO VISUAL
Optimizar descubrimiento y densidad para catálogos grandes: distribuidores, ferretería, repuestos, tecnología, droguería mayorista, etc., sin lógica por rubro.

PRIORIZA
- buscador;
- navegación/categorías;
- filtros/sort;
- mayor densidad de productos;
- ProductCard compact;
- precio/stock/presentación disponible;
- menos decoración;
- rápida exploración desktop y mobile.

MUY IMPORTANTE
No inventes SKU/presentación si PublicProduct no la expone. Si esos datos no existen en el read model, documenta el gap y NO amplíes el modelo de producto dentro de esta fase. El theme solo usa datos existentes.

No cambies pagination/load-more/search queries para “hacerlo catálogo”.
No pidas más filas al backend por theme sin un requerimiento explícito y tests de performance.

TESTS
- same business behavior;
- compact grid columns según ThemeDefinition;
- filtros/search siguen funcionando;
- 320/360 px sin overflow;
- reduced motion/dark mode.

GATES
focused + storefront + global.

REPORTA P12 PASS/FAIL, diferencias, gaps de datos reales si los hay, tests, diff stat.
```

---

## P13 — Footer e información empresarial universal

```text
Implementa P13.

OBJETIVO
Completar la “cara” empresarial del eCommerce con un footer profesional y neutro para cualquier negocio, usando solo información real existente del tenant y páginas públicas del CMS.

REVISA
StorefrontLayout.tsx
StorePagesFooter actual
store navigation/content hooks
PublicStore contact/business fields
BrandTrustStrip/StoreServicesStrip
white-label behavior

DISEÑO
El footer debe poder mostrar cuando existan:
- logo/nombre comercial;
- soporte/email;
- teléfono;
- dirección;
- enlaces de páginas públicas/legales;
- navegación útil;
- trust/service cues existentes.

REGLA ANTI-INVENCIÓN
NO inventes:
- Visa/Mastercard si no hay dato/contrato que lo indique;
- redes sociales inexistentes;
- WhatsApp inexistente;
- horarios inexistentes;
- envío gratis;
- garantía;
- dirección física;
- métodos de pago;
- claims comerciales.
Si falta data, omite limpiamente el bloque.

Puede crearse StoreFooter.tsx si mejora claramente StorefrontLayout.

THEMES
El mismo footer puede cambiar spacing/surface/tipografía por ThemeDefinition/CSS, no por cuatro componentes.

TESTS
- links legales accesibles;
- campos ausentes no dejan placeholders;
- campos presentes aparecen;
- white-label existente sigue respetado;
- mobile y keyboard.

GATES
focused + storefront UI/a11y + global.

REPORTA P13 PASS/FAIL, qué datos usa, qué decidió omitir por no existir, tests, diff stat.
```

---

## P14 — Admin: selector de Theme y estilos controlados

```text
Implementa P14 en el backoffice.

OBJETIVO
Agregar en Settings una sección/tab clara “Diseño de tienda” para seleccionar Universal, Retail, Premium o Catálogo y configurar solo overrides visuales cerrados.

REUTILIZA
SettingsPage
react-hook-form actual
storeFormSchema/toForm/saveStoreSettings
SectionTabs
BrandPreview solo si sirve; no fuerces su reutilización si necesitamos una preview más rica en P16.

CREA
src/features/admin/settings/StorefrontDesignSection.tsx
src/features/admin/settings/storefront-design.test.tsx

MODIFICA
SettingsPage.tsx
i18n es/en
types/settings form solo si hace falta por el estado actual

UI
Cuatro cards seleccionables:
- Universal: equilibrado y versátil
- Retail: comercial y promociones
- Premium: visual y editorial
- Catálogo: búsqueda y densidad
No digas “solo farmacia”, “solo moda”, etc. Puedes mencionar ejemplos en la ayuda, nunca restringir.

OVERRIDES
Muestra únicamente los campos realmente definidos en P01. No expongas internals ni JSON raw.
Incluye acción “Restablecer estilo del tema” que vuelva a defaults del preset sin borrar branding/CMS.

CAPABILITIES
Theme y layout NO dependen de content.white_label.
No alteres el gating existente de campos premium.

TDD
- seleccionar cada theme;
- dirty state;
- save payload;
- reset style;
- canWhiteLabel=false puede cambiar theme;
- i18n key parity.

GATES
settings tests + i18n tests + global.

REPORTA P14 PASS/FAIL, UX creada, tests, diff stat.
```

---

## P15 — Admin: editor accesible del orden de Home

```text
Implementa P15.

OBJETIVO
Permitir que un admin active/desactive y reordene las secciones conocidas de la Home sin convertir el producto en un page builder libre.

CREA
src/features/admin/settings/HomeLayoutEditor.tsx

INTEGRA
StorefrontDesignSection.tsx
storefront-design.test.tsx
i18n

UX OBLIGATORIA
Cada sección muestra:
- nombre legible;
- enabled switch/checkbox;
- mover arriba;
- mover abajo;
- maxItems solo si el contrato lo soporta para esa sección;
- reset a layout recomendado del theme.

ACCESIBILIDAD
No dependas solo de drag-and-drop. Si decides agregar DnD, arriba/abajo por teclado sigue siendo obligatorio.
Usa botones con aria-label específico y estado disabled correcto en extremos.

INVARIANTES
- sin IDs duplicados;
- no se puede introducir ID arbitrario;
- se persiste solo id/enabled/order/maxItems;
- no copies texto/imágenes/product IDs del CMS;
- ocultar una sección de Home NO debe ocultar header/search/rutas de catálogo.

TDD
Prueba enable/disable, reorder, first/last boundaries, reset, duplicate prevention, keyboard controls, serialization estable.

GATES
focused + global.

REPORTA P15 PASS/FAIL, modelo persistido, tests, diff stat.
```

---

## P16 — Preview Desktop / Tablet / Mobile con el mismo Theme Engine

```text
Implementa P16.

OBJETIVO
Dar al admin una previsualización realista del theme/layout antes de guardar, usando LOS MISMOS contratos/presets/componentes de producción para evitar divergencia.

CREA
src/features/admin/settings/StorefrontPreview.tsx

INTEGRA
StorefrontDesignSection.tsx

VIEWPORTS
- Desktop
- Tablet
- Mobile
Usa dimensiones de frame razonables y responsive CSS; no necesitas emular navegador completo.

FUENTE DE DATOS
Reutiliza datos ya autorizados disponibles en admin o un conjunto preview deliberadamente pequeño derivado de datos reales. NO uses service_role en browser, NO saltes RLS y NO hagas una segunda API privilegiada para preview.

PRINCIPIO CLAVE
No hagas un mock dibujado a mano que “se parezca” al theme. Debe consumir THEME_PRESETS/normalizers y, donde sea viable, componentes presentacionales reales o adaptadores finos.

PREVIEW UNSAVED
Los cambios de theme/layout/style en el formulario deben verse antes de guardar, sin modificar la tienda pública hasta Save.

TESTS
- switching Universal/Retail/Premium/Catalog cambia preview;
- Desktop/Tablet/Mobile cambia frame;
- unsaved form state se refleja;
- no provoca save automático;
- keyboard accessible;
- preview no introduce peticiones privilegiadas.

GATES
focused + global.

REPORTA P16 PASS/FAIL, estrategia de preview, tests, diff stat.
```

---

## P17 — Responsive + A11y + SEO + Performance hardening

```text
Implementa P17 como fase de hardening, NO como rediseño adicional.

OBJETIVO
Probar y corregir problemas reales de los cuatro themes en responsive, accesibilidad, SEO y performance sin cambiar lógica comercial.

RESPONSIVE
Verifica al menos clases equivalentes a:
- 320/360 mobile
- ~768 tablet
- >=1280 desktop
No horizontal overflow. Header, grid, hero, categorías, footer, drawers y preview deben ser utilizables.

A11Y
Preserva/valida:
- SkipToContentLink;
- focus visible;
- orden de Tab;
- heading hierarchy;
- button vs link semantics;
- aria names;
- dialogs/drawers;
- prefers-reduced-motion.

SEO
Asegura que theme NO cambie:
- title/meta;
- canonical;
- noindex de soft 404;
- enlaces reales de producto/categoría;
- contenido indexable importante.

PERFORMANCE
Ejecuta npm run bundle:report y compara con baseline si existe.
No quiero cuatro árboles importados duplicados, assets pesados exclusivos cargados siempre ni nuevas queries N+1.
Comprueba React Query/network ownership de HomeComposer.

PLAYWRIGHT
Añade un e2e enfocado al Theme Engine o extiende el actual de forma limpia. No uses screenshots gigantes como único assert; combina assertions funcionales con capturas de evidencia si la convención del repo lo permite.

GATES
npm run typecheck
npm run lint
npm run test
npm run test:db
npm run build
npm run bundle:report
npx playwright test (o el alcance e2e que el repo permita realmente; reporta cualquier dependencia externa faltante sin falsear PASS)

ARREGLA SOLO fallos reales encontrados y añade test de regresión.

SALIDA P17 PASS/FAIL, issues encontrados/corregidos, métricas, tests/e2e reales, diff stat.
```

---

## P18 — QA multirrubro + regresión completa + auditoría final

```text
Esta es la fase final P18. No agregues features nuevas salvo correcciones necesarias para cerrar regresiones demostradas.

OBJETIVO
Demostrar que el Theme Engine sirve a múltiples líneas de negocio con el MISMO código, hacer regresión completa del eCommerce y emitir una decisión GO / GO_WITH_GAPS / NO_GO.

PARTE A — 4 ESCENARIOS MULTIRRUBRO
Configura/representa usando DATA + CONFIG, nunca branching por industria:
1. Moda/ropa -> Premium
2. Zapatería/general retail -> Universal
3. Farmacia/droguería -> Retail
4. Abarrotes/distribuidor/catálogo grande -> Catalog

No necesitas contaminar seed productivo. Usa fixtures/test data/scripts de demo compatibles con las convenciones actuales.

Para cada escenario valida desktop y mobile:
- header/search;
- hero fallback y CMS;
- categorías;
- ofertas/promos si existen;
- productos;
- precio/descuento;
- favoritos;
- quick view;
- add to cart/choose options;
- footer;
- ausencia limpia de datos opcionales.

PARTE B — ANTI-FORK AUDIT
Busca y reporta cualquier patrón sospechoso:
- StoreHomeRetail/StoreHomePremium/etc.;
- if/switch por rubro;
- if(theme) repetido dentro de negocio;
- copia de pricing/discount/stock logic;
- CSS fuera de sf-scope que afecte admin.
Corrige lo que viole la arquitectura.

PARTE C — REGRESIÓN COMERCIAL
Ejecuta/valida según tests existentes:
- guest cart;
- authenticated cart;
- producto simple;
- producto con variantes;
- favorites;
- search;
- promotions/discounts;
- B2B pricing si la suite lo cubre;
- account-required checkout;
- taxes;
- payments/checkout pipeline;
- order creation/status/tracking;
- CMS capability fallback;
- RLS tenant isolation;
- public anon fields;
- SEO/a11y.

PARTE D — SEGURIDAD
Confirma:
- anon solo recibe los nuevos campos presentacionales necesarios;
- no se expuso config/tax/internal IDs;
- tenant no puede editar otro tenant;
- no hay arbitrary CSS/HTML/JS;
- no se editaron migraciones aplicadas;
- no hay secrets.
Ejecuta npm run scan:secrets.

PARTE E — DOCUMENTACIÓN
Crea:
docs/storefront-theme/MULTI_INDUSTRY_QA.md
docs/storefront-theme/REGRESSION_REPORT.md
docs/storefront-theme/FINAL_REPORT.md

FINAL_REPORT debe incluir:
- arquitectura final;
- migración creada;
- files/modules principales;
- themes y diferencias;
- admin workflow;
- backward compatibility;
- resultados exactos de tests;
- e2e;
- bundle/performance;
- gaps;
- rollback considerations;
- GO/GO_WITH_GAPS/NO_GO.

GATE FINAL
npm run typecheck
npm run lint
npm run test
npm run test:db
npm run build
npm run scan:secrets
npm run bundle:report
npx playwright test si el entorno está disponible.

Si corriges algo durante el gate final, vuelve a ejecutar al menos la suite afectada y después el gate completo pertinente. No declares GO con P0/P1 abiertos ni con storefront core roto.

SALIDA
Dame un resumen ejecutivo de máximo 2 páginas equivalente, seguido de la tabla exacta de pruebas. Incluye git diff --stat y git status final. No hagas push ni deploy.
```

---

## Resultado esperado al terminar P18

Un admin autorizado debe poder:

1. crear/usar una tienda existente;
2. elegir Universal, Retail, Premium o Catalog;
3. mantener logo/color/tipografía/radio/densidad existentes;
4. activar/desactivar/reordenar secciones permitidas de Home;
5. previsualizar Desktop/Tablet/Mobile;
6. guardar;
7. abrir `/s/:storeSlug` y ver exactamente la configuración;
8. cambiar completamente la personalidad visual sin modificar código ni indicar el rubro del tenant.

El storefront debe continuar usando los mismos contratos comerciales de catálogo, pricing, promociones, stock, carrito, checkout, pagos y órdenes.
