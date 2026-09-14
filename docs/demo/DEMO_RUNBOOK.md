# Runbook de la demo (15–20 min)

Release `feature/demo-commerce-release-candidate` · código `23228c5` · estado `LOCAL_RC_READY_QAS_PENDING`.

**Antes de empezar:** [`QAS_CHECKLIST.md`](QAS_CHECKLIST.md) con evidencia y
[`DEMO_DATA_CHECKLIST.md`](DEMO_DATA_CHECKLIST.md) en `READY`. Si no, la demo no se hace sobre QAS.

## Convenciones

- `<HOST>` = URL de QAS. `<slug>` = tienda de demo; la documentada es **`miquimica`** (`<DATO_DEMO_POR_CONFIRMAR>` en QAS).
- Datos que no están verificados en QAS se marcan **`<DATO_DEMO_POR_CONFIRMAR>`**: rellénalos tras correr el
  preflight, **no** los improvises en vivo.
- Ninguna contraseña aparece aquí. Las credenciales las custodia el operador.
- Textos entre «comillas» son los literales de la interfaz en español (verificados en el diccionario y en los E2E).

## Preparación de navegadores (5 min antes)

Usa **perfiles/ventanas separados** para no cerrar y abrir sesión delante del público:

| Ventana | Sesión | URL inicial |
|---|---|---|
| 1 · Invitado | ninguna (incógnito) | `<HOST>/s/<slug>` |
| 2 · Consumer | consumidor de demo | `<HOST>/s/<slug>/account` |
| 3 · Trade | comprador Trade | `<HOST>/s/<slug>` |
| 4 · Enterprise | comprador Enterprise (o Multi) | `<HOST>/s/<slug>` |
| 5 · Backoffice | admin del tenant con rol de pedidos | `<HOST>/app/orders` |
| 6 · Móvil | DevTools a 390 px o teléfono real | `<HOST>/s/<slug>` |

Deja los carritos vacíos. Ten a mano el **producto principal** y el **alternativo** (ver Data Checklist).

| Dato | Valor |
|---|---|
| Producto principal (con stock y precio comercial) | `<DATO_DEMO_POR_CONFIRMAR>` (en la pila local: `alcohol-en-gel-70`) |
| Producto alternativo (con stock) | `<DATO_DEMO_POR_CONFIRMAR>` (en la pila local: `mascarilla-kn95`) |
| Cantidad donde aplica precio Trade | `<DATO_DEMO_POR_CONFIRMAR>` (local: desde 4 u.) |
| Cantidad donde aplica convenio Enterprise | `<DATO_DEMO_POR_CONFIRMAR>` (local: desde 10 u.) |
| Cuenta Enterprise | `<DATO_DEMO_POR_CONFIRMAR>` |
| Cuentas A / B del usuario Multi | `<DATO_DEMO_POR_CONFIRMAR>` (local: «E2E Multi Andina…» / «E2E Multi Boreal…») |
| Número de OC a teclear | cualquiera de 1–60 caracteres, p. ej. `OC-DEMO-001` |
| Medio de pago a usar | «Transferencia bancaria» (manual; no depende de pasarela) |

---

## BLOQUE A — Intro / SaaS (2–3 min)

**Objetivo:** que se entienda que no es una tienda hecha para un único cliente.

| # | Acción | Resultado esperado | Qué decir |
|---|---|---|---|
| A1 | Ventana 1: abrir `<HOST>/s/<slug>` | Portada con marca, colores y logo del tenant; categorías, ofertas | «Esta es la tienda de un tenant. Todo lo que ven es configuración y datos, no código a medida.» |
| A2 | Señalar cabecera, acento, portada | Branding del tenant (acento de Marca) | «El color, el logo y la portada los define cada sociedad.» |
| A3 | Ventana 5: `<HOST>/app/settings#design` («Diseño de tienda») | Cuatro tarjetas de tema + vista previa | «Cuatro temas sobre el mismo motor.» |
| A4 | Pulsar **Universal → Retail → Premium → Catalog** en la vista previa, **sin guardar** | La vista previa cambia geometría, tarjetas y cabecera con el motor real | «Mismo catálogo, misma lógica; cambia la experiencia.» |
| A5 | (Opcional) `/app/content` («Páginas», «Bloques», «Vista previa») | Portada compuesta por bloques CMS | «La Home y las páginas son contenido administrable.» |

