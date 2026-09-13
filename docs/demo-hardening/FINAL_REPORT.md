# Hardening multi-commerce — informe final

Rama `feature/demo-commerce-hardening-v1` (desde `dev` @ `1bcf74f`) · 2026-09-13 · **sin push, sin PR,
sin despliegue**. Detalle fase a fase en [`EXECUTION_LOG.md`](EXECUTION_LOG.md); línea base en
[`BASELINE.md`](BASELINE.md); auditoría de identidad comercial en
[`COMMERCIAL_CONTEXT_AUDIT.md`](COMMERCIAL_CONTEXT_AUDIT.md).

## Executive Status

**`GO_WITH_GAPS`**

El código cumple los 15 criterios de GO (tabla abajo) y está verificado de punta a punta en una pila
Supabase local con la función `checkout` real: **44/44 E2E** en escritorio y móvil. No es `GO` limpio
por tres cosas que no están en el código y que hay que hacer antes de enseñarlo:

1. **Nada está desplegado.** Tres migraciones nuevas y la Edge Function `checkout` tienen que llegar a
   QAS; sin ellas «Mis pedidos» y «Mis direcciones» dicen «Aún no disponible en esta tienda», la barra
   de contexto no aparece y el país no se propone (todo degrada sin romper).
2. **El preflight no se ha corrido contra DEV/QAS**: esta máquina no tiene `.env`. Contra la pila local
   las secciones B2C, TRADE y ENTERPRISE dan OK.
3. **Los usuarios de demo de consumidor y de comercio no existen en DEV** (el único login de demo
   documentado es el B2B de `DEMO_WEDNESDAY_README.md`). Hay que crearlos; el preflight dice qué falta.

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Guest B2C funciona | ✅ | E2E invitado hasta confirmación (escritorio y móvil); `checkout-ui.test.tsx` 51/51 |
| 2 | B2C registrado coherente | ✅ | «Mi cuenta» con pedidos, favoritos, datos, direcciones y avisos; E2E registrado |
| 3 | Órdenes B2C aisladas | ✅ | `consumer-account.test.ts` (20, Postgres real): otro usuario, invitado con el mismo correo, otra tienda y otro tenant no ven nada |
| 4 | Trade con condiciones existentes sin bypass | ✅ | E2E trade: cobrado < público cotizado a anónimo; cuerpo sin precio ni identidad; `commerce-audience-guard.test.ts` |
| 5 | Enterprise conserva pricing y portal | ✅ | E2E enterprise hasta «Mis pedidos» del portal B2B |
| 6 | Theme Engine estable | ✅ | 4 temas en unit (`multi-industry`, `theme-*`) y E2E `theme-engine` |
| 7–10 | Carrito, quote, checkout y creación de pedido | ✅ | Suites existentes intactas + E2E de las tres experiencias hasta pedido |
| 11 | Aislamiento tenant | ✅ | `rls-tenant-isolation`, `schema-invariants`, `security-baseline` verdes; tests de aislamiento de cada objeto nuevo |
| 12 | Unit sin regresiones | ✅ | 3 790 ✓; los 6 ✗ son exactamente los de H00 (entorno) |
| 13 | DB sin regresiones | ✅ | 2 185/2 185 (H00: 2 131/2 131) |
| 14 | Build | ✅ | PASS, 1 691 módulos |
| 15 | E2E críticos | ✅ | 44/44 en pila local; contra DEV no ejecutado (sin `.env`) |

## Commerce Modes

