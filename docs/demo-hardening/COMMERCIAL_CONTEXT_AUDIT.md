# H01 — Auditoría del contexto comercial

Cómo deriva HOY el sistema quién compra y con qué condiciones. Todo con ruta y línea; nada de lo
descrito aquí se cambió en H01.

## 1. La ruta real del precio

```text
navegador ──(slug, product_id, variant_id, quantity)──► price_quote_for_slug / promotion_quote_for_slug
                                                              │  (no aceptan identidad: firma p_store_slug, p_items)
                                                              ▼
                                                     ebim.build_quote(p_public = true)
                                                              │  si segmento y cliente vienen nulos:
                                                              ▼
                                         ebim.pricing_actor(org, company)   ← ebim.user_id() del JWT
                                                              │  business_account_users(status='active')
                                                              │  → business_accounts(is_active, mismo tenant)
                                                              │  → customers(is_active)   · la MÁS ANTIGUA si hay varias
                                                              ▼
                                         ebim.resolve_prices(store, channel, lines, …, segment_id, customer_id)
                                                              │  precedencia customer > segment > channel > store
                                                              ▼
                                                  líneas con source = catalog | price_list y scope
```

| Pieza | Dónde |
|---|---|
| `ebim.pricing_actor` (definer, solo `service_role`) | `supabase/migrations/20260908130000_storefront_b2b_pricing.sql:68-96` |
| `ebim.build_quote` + lista negra `CAMPO_NO_PERMITIDO` | mismo archivo `:102-192` |
| `ebim.resolve_prices` | `20260827180100_pricing_resolution.sql:173` |
| Precio de tarjeta/ficha (`public_products` → `ebim.public_unit_prices`) | `20260827180100:383` — solo ámbitos `store` y canal público, cantidad 1: **nunca** segmento ni cliente |
| Pedido: `create_order(..., p_business_account_id, ...)` recomprueba tenant (`CUENTA_NO_APLICA`) y cobra con `resolve_price(segment, customer)` | `20260908130000:383, 507-521, 702-713` |

## 2. Los cinco perfiles de comprador

| Perfil | Cómo lo reconoce el servidor | Qué precio recibe |
|---|---|---|
| Consumidor anónimo | sin JWT de usuario; `pricing_actor` devuelve fila vacía | catálogo + listas `store`/`channel` |
| Consumidor autenticado | JWT con `sub`, **sin** fila activa en `business_account_users` | idéntico al anónimo |
| Comprador de empresa | JWT + `business_account_users.status='active'` + cuenta y cliente activos **en la sociedad de la tienda** | + listas `segment` (del `customers.segment_id`) y `customer` |
| Cliente (`customers`) | ficha del tenant; `kind = person|company`, `segment_id`, `business_type_id`, `tier` | lo decide su segmento y sus asignaciones |
| Acuerdo / convenio | **no hay tabla de acuerdos**: un convenio es una `price_list` asignada con `scope='customer'` o `'segment'` | — |

No existe ninguna columna que diga «trade» o «enterprise». Lo más cercano es `customers.business_type_id`
(giro), `customers.tier` (a/b/c) y el código del segmento, y los tres son dato libre del tenant.

## 3. Tests que ya defienden la identidad del precio

- `supabase/tests/pricing-checkout.test.ts`: «el payload no puede declarar la lista de precio» (:387),
  «tampoco puede declararse cliente ni segmento de un acuerdo ajeno» (:400), «un precio de segmento NO
  se aplica a un comprador anonimo» (:328), «el navegador no puede declarar un precio en la cotizacion»
  (:512), «tampoco puede declarar canal, segmento ni cliente» (:519), y el bloque «el precio del acuerdo
  llega a quien lo firmo» (:787-853): anónimo, miembro activo, invitado, revocado, sin vínculo y la
  firma de la función pública sin sitio para una identidad.
- `supabase/tests/checkout-order.test.ts:337` — el precio que manda el cliente se rechaza.
- `supabase/tests/promotions-checkout.test.ts:407` — el payload no puede declarar campos de promoción.

## 4. Lo que H01 añade

- `src/features/storefront/commerce/audience.ts` — `CommerceAudience = 'consumer' | 'trade' | 'enterprise'`
  y `deriveCommerceAudience(señales | null)`. **Solo presentación.** La frontera trade/enterprise es de
  proceso: una cuenta con aprobación, orden de compra obligatoria, tope por persona, crédito con plazo o
  más de una sede es `enterprise`; sin ninguno de esos controles, `trade`. Ni un nombre de cliente,
  industria o tenant.
- `src/features/storefront/commerce/audience.test.ts` — clasificación y **barrido estático**: ningún
  archivo de `src/features/pricing`, `storefront/cart`, `storefront/checkout.ts` ni `supabase/functions`
  importa la audiencia; y `CHECKOUT_ALLOWED_FIELDS` no contiene `audience`, `business_account_id`,
  `customer_id`, `segment_id` ni `price_list_id`.
- `supabase/tests/commerce-audience-guard.test.ts` — `parseCheckoutBody` **rechaza** (no ignora) esos
  cinco campos en el cuerpo y en una línea, con `CAMPO_NO_PERMITIDO`.

## 5. Hallazgos (no corregidos en H01)

| # | Hallazgo | Riesgo | Decisión |
|---|---|---|---|
| A1 | **Elección de cuenta distinta entre cotización y pedido.** `pricing_actor` filtra por la sociedad de la tienda y elige la cuenta más antigua; el checkout (`_shared/checkout/dbPorts.ts:219-251`) toma `rows[0]` de `my_business_accounts()`, que **no** filtra por tenant y ordena por nombre. Con dos cuentas, la cotización y el pedido pueden usar clientes distintos; si la primera alfabética es de otro tenant, `create_order` responde `CUENTA_NO_APLICA`. | Medio, solo usuarios con varias cuentas | Se mantiene el comportamiento (instrucción H06). Demo con **una cuenta por usuario**. Follow-up: que el checkout use la misma regla que `pricing_actor`. |
| A2 | **Promociones dirigidas a cliente.** `promotion_quote_for_slug` evalúa con cliente/cuenta/correo nulos; `create_order` con los reales. Una promoción dirigida a un cliente puede no verse en el carrito y aplicarse al cobrar (o al revés). | Bajo-medio | Follow-up. No se toca el motor de promociones. |
| A3 | **Chip «Precio especial» para cualquiera.** `useQuotedCart.discounted` es `true` con cualquier línea `source='price_list'`, incluidas las listas de ámbito `store`; un anónimo con lista base lo ve. | Bajo (texto engañoso, no importe) | Se corrige en H05 como cambio **de presentación**: solo ámbitos `segment`/`customer`. |
| A4 | **El consumidor registrado no tiene nada suyo en el servidor salvo favoritos y avisos.** `orders` no guarda quién compró (ni `user_id` ni `customer_id`), no hay tabla de perfil y no hay libreta de direcciones del comprador. | Es el gap de H02–H04 | Diseño en H02. |
| A5 | **No hay registro de consumidores.** No existe pantalla de alta ni `signUp`; las cuentas las crea el backoffice (`create-user`). | Limita la demo B2C registrada | Fuera de alcance (tocar Auth). Documentado. |
| A6 | Sin selector de cuenta B2B. | — | No se construye (instrucción H06). |