**No guardes el tema en vivo.** Si quieres enseñar los cuatro sin backoffice, usa las capturas de
[`../release-candidate/visual/`](../release-candidate/visual/) (Universal 1440, Premium 390, Catalog 1440, Retail 390).

---

## BLOQUE B — Consumer B2C (4 min)

### B.1 · Compra como invitado (ventana 1)

| # | Acción | Resultado esperado |
|---|---|---|
| B1 | Portada → pulsar una categoría | Listado de la categoría |
| B2 | Buscador de la cabecera → escribir parte del nombre del producto principal | Sugerencias; al elegir, se abre la ficha |
| B3 | PDP `/s/<slug>/product/<producto>` | Precio público dominante, stock, botón «Agregar al carrito» |
| B4 | «Agregar al carrito» → abrir carrito `/s/<slug>/cart` | Línea del producto, «Precio confirmado por la tienda», **sin** «Precio especial» |
| B5 | Si hay promoción pública vigente sobre el producto | Descuento visible en el resumen del carrito |
| B6 | «Finalizar compra» → paso «Contacto» (nombre, correo, teléfono) → «Siguiente» | Paso «Entrega» |
| B7 | Dirección, ciudad, región; el **país ya viene puesto**; elegir método de entrega → «Siguiente» | Paso «Pago» con coste de entrega |
| B8 | Elegir «Transferencia bancaria» → «Confirmar pedido» | Página «Pedido registrado» con número de pedido e instrucciones de pago |

**Apunta el número de pedido** (se usa en el Bloque E).

Qué decir: «Compra sin registrarse. La cuenta es opcional. El total lo confirma el servidor.»

### B.2 · Usuario registrado (ventana 2)

| # | Acción | Resultado esperado |
|---|---|---|
| B9 | (Si no hay sesión) «Entrar» en la cabecera → login | Vuelve a la tienda, no al backoffice |
| B10 | «Tu cuenta» → `/s/<slug>/account` | «Mi cuenta» · «Hola, …» con pestañas «Mis pedidos», «Mis favoritos», «Mis datos», «Mis direcciones», «Avisos» |
| B11 | «Mis pedidos» (`#pedidos`) → abrir un pedido | Detalle con líneas, desglose guardado, entrega; «Volver a comprar» |
| B12 | «Mis direcciones» (`#direcciones`) | Libreta del consumidor (predeterminada, editar, borrar) |
| B13 | «Mis favoritos» (`#favoritos`) | Productos guardados |
| B14 | Ventana 6 (móvil 390 px): portada → ficha → carrito | Sin desplazamiento horizontal; buscador disponible; pestañas de cuenta alcanzables |

Qué decir: «Registro opcional dentro de la propia tienda (`/s/<slug>/register`), direcciones y pedidos aislados por
usuario y tienda, y la misma experiencia en móvil.»

> Si el consumidor de demo aún no tiene pedidos, haz B6–B8 con su sesión antes de la demo, no en vivo.

---

## BLOQUE C — Trade / Reseller (3 min, ventana 3)

| # | Acción | Resultado esperado |
|---|---|---|
| C1 | Con sesión Trade, abrir `<HOST>/s/<slug>` | Barra sobre el contenido: «Cuenta comercial · <cuenta> · Condiciones comerciales activas». **No** dice «Comprando para» |
| C2 | Catálogo / portada → tarjeta del producto principal | «Tu precio comercial» con el público tachado cuando mejora |
| C3 | Ventana 1 (invitado) al lado, misma tarjeta | Solo precio público |
| C4 | Abrir PDP del producto principal → subir cantidad al escalón Trade | Precio comercial en la ficha |
| C5 | «Agregar al carrito» → carrito | «Precio especial»; total menor que el público |
| C6 | Si hay promoción dirigida a su segmento/cuenta (`<DATO_DEMO_POR_CONFIRMAR>`) | Descuento en el carrito = descuento en el pedido |
| C7 | Checkout: Contacto → Entrega → Pago «Transferencia bancaria» → «Confirmar pedido» | «Pedido registrado» |