| Modo | Implementado | Demo ready | Limitaciones |
|---|---|---|---|
| **B2C Consumer Guest** | Sí (previo; intacto) + país por defecto desde la tienda | **Sí** en cuanto se aplique `20260913120000` (sin ella, igual que antes) | Sin cambios de flujo |
| **B2C Consumer Registered** | **Sí (nuevo)**: Mi cuenta, Mis pedidos + detalle + volver a comprar, Mis favoritos, Mis datos (nombre/teléfono), Mis direcciones (derivadas de sus pedidos), checkout que propone datos y direcciones | Tras desplegar migración `20260913100000` + función `checkout`, y crear un usuario consumidor | Solo aparecen pedidos hechos **con sesión** desde el despliegue; no hay registro público de consumidores; libreta de direcciones no editable |
| **Trade / Reseller** | **Sí**: pricing existente (segmento/cliente/lista/escala) + barra «Cuenta comercial · Condiciones comerciales activas» | Tras desplegar `20260913110000` y preparar una cuenta sin controles corporativos con lista vigente | La etiqueta se deduce de la configuración de la cuenta; una cuenta con crédito se pinta como «empresa» |
| **Enterprise B2B** | **Sí** (previo) + barra «Comprando para · Precio convenio activo» | Sí con el login B2B existente si su cuenta tiene algún control corporativo y convenio vigente (lo verifica el preflight) | Sin selector multi-cuenta (A1) |
| **Internal / Employee** | No (fuera de alcance) | No | No se bloquea nada: un empleado con sesión y sin cuenta de empresa ve la cuenta de consumidor |

## B2C Consumer

- **Guest checkout**: intacto. Lo único nuevo es el país inicial (derivado de las zonas de entrega de la
  tienda). El «Precio especial» que un anónimo leía con la lista general de la tienda ya no aparece
  (hallazgo A3, corregido en carrito, panel y resumen).
- **Account**: `/account` resuelve la experiencia por servidor. Con cuenta de empresa activa → portal B2B
  de siempre. Sin ella → «Mi cuenta · Hola, …» con cinco pestañas (`SectionTabs`, deep-link `#hash`).
- **Orders**: `order_buyers` vincula cada pedido con el usuario **verificado** que lo hizo; lo escribe el
  checkout tras crear el pedido (best-effort, sin poder tumbarlo) por una función solo `service_role`.
  `my_consumer_orders` / `my_consumer_order_detail` reciben solo el slug de la tienda. El detalle pinta
  importes guardados; «Volver a comprar» manda producto y cantidad al carrito releyendo el catálogo de
  hoy y recotizando — el precio histórico no viaja.
- **Profile**: correo visible y no editable; nombre y teléfono en `user_metadata` (ninguna regla del
  sistema lo usa para autorizar).
- **Addresses**: sin tabla nueva. Son las direcciones de sus pedidos vinculados, la más reciente
  primero; el checkout las ofrece para **elegir** (ninguna se escribe sola).
- **Favorites**: reutilizados tal cual (misma vista que `/favoritos`).

## Trade / Reseller

- **Account / segment**: los de siempre (`business_accounts`, `customers.segment_id`).
- **Commercial pricing**: el motor existente vía `ebim.pricing_actor`. No hay motor nuevo ni parámetro
  nuevo. `my_commerce_context` nombra **la misma cuenta** que usa el precio (probado contra
  `pricing_actor` con dos cuentas) y dice si hay lista vigente, sin revelar cuál.
- **Catalog**: el mismo. La tarjeta sigue mostrando precio público; el precio comercial aparece en ficha
  (qty 1, si aplica), carrito y checkout.
- **Checkout / order**: el checkout común. Contado, transferencia o pasarela según los medios de la
  tienda; no se asume crédito.

## Enterprise

- **Business account**: intacta; barra «Comprando para» con el nombre largo recortado y completo en
  `title`.
- **Negotiated pricing**: «Precio convenio activo» solo si hay lista activa y vigente de su cliente o
  segmento. Tener cuenta no es tener convenio.
- **Credit / portal / planning / notifications**: sin cambios; E2E hasta «Mis pedidos» del portal.
- **Order**: checkout común con la aprobación/tope existentes cuando la cuenta los exige.

## Theme Engine

