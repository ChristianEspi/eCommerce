# Checklist de datos de demo

Sin contraseñas. Correos solo enmascarados o como variable de entorno.

## Leyenda

- `READY` — verificado con evidencia (salida del preflight, E2E o comprobación manual registrada con fecha).
- `NOT_READY` — no existe, falla **o no se ha verificado todavía**. En QAS todo arranca así.
- `N/A` — no aplica a ese rol o el guion no lo enseña.

La columna **QAS** es la que decide la demo. La columna **Local** es solo referencia: pila Supabase local desechable
(`ecommerce-hardening-local`), verificada el 2026-09-13 con `node scripts/demo-preflight.mjs miquimica` y E2E 56/56.
No prueba nada sobre QAS.

## Cómo verificar en QAS (solo lectura)

```bash
DEMO_CONSUMER_EMAIL=… DEMO_TRADE_EMAIL=… DEMO_ENTERPRISE_EMAIL=… \
DEMO_MULTI_EMAIL=… DEMO_MULTI_PRODUCT_SLUG=… \
DEMO_ENTERPRISE_REQUIRES_PO=true DEMO_ENTERPRISE_SHOWS_CREDIT=true|false \
DEMO_TARGETED_PROMO_CODE=… \
node scripts/demo-preflight.mjs <slug>          # → DEMO_PREFLIGHT_RC = PASS
```

Requiere `VITE_SUPABASE_URL` + `SUPABASE_ACCESS_TOKEN` del proyecto de QAS en el entorno (nunca en el repo). Solo
consultas de lectura. Los usuarios se crean fuera del RC (`scripts/crear-usuario-b2b.mjs` para B2B, Auth/backoffice
para consumidor) — **nunca** con `scripts/e2e-local-fixtures.mjs`, que se niega a correr fuera de localhost.

## Tienda (común)

| Ítem | QAS | Local | Fuente de verificación |
|---|---|---|---|
| Tienda activa `<slug>` | NOT_READY | READY (`miquimica`) | preflight STORE |
| Tema válido + marca (acento, nombre) | NOT_READY | READY (universal) | preflight STORE |
| Catálogo pintable (≥ 20 productos, fotos, precio, stock, rebajados) | NOT_READY | NOT_READY (seed local: 8 productos, 0 fotos) | preflight STORE |
| Promociones vigentes | NOT_READY | READY (2) | preflight STORE |
| Bloques de portada (CMS) | NOT_READY | READY (3) | preflight STORE |
| Addon `ecommerce.pricing.lists` activo | NOT_READY | READY | preflight STORE |
| Migraciones H + N (7) aplicadas | NOT_READY | READY | preflight STORE |
| País por defecto del checkout | NOT_READY | READY (PE) | preflight B2C |
| Producto principal con stock | NOT_READY — `<DATO_DEMO_POR_CONFIRMAR>` | READY (`alcohol-en-gel-70`) | preflight TRADE/ENTERPRISE |
| Producto alternativo con stock | NOT_READY — `<DATO_DEMO_POR_CONFIRMAR>` | READY (`mascarilla-kn95`) | preflight B2C |

## Por rol

### Consumer

| Ítem | QAS | Local |
|---|---|---|
| Usuario existe | NOT_READY | READY (`c***@hardening.test`) |
| Relación: **sin** cuenta de empresa | NOT_READY | READY |
| Store correcta | NOT_READY | READY |
| Business account | N/A | N/A |
| Pricing (público) | NOT_READY | READY |
| Promociones públicas | NOT_READY | READY |
| Stock | NOT_READY | READY |
| Delivery (≥ 2 métodos) | NOT_READY | READY (3) |
| Payment (≥ 2 medios manuales) | NOT_READY | READY (4) |
| OC | N/A | N/A |
| Crédito | N/A | N/A |
| Al menos un pedido previo (para «Mis pedidos») | NOT_READY | READY (E2E) |
| Dirección guardada (para «Mis direcciones») | NOT_READY | READY (E2E) |

