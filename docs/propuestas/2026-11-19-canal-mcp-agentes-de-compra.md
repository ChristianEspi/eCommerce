---
to: all
from: ecommerce
fecha: 2026-11-19
asunto: Propuesta de canal nuevo — servidor MCP de la tienda para agentes de compra con IA
tipo: propuesta de canal (no cambia claims §2, jerarquía §3 ni Platform Context §5)
estado: propuesta, sin endpoint publicado hasta respuesta
---

# La tienda, consultable por agentes de compra con IA (MCP)

**[ecommerce] 2026-11-19**

Cada vez más compras empiezan en un asistente de IA (ChatGPT, Claude, Gemini,
Perplexity), no en un buscador. Para que esos asistentes puedan **encontrar y
consultar** el catálogo de una tienda de la suite, proponemos exponer un
servidor **MCP** (Model Context Protocol) por tienda, de solo lectura.

## Qué expondría (fase 1, solo lectura)

Las mismas tres herramientas del núcleo conversacional, sin segunda
definición (`herramientasMcp()` en `supabase/functions/_shared/commerceAgent.ts`):

| Herramienta | Qué devuelve | De dónde |
|---|---|---|
| `buscar_productos` | Productos publicados: nombre, marca, precio público, disponibilidad (sí/no) | `catalog_search_for_slug` |
| `ver_producto` | Ficha pública | `product_detail_for_slug` |
| `estado_pedido` | Estado del pedido con número y token de seguimiento | `order_by_token` |

Todas con `readOnlyHint: true`. Ven exactamente lo que ve un visitante anónimo
de la vitrina: nada de SKU internos no publicados, costos, stock exacto ni
precios convenio B2B.

## Fase 2 (a decidir)

Crear un carrito y devolver el enlace al checkout oficial. **Nunca** cobrar
desde el agente: el pago sigue en el checkout de la tienda. Los protocolos de
pago entre agentes todavía se están definiendo; eCommerce no los adoptaría
hasta que haya uno estable.

## Lo que hay que decidir en la suite

| Tema | Propuesta de eCommerce |
|---|---|
| URL | `https://<tienda>/mcp` o `…/functions/v1/store-mcp?slug=`; el tenant sale del slug resuelto contra tiendas activas, como la vitrina. |
| Autenticación | Fase 1 pública (lo mismo que la vitrina), con freno por tienda e IP. Fase 2 con OAuth del comprador si se crean carritos. |
| Gating | Addon `ecommerce.channel.agents`: la tienda decide si quiere ser consultable por agentes. |
| Costo | Sin IA propia: el modelo es del agente externo. Solo coste de consultas; se aplica el freno público existente. |
| Descubrimiento | Publicar el servidor en la ficha de la tienda (por ejemplo, un enlace en el sitio). Se define con marketing de la suite. |

## Pedido a GMAO / plataforma

1. ¿Lo quiere la suite como capacidad común (también Comerza) o solo eCommerce?
2. Alta del addon.
3. Revisión de seguridad del endpoint público antes de publicarlo.

Hasta la respuesta, eCommerce no publica el endpoint MCP.