Universal, Retail, Premium y Catalog siguen funcionando: suites `theme-*` y `multi-industry` verdes,
E2E `theme-engine` 8/8 (escritorio y móvil). Nuevo: la sección `categories` pinta las familias reales
del tenant, **apagada por defecto** en los cuatro temas y encendible desde Diseño de tienda; probada en
ocho rubros × cuatro temas como tabla de datos (sin `if (industry === …)`).

## Tests

Cifras reales de H14 (en serie, desde cero):

| Gate | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 problemas |
| `npm run test` (incluye `supabase/tests`) | 196 archivos · 3 796 tests · **3 790 ✓ · 6 ✗** (los 6 de baseline) |
| `npm run test:db` | 82 archivos · **2 185 ✓** |
| `npm run build` | PASS (1 691 módulos) |
| `npm run bundle:report` | PASS — portada 400,3/405 · ficha 384,2/400 · checkout 401,9/430 · panel 359,9/430 |
| `npm run scan:secrets` | PASS, sin hallazgos |
| E2E `npx playwright test` (pila local) | **44/44** — escritorio 12 · móvil 12 · comercio-escritorio 10 · comercio-móvil 10 |

## Regression Delta (H00 → H14)

| | H00 | H14 | Δ |
|---|---|---|---|
| Unit (suite completa) | 3 686 ✓ / 6 ✗ | 3 790 ✓ / 6 ✗ | **+104 ✓**, 0 fallos nuevos |
| DB | 2 131 ✓ | 2 185 ✓ | **+54 ✓** |
| Archivos de test | 187 | 196 | +9 |
| Build | PASS | PASS | = |
| Portada (bundle) | 399,5 kB / techo 400 | 400,3 kB / techo 405 | +0,8 kB; techo subido con justificación (`performance-budget.md` §2.1) |
| E2E | no ejecutable | 44/44 | — |

Tests existentes modificados, y por qué no es debilitarlos:

- `customers-ui.test.tsx` «con sesión y sin vínculo»: exigía el texto «no está vinculado a ninguna
  empresa»; H02 cambia esa pantalla por la cuenta de consumidor. Ahora exige más: el `h1` «Mi cuenta»,
  sus pestañas y la **ausencia** de pestañas B2B.
- `cart-quote.test.tsx`: el fixture del «acuerdo» usaba ámbito `store`; un acuerdo es de segmento o
  cliente. Se añadieron los casos `customer` (sí) y `store` (no).
- `HomeComposer.test.tsx`: `categories` salió de «sin componente» porque ya lo tiene; dos casos nuevos.
- `golden-path.e2e.ts` / `theme-engine.e2e.ts`: dependían de qué sección ponía la primera tarjeta
  (fallan igual con el código de baseline y los mismos datos). La ficha se abre por su `href` y el
  `.or()` de la vista rápida ya no rompe el modo estricto. Siguen verificando lo mismo.

## Remaining Gaps

