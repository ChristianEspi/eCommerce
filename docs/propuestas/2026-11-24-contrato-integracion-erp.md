---
to: all
from: ecommerce
fecha: 2026-11-24
asunto: Contrato de integración ERP v1 — el estándar con el que cualquier ERP se conecta a eCommerce
tipo: declaración de canal (no cambia claims §2, jerarquía §3 ni Platform Context §5)
---

# Contrato de integración ERP v1

**[ecommerce] 2026-11-24**

Por el principio 5 («declara sus canales de integración») publicamos el estándar de integración de eCommerce con
sistemas de gestión. No es breaking: no toca identidad, claims, jerarquía ni la Platform Context API.

Documento completo: `docs/integrations/CONTRATO_INTEGRACION_v1.md` (repo eCommerce). Contrato máquina:
`GET {base}/v1/openapi.json`, generado desde la tabla de rutas que despacha.

## Qué cambia

La API `/v1` ya cubría leer pedidos, productos, stock y clientes, crear pedidos y cargar catálogo. Se agrega lo que
faltaba para que un ERP cierre el ciclo sin intervención manual:

| Ruta | Scope nuevo |
|---|---|
| `POST /v1/orders/{number}/status`: estado, pago, entrega y referencias del ERP | `order.update` |
| `POST /v1/customers:batch`: clientes por código, con el código del ERP | `customer.write` |
| `POST /v1/stock:batch`: saldo absoluto por almacén (solo almacenes con origen ERP) | `stock.write` |
| `POST /v1/price-lists/{code}/items:batch`: precios de una lista | `price.write` |
| `updated_since` + `server_time` en `GET /v1/orders · products · customers` | (sin cambio) |

Código de error nuevo: `409 ESTADO_EN_CONFLICTO`.

## Lo que interesa a las otras apps de la suite

1. **Gating**: todo va bajo el addon existente `ecommerce.integrations.enterprise`. No se pide entitlement nuevo al hub.
2. **Tenant**: la credencial pertenece a una sociedad (`organization_id` + `company_id` del hub). El cuerpo nunca
   lleva tenant; si lo trae, se rechaza.
3. **Vocabulario**: los scopes usan los mismos nombres que las operaciones canónicas (`order.update`, `stock.write`,
   `customer.write`, `price.write`). Si otra app de la suite (por ejemplo WMS para stock o eSupplier para precios de
   compra) quiere integrarse con eCommerce, **lo hace por este contrato** como cualquier ERP, con su propia credencial.
4. **WMS**: si WMS pasa a ser el sistema de registro del stock de una sociedad, el canal es `POST /v1/stock:batch`
   sobre almacenes marcados con origen ERP. No hace falta un canal privado.

## Pedido a las demás apps

Ninguno obligatorio. Si alguna app prevé empujar datos a eCommerce, que lo avise en el buzón para acordar los scopes.