Qué decir:

> Este mismo producto puede tener condiciones diferentes cuando el comprador es un negocio minorista o reseller
> autorizado.

Enseña explícitamente **Precio público (ventana 1) vs Precio Trade (ventana 3)**. El navegador no envía precio ni
cuenta: los resuelve el servidor.

**No afirmes que hay crédito** para Trade: el perfil Trade, por definición, no tiene crédito, OC, tope ni aprobación.

---

## BLOQUE D — Enterprise B2B (4 min, ventana 4)

| # | Acción | Resultado esperado |
|---|---|---|
| D1 | Con sesión Enterprise, abrir `<HOST>/s/<slug>` | Barra «Comprando para · <EMPRESA> · Precio convenio activo» |
| D2 | **Solo si el usuario es Multi:** botón «Cambiar cuenta» → elegir cuenta B | Aviso «Ahora compras para <B>»; precios de tarjetas, ficha y carrito se recalculan |
| D3 | PDP del producto de multi-cuenta con cuenta A, luego con B | Precio A ≠ precio B («Precio acordado con tu empresa») |
| D4 | PDP del producto principal con cantidad del convenio | «Precio acordado con tu empresa», público tachado |
| D5 | Promoción segmentada (si existe para la cuenta) | Descuento en carrito; al cambiar de cuenta cambia la campaña |
| D6 | «Agregar al carrito» → carrito | «Precio especial»; entrega cotizada con el precio de la cuenta efectiva |
| D7 | Checkout → paso «Pago»: intentar «Confirmar pedido» sin OC | Aviso «Escribe el número de orden de compra» (si la cuenta exige OC) |
| D8 | Teclear OC `OC-DEMO-001` → «Confirmar pedido» | «Pedido registrado» mostrando la OC |
| D9 | «Tu cuenta» → portal: «Mis pedidos» | El pedido con la cuenta y la OC en el detalle |
| D10 | (Opcional) «Estado de cuenta», «Sugeridos», «Avisos» | Solo si el Data Checklist los marca `READY` |

Qué decir: «Pricing server-side con la empresa efectiva; promociones segmentadas; entrega coherente con esa cuenta;
OC exigida en servidor antes de cobrar; portal empresarial.»

---

## BLOQUE E — Backoffice (4–5 min, ventana 5)

No pasees por todos los menús. Solo esto:

| # | Ruta | Qué enseñar |
|---|---|---|
| E1 | `/app/orders` → buscar el número apuntado en B8/C7/D8 | Pedido recién creado: estado, pago, entrega, OC (Enterprise), cuenta |
| E2 | `/app/customers#cuentas` («Cuentas B2B») | Cuenta empresarial: controles (OC, crédito, aprobación), usuarios vinculados |
| E3 | `/app/pricing#listas` / `#simulador` | Lista comercial / convenio; el Simulador explica la precedencia |
| E4 | `/app/settings#branding` («Marca») y `#design` («Diseño de tienda») | Branding y tema del tenant |
| E5 | `/app/content` («Páginas» / «Bloques») | Home administrable |
| E6 | Opcional: `/app/credit`, `/app/planning`, «Avisos» | Solo si están `READY` en el Data Checklist |

Transición de pedido segura: **pendiente → pagado**. Desde `pending` solo se admite `paid` o `cancelled`; otro CTA
da «transición no permitida». No pulses «emitir» en comprobantes (emisión no cableada).

---

## BLOQUE F — Cierre (1 min)

```text
Una plataforma
+ múltiples tenants
+ múltiples rubros
+ Consumer
+ Trade
+ Enterprise
+ Themes configurables
```

**Employee Commerce no está implementado.** Solo puede mencionarse como roadmap que la arquitectura soporta (un
empleado sin cuenta de empresa hoy compra como consumidor).

## Tiempos

| Bloque | Min |
|---|---|
| A · Intro/SaaS | 2–3 |
| B · Consumer | 4 |
| C · Trade | 3 |
| D · Enterprise | 4 |
| E · Backoffice | 4–5 |
| F · Cierre | 1 |
| **Total** | **18–20** |

Si vas justo de tiempo: omite B14 (móvil), D10 y E6.