| Gap | Estado | Nota |
|---|---|---|
| **Multi-business-account selector** | Pendiente | No se construyó (instrucción H06). Riesgo real A1: el checkout toma `rows[0]` de `my_business_accounts()` (sin filtro de tenant, por nombre) mientras el precio usa la cuenta más antigua de la sociedad. Con dos cuentas pueden discrepar. Encaja con la decisión de suite pendiente `gmao-038` (selector de tenant). Demo: una cuenta por usuario (el preflight lo exige). |
| **Mandatory PO enforcement** | Pendiente | `purchase_order_required` se muestra y cuenta como control corporativo; el checkout no pide ni exige OC. |
| **B2B catalog price overlay** | Pendiente | La rejilla muestra precio público (vista sin parámetros, por diseño P04). El precio comercial se ve en ficha, carrito y checkout. |
| **True channel resolver** | Pendiente | `CommerceAudience` es presentación; no hay resolución de canal por audiencia. |
| **Employee Commerce** | Fuera de alcance | Nada lo bloquea. |
| **Real WYSIWYG preview** | Pendiente | La vista previa de Diseño sigue siendo la existente. |
| Promociones dirigidas a cliente en el carrito (A2) | Pendiente | La cotización pública evalúa promociones sin cliente; el pedido con cliente. |
| Registro público de consumidores (A5) | Pendiente | Las cuentas se crean desde backoffice/Auth. |
| Libreta de direcciones editable del consumidor | Pendiente | Necesita tabla propia; hoy se derivan de sus pedidos. |
| Pedidos de consumidor anteriores al despliegue | Por diseño | Solo se vinculan pedidos hechos con sesión desde que la función `checkout` nueva está desplegada. |
| Techos de bundle | Decisión del operador | Portada 400 → 405 con ~1 % de margen; re-basar con el criterio de medido + 20 % o dieta de la entrada. |
| Iconos de familia por rubro | Pendiente | Familias fuera del diccionario (calzado, tecnología…) usan el icono genérico; ampliarlo cuesta ~1,5 kB en la cabecera. |
| Botón flotante del asistente | Previo | En móvil tapa la última fila de una lista al final del scroll. |
| 6 tests de unit de entorno | Previo | Node 24 + `AbortSignal` de jsdom (4) y falta de `.env` (2); verdes con Node 20 + `VITE_*`. |
| Buzón EBIM | Revisado (lectura) | Sin mensajes nuevos `to: ecommerce`/`to: all` posteriores a 2026-08-20. No se escribió en la carpeta compartida. |

## Demo Script

> Credenciales: **ninguna está en este repositorio**. Los usuarios `*@hardening.test` existen solo en la
> pila local de pruebas (contraseñas en su archivo de entorno, fuera del repo). Para DEV/QAS, las
> cuentas se crean como indica la QAS Checklist y se verifican con el preflight.

Tienda: `/s/miquimica`. Antes de empezar: `DEMO_PREFLIGHT = PASS`.

### DEMO A — Consumer

1. Sin sesión, abrir `/s/miquimica`. Buscar «vitamina» en la cabecera; abrir un producto.
2. Añadir al carrito. En el carrito: total confirmado por la tienda y **sin** «Precio especial».
3. Checkout: contacto → entrega (el **país ya viene puesto**: sale de las zonas de la tienda) → pago
   por transferencia → «Confirmar pedido». Confirmación con número de pedido.
4. Pulsar «Entrar» y acceder con el **consumidor de demo**. Repetir una compra: el checkout ya propone
   correo (y nombre/teléfono si los tiene) y, en «Entrega», **Tus direcciones**.
5. «Tu cuenta» → **Mi cuenta · Hola, …** → *Mis pedidos*: el pedido recién hecho. Abrirlo: líneas,
   desglose guardado, entrega y dirección → **Volver a comprar** (al carrito con el precio de hoy).
6. *Mis datos*: editar nombre y teléfono. *Mis direcciones*: las usadas. *Mis favoritos*.

### DEMO B — Trade / Reseller

1. Mostrar el precio público del producto de demo (el preflight dice cuál y desde qué cantidad aplica,
   p. ej. en local: `alcohol-en-gel-70` desde 4 u.).
2. Entrar con el **comprador del comercio**. Sobre el contenido: **Cuenta comercial · <nombre> ·
   Condiciones comerciales activas**. No dice «Enterprise».
3. Abrir el producto, subir la cantidad al escalón, añadir. En el carrito: **Precio especial** y un
   total menor que el público.
4. Checkout común (transferencia): el pedido se cobra al precio que calculó el servidor. Nada en el
   navegador declara precio ni cuenta.

### DEMO C — Enterprise

1. Entrar con el **comprador corporativo** (en DEV, el login B2B de `DEMO_WEDNESDAY_README.md` si el
   preflight lo clasifica como `enterprise`).
