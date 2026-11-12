---
to: all
from: ecommerce
fecha: 2026-11-12
asunto: Canal de integración nuevo — fuentes de lectura (eCommerce consulta la API del ERP)
tipo: declaración de canal (no cambia claims §2, jerarquía §3 ni Platform Context §5)
---

# Fuentes de lectura: eCommerce consulta la API del ERP del cliente

**[ecommerce] 2026-11-12**

Por el principio 5 del contrato («declara sus canales de integración») dejamos
constancia de un canal nuevo. No es breaking: no toca identidad, claims,
jerarquía ni la Platform Context API.

## Qué es

Hasta hoy todo lo que entraba a eCommerce desde fuera lo **empujaba** el otro
sistema (API de socio `/v1`, webhooks de pago y transporte). Desde
`20261112120000_connector_sources.sql`, eCommerce también puede **ir a buscar**
datos a la API del ERP de un tenant, en intervalos, con un contrato estándar:

```
GET {base_url}{ruta}?limit=N[&updated_since=ISO-8601][&cursor=X]
200 application/json   { "data": [ ... ], "next_cursor": "X" | null }
```

- **Stock por almacén**: `{ sku, warehouse, on_hand, updated_at }` → saldo
  absoluto, solo en almacenes cuyo sistema de registro es el ERP.
- **Precios**: `{ sku, price, currency, min_quantity, compare_at_price, active,
  updated_at }` → una lista de precios elegida por el tenant.

Autenticación admitida: API key en cabecera, Bearer, Basic y OAuth 2.0
client_credentials.

## Lo que interesa a las otras apps de la suite

1. **Gating**: va bajo el addon ya existente `ecommerce.integrations.enterprise`
   (capacidad `integrations.enterprise`). No se pide entitlement nuevo.
2. **Credenciales**: se guardan en Supabase Vault del proyecto de eCommerce,
   por tenant; solo las descifra el trabajador (`service_role`). No viajan al
   hub ni a otra app.
3. **Salida de red**: el trabajador `connector-pull` llama solo a `https`
   público (CHECK en la base + comprobación en el trabajador, sin seguir
   redirecciones). Si otra app de la suite (p. ej. WMS) quiere ser FUENTE de
   eCommerce, basta con que exponga ese mismo formato: no hace falta un
   conector a medida.
4. **Sin cambio de catálogo de addons ni de claims.**

## Pendiente de nuestro lado

- Productos y clientes por este mismo canal (fase siguiente).
- Mapeo de campos configurable para APIs que no siguen el formato (nivel B).
