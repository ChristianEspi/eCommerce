# Pendiente: entrar a los canales de venta desde la tienda (2026-11-24)

> Nota de traspaso para seguir el trabajo en otra PC. Resume la conversación del 2026-11-24 sobre
> «Canales de venta» (backoffice `/app/channels`, tenant MiQuímica · sociedad Química Suiza).
> Nada de esto está implementado todavía: es diagnóstico y propuesta.

## La pregunta

En **Canales de venta** hay dos canales activos:

| Código | Nombre          | Tipo           | Acceso     | Catálogo           | Estado               |
|--------|-----------------|----------------|------------|--------------------|----------------------|
| `b2b`  | Tienda Privada  | B2B · comercial| Con sesión | Todo el catálogo   | Activo               |
| `b2c`  | Tienda pública  | B2C · minorista| Pública    | Todo el catálogo   | Por defecto · Activo |

¿Cómo se entra a cada uno?

## Respuesta corta

**Hoy solo se puede entrar al canal por defecto (`b2c`).** El canal `b2b` existe como dato y se
administra desde la pantalla, pero la vitrina no tiene ninguna puerta para entrar en él.

## Lo que se verificó en el código

- `ebim.public_channel(p_store_id)` — `supabase/migrations/20260828100100_cart_operations.sql` —
  devuelve **siempre** el canal `is_default and is_active` de la tienda. No recibe canal por
  parámetro ni lo lee de la URL.
- Todo el storefront se apoya en esa función o repite la misma consulta (`is_default and is_active`):
  carrito, `create_order` / checkout, precios, promociones, surtidos
  (`20261116120000_surtidos_en_toda_la_tienda.sql`), «Mis cupones»
  (`20261118120000_mis_cupones_consumidor.sql`), CMS (`20260828140100_cms_resolution.sql`).
- `orders.channel_id` lo decide el servidor; `channel_id` está en la lista negra del payload (bien:
  el canal nunca lo declara el cliente).
- CHECK `channels_auth_matches_kind`: `b2c` ⇒ sin sesión; `b2b`/`internal` ⇒ exigen sesión.
- **No marcar `b2b` como canal por defecto (estrella).** `public_channel` lanza
  `CANAL_NO_PUBLICO` si el canal por defecto exige sesión, y la vitrina pública se cae para todos.
- `docs/STATE.md` ya lo registra como **«R2 — Canales sin superficie»**. Después se hizo la pantalla
  de administración, pero no la parte de la vitrina.

## Qué se puede probar de B2B hoy

En la misma tienda pública (`/s/<slug>`, botón «Ver la tienda» del Resumen), iniciando sesión con
una cuenta de **cliente empresa**, ya funcionan:
- precios por lista y niveles por volumen;
- surtido del cliente;
- pedido rápido y pedidos programados.

Todo eso corre sobre el canal `b2c`. El canal `b2b` todavía no cambia nada en la vitrina.

## Propuesta (pendiente de aprobación del operador)

1. **Ruta propia del canal:** `/s/<slug>/c/<codigo-canal>` (p. ej. `/s/miquimica/c/b2b`). Exige
   sesión; el servidor valida que el comprador está habilitado para ese canal. Nunca se confía en el
   código de la URL sin esa validación.
2. **Canal asignado al cliente empresa.** Al iniciar sesión en la tienda normal, el comprador entra
   automáticamente a su canal; la URL directa queda para compartir.
   - Recomendación: **combinar 1 y 2**.
3. **Servidor (migración nueva e idempotente):** sustituir `ebim.public_channel(store)` por una
   resolución `canal efectivo = f(tienda, comprador verificado por current_buyer(), canal pedido)`
   en catálogo, precios, carrito, checkout, promociones, surtidos, cupones y CMS.
   - Regla: canal con `requires_auth` solo con comprador verificado y habilitado; si no, error claro
     (no caer en silencio al `b2c`).
   - `product_channels` ya filtra el catálogo por canal: reutilizarlo.
4. **Front:** el storefront lleva el canal activo en contexto (desde la ruta o el login), lo muestra
   en la barra de contexto comercial y redirige al login si el canal exige sesión.
5. **Tests obligatorios:**
   - aislamiento por tenant;
   - anónimo no ve ni compra en `b2b`;
   - comprador no habilitado no entra;
   - `orders.channel_id` correcto;
   - el canal por defecto sigue intacto.
   - En `routes.test.tsx`, la nueva ruta.

## Decisiones abiertas

- ¿Dónde se guarda la asignación cliente → canal? Opciones: columna en `customers`, tabla
  `customer_channels` (permite varios canales) o derivarla del segmento.
- ¿Un comprador con varios canales elige en un selector o entra al primero?
- ¿El canal `internal` (colaboradores) entra en esta misma fase?

## Para retomar

Abrir una sesión en `D:\IA_EBIM\eCommerce` (rama `dev`), leer este archivo y `docs/STATE.md`
(sección R2), y pedir: «implementa la entrada a canales según
`docs/PENDIENTE_CANALES_ENTRADA_B2B_2026-11-24.md`, opción 1 + 2».