2. Barra **Comprando para · <empresa> · Precio convenio activo**.
3. Producto con cantidad del convenio → carrito con «Precio especial» → checkout → pedido.
4. «Tu cuenta» → portal B2B: *Mis pedidos* (el pedido aparece), *Estado de cuenta* (crédito),
   *Sugeridos*, *Avisos*. En móvil, todas las pestañas se alcanzan deslizando.

## QAS Checklist

**No desplegado.** Orden exacto:

1. [ ] Revisar y fusionar `feature/demo-commerce-hardening-v1` en `dev` (`git log --oneline dev..`; nada empujado).
2. [ ] Aplicar migraciones **en orden** en QAS (`node scripts/aplicar-migracion.mjs <archivo>`):
   - `20260913100000_consumer_account.sql`
   - `20260913110000_commerce_context.sql`
   - `20260913120000_store_default_country.sql` (recrea `public_stores`)
3. [ ] Desplegar la Edge Function **`checkout`** (incluye `_shared/checkout/dbPorts.ts` con el vínculo
   del comprador). Ninguna otra función cambió.
4. [ ] `npm run db:types` y commitear el diff (las constantes nuevas de RPC no llevan `satisfies`
   hasta regenerar).
5. [ ] Verificar `ecommerce.pricing.lists` **activo** en `tenant_entitlements` de la sociedad de demo
   (sin él, todo cobra a catálogo en silencio).
6. [ ] Usuarios de demo:
   - Consumidor: crear la cuenta en Auth **sin** vincularla a ninguna empresa.
   - Comercio: `node scripts/crear-usuario-b2b.mjs <correo> <contraseña> "<cuenta>"` sobre una cuenta
     **sin** aprobación, OC, tope, crédito ni varias sedes, cuyo cliente tenga segmento con lista vigente
     (p. ej. `mayorista`).
   - Empresa: una cuenta con algún control corporativo y lista vigente (p. ej. `clinicas`/`convenio`).
   - Una sola cuenta activa por usuario.
7. [ ] `DEMO_CONSUMER_EMAIL=… DEMO_TRADE_EMAIL=… DEMO_ENTERPRISE_EMAIL=… node scripts/demo-preflight.mjs miquimica`
   → **`DEMO_PREFLIGHT = PASS`**.
8. [ ] Smoke manual en `/s/miquimica`: la tienda se ve igual que antes para un anónimo (tema, portada,
   carrito, checkout) y el país aparece en el checkout.
9. [ ] E2E sin crear datos contra QAS: `npx playwright test --project=escritorio --project=movil`.
   Los proyectos `comercio-*` crean pedidos reales: solo contra una pila local o un entorno desechable.
10. [ ] Revisar la subida del techo de la portada (`docs/performance-budget.md` §2.1).

## E2E en pila local (cómo se reprodujo)

1. Copia de `supabase/` en un directorio temporal con `project_id` y puertos propios (553xx) para no
   chocar con otras pilas; `supabase start` sin migraciones y aplicarlas una a una con `psql` dentro
   del contenedor (omitiendo en la COPIA la sentencia `alter table storage.objects enable row level
   security`, que Storage reciente no permite al rol `postgres`).
2. `supabase/seed.sql` + `supabase/demo-data.sql`.
3. `node scripts/e2e-local-fixtures.mjs` con `E2E_SUPABASE_URL`, `E2E_SERVICE_ROLE_KEY` (de
   `supabase status`) y los correos/contraseñas `E2E_{CONSUMER,TRADE,ENTERPRISE}_{EMAIL,PASSWORD}`. Se
   niega a correr fuera de localhost; repone existencia y el limitador en cada pasada.
4. `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` de la pila local y `npx playwright test`.
5. Preflight local: `PREFLIGHT_DB_CONTAINER=<contenedor db> DEMO_*_EMAIL=… node scripts/demo-preflight.mjs`.

Diferencia declarada: la pila local usa Postgres 17 (imagen en caché) y DEV usa 15.
