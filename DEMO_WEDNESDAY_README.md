# Demo del miércoles — cómo levantarla y qué enseñar

Tienda de demo: **`miquimica`** · Proyecto Supabase: `ehxlxbhtlmfgneiagdcj`

---

## 1 · Antes de nada: comprobar que la demo está lista

```bash
node scripts/demo-preflight.mjs
```

Doce comprobaciones en el orden del guion. Mide **lo que la vitrina puede
pintar**, no si hay filas: usa `public_products`, que es la vista que ve el
comprador. Un producto sin precio en lista activa existe en `products` y no
existe para quien compra.

Si algo falla, el propio informe dice con qué script se arregla. Estado
verificado hoy: **las doce en verde** (570 productos pintables, 430 con foto,
61 rebajados, 3 métodos de entrega, 4 medios de pago, 9 promociones vigentes).

## 2 · Levantar

```bash
npm install
npm run dev          # http://localhost:5173
```

Vitrina: `/s/miquimica` · Backoffice: `/app/orders`

---

## 3 · El guion, de punta a punta

| # | Dónde | Qué se ve |
|---|---|---|
| 1 | `/app/categories` `/app/products` | Maestros: categoría, producto, imagen, precio, stock, publicación |
| 2 | `/s/miquimica` | Portada: categorías, ofertas, marcas |
| 3 | `/s/miquimica/product/<slug>` | **PDP**: precio dominante, reaseguro junto al botón |
| 4 | Añadir al carrito → `/s/miquimica/cart` | Carrito con su resumen |
| 5 | `/s/miquimica/checkout` | **Tres pasos**: Contacto · Entrega · Pago |
| 6 | — | Dirección, método de entrega, **medio de pago con sus instrucciones** |
| 7 | Confirmar | Número de pedido, medio de pago e instrucciones |
| 8 | `/app/orders` | El pedido recién hecho, con su estado |
| 9 | Abrir el pedido | Estado, pago, fulfillment, aprobación y timeline; transición desde ahí |

**Apunta el número de pedido en el paso 7**: el paso 8 depende de él y buscarlo
a ciegas delante del cliente rompe el ritmo.

### El asistente de compra

Botón flotante abajo a la derecha, en cualquier página de la tienda. Prueba con:

- «Protector solar por menos de S/ 60»
- «Algo para un botiquín de viaje»
- «Vitaminas con stock»

---

## 4 · Qué se implementó en este sprint

### FLOW (P0) — el hueco real del checkout

El borde aceptaba `payment_method_code` desde P09 y la vista pública
`public_payment_methods` existía con GRANT a `anon`, pero **nadie en `src/` la
leía**: el comprador no podía elegir cómo pagar y el dato quedaba sin capturar.

Ahora se elige, viaja al servidor y se ve en la confirmación con sus
instrucciones. Los datos ya estaban: 4 medios activos, todos con instrucciones.

La administración del pedido **no se tocó**: `order_transition`, la aprobación,
el timeline y los cuatro estados ya existían y funcionan (66 tests).

### DATA

`scripts/demo-preflight.mjs`. Verifica, no siembra: `seed-miquimica-catalog` y
`seed-demo-catalog` se solapan sobre la misma tienda, y a dos días de la demo no
es el momento de averiguar qué pasa al reejecutarlos.

### AI — asistente sobre catálogo real

`supabase/functions/shopping-assistant/`. Busca primero con
`catalog_search_for_slug`, y solo después el modelo elige y explica **dentro de
esa lista cerrada**.

La garantía de que no puede mentir sobre dinero no es pedirle que se porte bien:
es **no darle dónde escribirlo**. La función devuelve texto e identificadores —
nunca precio, stock ni moneda — y los identificadores se filtran contra la lista
de candidatos antes de salir. La vitrina resuelve cada producto contra el
catálogo y pinta las `ProductCard` de siempre.

### UI

Checkout numerado en tres pasos con los tokens de la vitrina; en la ficha, el
precio pasa a ser lo primero que se ve y hay reaseguro pegado al botón.

---

## 5 · Gates, con salida real de hoy

| Gate | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ |
| `npx vitest run` | ✅ **154 archivos · 2922 tests** |
| `npx vitest run supabase/tests` (DB/RLS) | ✅ **68 archivos · 1813 tests** |
| `node scripts/secret-scan.mjs` | ✅ sin hallazgos |
| `npm run build` | ✅ |

No hay E2E configurado en el repositorio; no se inventó ninguno.

---

## 6 · Problemas conocidos

### Bloqueantes si la demo es sobre QAS

1. **La función del asistente no está desplegada.** El código está en el
   repositorio pero el asistente no responderá en QAS hasta que se ejecute
   `supabase functions deploy shopping-assistant`. **No se desplegó porque el
   repositorio exige orden explícita del operador.** En local con `supabase
   functions serve` funciona.

2. **Rutas profundas dan 404 en QAS.** Falta la reescritura de SPA en Amplify.
   Navegando por la aplicación todo va bien; **recargar con F5 saca un 404**. Es
   configuración de AWS, fuera del repositorio.

### No bloqueantes

3. **Sin `EBIM_AI_API_KEY` el asistente responde en modo búsqueda.** No es un
   fallo: devuelve los resultados del catálogo y se pinta igual. Para activar la
   IA de verdad hay que añadir el secreto en Supabase. **Nunca en el frontend.**

4. **No se envía ningún correo.** No digas «le llega un correo de confirmación».

5. **No pulses «emitir» en comprobantes**: la emisión hacia el operador no está
   cableada, y la propia pantalla lo avisa.

6. Sin datos que enseñar: tareas dentro de una visita, pagos cobrados,
   presupuesto de promoción.

---

## 7 · Commits de este sprint

| SHA | Qué |
|---|---|
| `59edfea` | FLOW · el comprador ya puede elegir con qué paga |
| `054ecbd` | DATA · preflight que mide el golden path |
| `9761f4c` | AI · asistente de compra sobre el catálogo real |
| `40b6b62` | UI · checkout en tres pasos y ficha que vende |

Todo local, sin push: el repositorio exige orden explícita para publicar.
