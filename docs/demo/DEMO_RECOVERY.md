# Recuperación durante la demo

Regla general: **no depurar en vivo, no crear datos en vivo, no tocar código ni consolas.** Cambia de bloque, sigue
contando la historia y apunta el fallo para después (con hora, URL y rol).

La demo **nunca** depende de un único fixture o producto. Ten preparados siempre:

| Recurso | Principal | Alternativo |
|---|---|---|
| Producto | `<DATO_DEMO_POR_CONFIRMAR>` | `<DATO_DEMO_POR_CONFIRMAR>` (otro producto con stock y precio, validado por el preflight) |
| Recorrido B2C | invitado | consumidor registrado |
| Recorrido B2B | Enterprise | Trade (o Multi) |
| Evidencia visual de temas | vista previa en `/app/settings#design` | capturas en `docs/release-candidate/visual/` |
| Pedido para el backoffice | el recién creado | un pedido existente del mismo día (apunta su número antes de empezar) |

---

## Storefront no carga

1. Refrescar una vez (F5). Si hay pantalla en blanco, abrir `<HOST>/s/<slug>` desde la barra de direcciones.
2. Probar en la ventana de incógnito (descarta sesión/caché local).
3. Verificar QAS fuera de la vista del público: ¿responde `<HOST>/`? ¿otro navegador/red?
4. Fallback seguro: continuar con el **Bloque E (backoffice)** si el backoffice carga, o con las capturas de
   `docs/release-candidate/visual/` para narrar temas y audiencias.
5. No reiniciar despliegues ni tocar Amplify durante la presentación.

## Deep link da 404

Síntoma: navegar dentro de la app funciona, pero **recargar** `/s/<slug>/product/…`, `/cart`, `/checkout` o
`/account` da 404.

1. Volver a `<HOST>/s/<slug>` y navegar con clics (sin F5) hasta la pantalla.
2. Causa probable: falta la **reescritura de SPA** en Amplify (manifiesto §5). Ya se vio en QAS antes.
3. No compartir enlaces profundos durante la demo. Después: `QAS_BASE_URL=<HOST> npm run smoke:qas`.

## Login falla

1. No reintentar más de una vez delante del público.
2. Continuar con **B2C invitado** (Bloque B.1) — no necesita login y demuestra catálogo, promociones, checkout y pedido.
3. Usar la otra ventana ya logueada (por eso se preparan perfiles separados).
4. Si el login vuelve a la *Site URL* en vez de a la tienda: faltan las Redirect URLs de Auth (manifiesto §4).
   Entrar desde `/login` y navegar a `/s/<slug>` manualmente.

## Usuario Trade falla

(No aparece «Cuenta comercial», o no hay precio comercial.)

1. No explicar el fallo; pasar a **Consumer** (Bloque B) si aún no se hizo.
2. Después pasar a **Enterprise** (Bloque D), que demuestra el mismo motor de precio por cuenta.
3. Narrar la diferencia Trade con el Simulador de precios `/app/pricing#simulador` si el backoffice está disponible.

## Enterprise fixture falla

(Sin «Comprando para», sin convenio, selector sin dos cuentas, OC no exigida.)

1. **No crear cuentas, listas ni vínculos en vivo.**
2. Si Trade funcionó, apoyarse en lo ya mostrado (precio por cuenta).
3. Mostrar el **portal/backoffice existente**: `/app/customers#cuentas` (controles de la cuenta: OC, crédito,
   aprobación) y `/app/orders` con un pedido empresarial ya existente.
4. Multi-cuenta falla pero Enterprise simple funciona: omitir D2–D3 y seguir con D4.

## Pago externo falla

1. No hay pasarela de tarjeta real configurada (el método «Tarjeta de crédito o débito» del seed está inactivo:
   «Pendiente de conectar la pasarela»).
2. Usar **«Transferencia bancaria»** (manual, con instrucciones) o el medio manual configurado en QAS
   (`<DATO_DEMO_POR_CONFIRMAR>`).
3. Mensaje: «El pedido nace pendiente de pago; la conciliación se hace desde Pagos.»

## IA no responde

1. No insistir ni reformular varias veces.
2. Cerrar el panel del asistente y **continuar el flujo de compra**.
3. Contexto: sin `EBIM_AI_API_KEY` el asistente responde en **modo búsqueda** (productos sin frase de
   recomendación). Preguntas por concepto («algo para un botiquín de viaje») pueden volver vacías en ese modo:
   **no usarlas**. El asistente no es parte del guion principal.

## Producto sin stock

1. Usar el **producto alternativo** prevalidado (tabla de arriba).
2. No reponer stock en vivo.
3. Si el problema es el escalón de cantidad (precio comercial desde N unidades), subir la cantidad al mínimo indicado
   por el preflight.

## Otros

| Síntoma | Acción |
|---|---|
| Checkout: entrega «No disponible para tu dirección» | Revisar que el **País** esté relleno; si no, elegir recojo si existe |
| `422 ORDEN_COMPRA_REQUERIDA` / «Escribe el número de orden de compra» | Es el comportamiento esperado: teclear la OC |
| Backoffice: «transición no permitida» | Usar **pendiente → pagado** |
| Pantalla «no contratado» en un módulo del backoffice | Addon no activo para la sociedad: saltar esa pantalla |
| Error `429` al comprar varias veces | Limitador de checkout: esperar o seguir con otro rol/ventana |
| Precio cambió tras «Cambiar cuenta» | Esperado: se recotiza con la cuenta elegida |
| Se prometió un correo | No se envía correo transaccional verificado en QAS: no afirmarlo |

## Después de la demo

Registrar cada incidente (hora, rol, URL, captura) y tratarlo según [`FREEZE_POLICY.md`](FREEZE_POLICY.md).