### Trade

| Ítem | QAS | Local |
|---|---|---|
| Usuario existe | NOT_READY | READY (`t***@hardening.test`) |
| Relación activa con una sola cuenta | NOT_READY | READY («Bodega E2E») |
| Store correcta (misma sociedad) | NOT_READY | READY |
| Business account sin aprobación/OC/tope/crédito/sedes (audiencia `trade`) | NOT_READY | READY |
| Pricing: lista vigente de segmento/cliente | NOT_READY | READY (`mayorista`) |
| Precio comercial verificable (< público) | NOT_READY | READY (`alcohol-en-gel-70` desde 4 u.) |
| Promociones (dirigida, si se enseña) | NOT_READY | N/A (la dirigida local es de Multi/Boreal) |
| Stock | NOT_READY | READY |
| Delivery | NOT_READY | READY |
| Payment | NOT_READY | READY |
| OC | N/A | N/A |
| Crédito | N/A | N/A |

### Enterprise

| Ítem | QAS | Local |
|---|---|---|
| Usuario existe | NOT_READY | READY (`e***@hardening.test`) |
| Relación activa | NOT_READY | READY («Corporativo E2E SAC») |
| Store correcta | NOT_READY | READY |
| Business account con control corporativo (audiencia `enterprise`) | NOT_READY | READY |
| Pricing: convenio vigente | NOT_READY | READY (`convenio`) |
| Precio convenio verificable | NOT_READY | READY (`alcohol-en-gel-70` desde 10 u.) |
| Promociones segmentadas | NOT_READY | NOT_READY (no verificada para esta cuenta) |
| Stock | NOT_READY | READY |
| Delivery | NOT_READY | READY |
| Payment | NOT_READY | READY |
| OC obligatoria | NOT_READY | READY (exige OC) |
| Crédito (solo si se muestra) | NOT_READY | READY (límite 50 000, 30 días; E2E no lo afirma) |
| Checkout no bloqueado por crédito | NOT_READY | READY |

Referencia histórica, **no verificada para este RC**: en DEV (2026-09-08) existía un login B2B de demo sobre la cuenta
«Policlinico Andino SAC» (segmento `clinicas`, tarifa convenio) — ver `DEMO_WEDNESDAY_README.md` §3-bis. Reconfirmar
con el preflight antes de usarlo.

### Enterprise Multi-account

| Ítem | QAS | Local |
|---|---|---|
| Usuario existe | NOT_READY | READY |
| Relación con 2+ cuentas activas de la misma sociedad | NOT_READY | READY («E2E Multi Andina…» / «E2E Multi Boreal…») |
| Store correcta | NOT_READY | READY |
| Selección guardada válida (o ninguna) | NOT_READY | READY (se borra en cada pasada de fixtures) |
| Precio distinto por cuenta en un producto (`DEMO_MULTI_PRODUCT_SLUG`) | NOT_READY | READY (`alcohol-en-gel-70`, verificado por E2E) |
| Promoción dirigida a una sola cuenta | NOT_READY | READY (`e2e-multi-boreal`, verificado por E2E) |
| Stock | NOT_READY | READY |
| Delivery (A paga / B gratis si se enseña) | NOT_READY | READY (`delivery-buyer-pricing`) |
| Payment | NOT_READY | READY |
| OC | N/A | N/A |
| Crédito | N/A | N/A |

### Admin (backoffice del tenant)

| Ítem | QAS | Local |
|---|---|---|
| Usuario existe con membresía del tenant y `active_company` | NOT_READY | N/A (no usado por E2E de comercio) |
| Rol con permiso de pedidos (transición pendiente → pagado) | NOT_READY | N/A |
| **No** es el Super Admin de suite ni un `@ebim.pe` actuando como negocio | NOT_READY | N/A |
| Acceso a Cuentas B2B, Precios, Diseño de tienda, Contenido | NOT_READY | N/A |
| Crédito / Planificación / Avisos (solo si se muestran) | NOT_READY | N/A |
