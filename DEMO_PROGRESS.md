# DEMO_PROGRESS — sprint de demo (miércoles)

Estado real, actualizado a medida que avanza. Prioridad del paquete:
**FLOW > DATA > AI > UI**.

| Workstream | Estado | Nota |
|---|---|---|
| FLOW (checkout + OMS) | **DONE** (núcleo P0) | Medio de pago capturado, enviado y verificado con tests |
| DATA (dataset y preflight) | RUNNING | Dataset ya existe y es rico; falta el preflight único |
| AI (Shopping Assistant) | PENDING | Terreno virgen: no hay nada de IA en el repo |
| UI (pulido del storefront) | PENDING | Inventario hecho, cinco debilidades localizadas |
| INTEGRACIÓN | PENDING | |
| GATES FINALES | PENDING | |

---

## FLOW — hecho

### El hueco que había, confirmado contra el código

El prompt maestro anticipaba que «el backend de checkout soporta
`payment_method_code`, pero el storefront puede no capturarlo». **Confirmado y
era exactamente así:**

- `supabase/functions/_shared/checkout/request.ts` tiene
  `optionalPaymentMethodCode()` y lo acepta desde P09.
- `public.public_payment_methods` existe como vista `security_invoker`
  (`supabase/migrations/20260828120000_payments_core.sql:944`), con GRANT a
  `anon`, y expone `code, kind, display_name, position, instructions` — sin
  proveedor ni configuración.
- **Nadie en `src/` la leía.** Cero coincidencias de `payment_method` en
  `src/features/storefront/`. El comprador no podía elegir cómo pagar.

El tenant de demo ya tenía los datos: 4 medios activos (Yape, transferencia,
efectivo, crédito empresa) y uno inactivo, todos con instrucciones.

### Qué se implementó

| Archivo | Cambio |
|---|---|
| `src/features/storefront/payment.ts` | **nuevo** · esquema, `fetchPaymentMethods`, `usePaymentMethods`, `defaultPaymentCode` |
| `src/features/storefront/components/PaymentPicker.tsx` | **nuevo** · selector accesible con icono por familia e instrucciones |
| `src/features/storefront/checkout.ts` | `paymentMethodCode` en el esquema; se envía `payment_method_code` |
| `src/features/storefront/StoreCheckoutPage.tsx` | carga de medios, preselección solo si es inequívoca, validación de forma, render |
| `src/features/storefront/StoreOrderPage.tsx` | la confirmación enseña medio e instrucciones |
| `src/shared/i18n/messages.{es,en}.ts` | 6 claves nuevas por idioma |
| `src/features/storefront/checkout-ui.test.tsx` | 4 tests nuevos |

### Decisiones que conviene no deshacer

1. **Se lee con el cliente ANÓNIMO de la vitrina, no con la sesión.** La policy
   de `anon` sobre `payment_methods` es `is_active AND tienda activa`; la de
   `authenticated` es `ebim.can_access(...)`, que es pertenencia al backoffice.
   Un comprador B2B con sesión no es miembro del backoffice de quien le vende:
   preguntar con su sesión devolvería **cero medios justo tras iniciar sesión**.

2. **Preselección solo con un único medio.** Con dos o más se deja en blanco:
   «pagar con lo que salía puesto» es una reclamación, no una venta.

3. **Sin medios configurados el checkout sigue vendiendo**, y ni siquiera viaja
   la clave. Un test lo fija.

4. **No se tocó el contrato del borde.** El nombre y las instrucciones que ve la
   confirmación salen de la misma vista pública que pintó el selector.

### Verificación

- `npm run typecheck` ✅ · `npm run lint` ✅
- `npx vitest run src/features/storefront/checkout-ui.test.tsx` → **35/35** ✅
  (4 nuevos: código enviado sin proveedor, bloqueo sin elegir, instrucciones
  antes de pedir, compatibilidad sin medios)

---

## Pendiente

- **DATA**: no existe preflight único; los seeds están sueltos y hay solape
  entre `seed-miquimica-catalog.mjs` y `seed-demo-catalog.mjs`.
- **AI**: sin infraestructura previa. Se reutilizará `catalog_search_for_slug`.
- **UI**: carrito y checkout usan `PageHeader` de backoffice y no los tokens
  `--sf-*`; el checkout no tiene sentido de progreso.

## Bloqueos conocidos (no del sprint)

- **QAS devuelve 404 en rutas profundas**: falta la reescritura de SPA en
  Amplify. Afecta a recargar y a enlaces compartidos. Es configuración de AWS,
  fuera del repositorio.
