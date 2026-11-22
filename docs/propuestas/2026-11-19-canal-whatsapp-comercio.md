---
to: all
from: ecommerce
fecha: 2026-11-19
asunto: Propuesta de canal nuevo — venta y atención por WhatsApp (comercio conversacional)
tipo: propuesta de canal (no cambia claims §2, jerarquía §3 ni Platform Context §5)
estado: enviada al buzón como 2026-11-22-ecommerce-002 (actualizada con shopping-chat); sin código de canal hasta respuesta
---

# Venta y atención por WhatsApp

**[ecommerce] 2026-11-19**

Por el principio 5 del contrato («declara sus canales de integración») pedimos
opinión antes de conectar nada. Comerza ya tiene trabajo de WhatsApp
(`comerza/docs/channels/WHATSAPP.md`); lo razonable es **un solo canal de
suite** y no dos integraciones con Meta.

## Qué haría eCommerce

Un cliente escribe al número de la tienda y puede:

1. **Buscar productos** de la tienda («¿tienen jarabe para la tos?»).
2. **Ver un producto** (disponibilidad y entrega; el precio lo pinta el canal
   desde la base, nunca lo escribe el modelo).
3. **Consultar el estado de su pedido.**
4. (Fase 2) **Armar un carrito** y recibir el enlace al checkout de la tienda.
   El pago y el comprobante siguen en el checkout oficial.

Todo es de **solo lectura** en la fase 1.

## Lo que ya está hecho (sin conectar)

`supabase/functions/_shared/commerceAgent.ts` y `commerceAgentTurn.ts`: el
núcleo conversacional agnóstico de canal. Tres herramientas de lista cerrada
sobre lo público de la tienda (`catalog_search_for_slug`,
`product_detail_for_slug`, `order_by_token`). El turno es: el modelo planifica,
la base ejecuta y el modelo redacta. La respuesta pasa por candados: sin
importes, sin contacto, y productos solo de la lista cerrada. Cuota y traza
pasan por el pipeline común (`ejecutarIA`). Tests en
`supabase/tests/commerce-agent.test.ts`.

## Lo que hay que decidir en la suite

| Tema | Propuesta de eCommerce |
|---|---|
| Dueño del canal | Un webhook de suite (WhatsApp Cloud API) que enruta por número a la app (eCommerce, Comerza). Un número = una sociedad = una app de destino. |
| Tenant | Sale del NÚMERO de WhatsApp registrado para la sociedad en el hub, nunca del mensaje. |
| Identidad del cliente | Fase 1: el estado de pedido pide número de pedido y código de seguimiento, igual que el enlace. Fase 2: vincular el teléfono a la cuenta del comprador con código de un solo uso. |
| Credenciales Meta | Token y secreto de app por sociedad en Vault; firma `X-Hub-Signature-256` verificada antes de nada. |
| Gating | Addon nuevo `ecommerce.channel.whatsapp` (o uno de suite si el canal es compartido). |
| Costo | Cada turno gasta 2 consultas de IA (plan + respuesta) de la cuota `ai.assist` de la sociedad, con su freno por tienda. |
| Datos personales | La conversación no se guarda entera: la traza de IA guarda extractos redactados, como hoy. |

## Pedido a GMAO / plataforma

1. ¿Canal de suite único o por app?
2. ¿Dónde se registra el número de WhatsApp de una sociedad (hub)?
3. Alta del addon.

Hasta la respuesta, eCommerce no publica ningún endpoint de WhatsApp.
