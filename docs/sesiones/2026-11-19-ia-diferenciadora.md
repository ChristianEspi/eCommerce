# Sesión 2026-11-19 — IA diferenciadora, Culqi y despliegues a QAS

Resumen para retomar el trabajo en otra PC. Todo lo de aquí está en `upstream` (`dcalagua/eCommerce`).

## Cómo retomar

```bash
git fetch upstream
git switch dev && git merge --ff-only upstream/dev   # dev = 9c9788a o posterior
npm install                                         # upstream trajo dependencias nuevas (@fontsource/archivo)
```

`.env` no está en git: copiarlo a mano. Lleva `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_DB_URL`, `EBIM_AI_API_KEY` y `SUPABASE_ACCESS_TOKEN`. Este último lo usa
`scripts/aplicar-migracion.mjs`.

Detalle técnico completo en `docs/STATE.md`, sección «IA diferenciadora — 8 frentes».

## Estado de las ramas al cerrar

| Rama | Commit | Qué tiene |
|---|---|---|
| `upstream/dev` | `9c9788a` | Todo lo de esta sesión |
| `upstream/qas` | `b89255d` | `dev` fusionado (merges «promoción de dev a qas») |
| QAS (Amplify) | `index-B3atXsOp.js` | Frontend publicado |

`origin` (fork `ChristianEspi/eCommerce`) **no** se actualizó: va atrasado frente a upstream.

## Lo que se hizo, en orden

1. **Ramas actualizadas** desde `upstream` (`dev` avanzó 199 commits).
2. **Explicaciones** (sin código): surtidos, canales de venta (hoy solo cuenta el canal por defecto),
   la banda «Productos en oferta» (sale del precio tachado de las listas de precios), el error
   «Cargar del catálogo» en inventario (se usa una sola vez por tienda; para stock nuevo, «Registrar
   movimiento → Entrada») y qué se puede integrar (API de socio, webhooks, fuentes de lectura).
3. **Culqi bloqueado al pagar con tarjeta**: faltaba `https://checkoutview.culqi.com` en `frame-src`
   de la CSP (`vite.config.ts`). Corregido (`102b1e9`) y desplegado.
4. **Comerza** (`D:\IA_EBIM\comerza`, POS de la suite): analizado, **no integrado**. Hace falta un
   puente (firmas y formatos distintos) y decidir quién emite el comprobante. Quedó en análisis.
5. **IA diferenciadora — 8 frentes** (`111d0e1` … `ae9ec8a`):

| Frente | Dónde se ve | Gasta créditos |
|---|---|---|
| Pedido desde foto/PDF/texto | Tienda → Pedido rápido → pestaña «Con IA» | 1 por lectura |
| Búsqueda por intención | Tienda → asistente ✨ | 1 extra solo si la búsqueda normal falla |
| Ficha desde documento del proveedor | Panel → Catálogo → Productos → Asistente de ficha | 2 |
| Acciones con aprobación | Panel → Sistema → «Acciones de la IA» (`/app/ai-actions`) | Aprobar no |
| Agenda del vendedor | Panel → Fuerza de ventas → «Agenda» | No |
| Resumen diario por correo | Panel → Configuración → «Resumen diario» | No |
| Impacto de campañas / valor de la IA | Promociones → «¿Funcionó?» · Diagnóstico → IA | No |
| Núcleo conversacional + MCP | Sin pantalla (no conectado) | — |

6. **Despliegue a QAS**:
   - Migraciones aplicadas con `scripts/aplicar-migracion.mjs`: `20261119120000_ai_intake`,
     `20261119140000_ai_action_proposals`, `20261119160000_ai_proactive` y `20261119180000_ai_value`.
   - Funciones desplegadas con `--use-api`: `order-intake` (nueva), `shopping-assistant` y `catalog-copy`.
7. **Candado sanitario del asistente** (`9f73525`): la respuesta no puede decir para qué sirve un
   medicamento, dosis, síntomas ni comparar precios. Salió de una respuesta real en QAS.
8. **Carga diferida que sobrevive a un despliegue** (`9c9788a`): el asistente daba «Failed to fetch
   dynamically imported module». Los 17 `lazy()` pasaron a `lazyPage` y un test impide volver atrás.

## Cosas que hay que saber (trampas)

- **No usar `supabase db push` contra QAS.** El historial remoto tiene 34 migraciones aplicadas sin
  registrar y hay dos archivos con la misma versión (`20261118120000`). El equipo aplica migraciones
  con `node scripts/aplicar-migracion.mjs supabase/migrations/<archivo>.sql` (API de gestión).
  Antes de aplicar, verificar dependencias con una consulta de solo lectura.
- **Funciones**: `npx -y supabase@2.117.0 functions deploy <nombre> --project-ref ehxlxbhtlmfgneiagdcj --use-api`
  (sin Docker). Respeta el `verify_jwt` de `supabase/config.toml`.
- **Proyecto Supabase de QAS**: `ehxlxbhtlmfgneiagdcj`. Tienda de pruebas: `/s/miquimica`.
- **Tests de BD** corren sobre PGlite (`npm test`); no necesitan Docker.
- **Invariantes que muerden** al crear tablas o funciones nuevas:
  - policies con `has_role_companies` en un `select`;
  - toda tabla con policy;
  - `select platform_lifecycle.ensure_guards();` al final de la migración;
  - registrar las funciones `ai_*` en `ai-metering.test.ts`;
  - sin consultas en componentes `.tsx`;
  - claves i18n en la mitad correcta del diccionario.
- **Productos**: la pertenencia a una tienda vive en `store_products`, no en `products.store_id`.

## Pendiente

1. **Créditos de IA de `miquimica`: agotados (25/25, plan de prueba sin fila en `ai_quotas`).**
   Mientras no se asigne `ecommerce.ai.credits` desde MasterAdmin, ninguna IA responde en QAS. Por
   eso el candado sanitario no se pudo ver funcionar con la IA real.
2. `miquimica` no tiene `ecommerce.ai.content` → no hay IA de reseñas ni promociones, ni «Proponer rechazo».
3. **Pesos por funcionalidad** en créditos: hoy todo cuesta 1, y leer una foto con Sonnet cuesta más
   que una búsqueda con Haiku. Definir antes de vender.
4. Enviar al buzón de la plataforma `docs/propuestas/2026-11-19-canal-whatsapp-comercio.md` y
   `docs/propuestas/2026-11-19-canal-mcp-agentes-de-compra.md`. La carpeta `EBIM-Plataforma` no estaba
   montada en G: ni H:.
5. Regenerar `database.types.ts` y poner `satisfies` a las constantes nuevas de `db-schema.ts`.
6. Reconciliar el historial de migraciones de QAS (decisión del equipo).
7. Mejoras fuera de alcance: generación de imágenes (sin proveedor) y frase de IA en el resumen diario.
8. Integración con Comerza: decidir comprobante, mapeo de locales y dónde vive el puente.

## Cómo probar cada mejora

Ver la guía de prueba al final de la conversación, resumida así:

- **Con IA**: escribir o subir una lista → revisar (lo dudoso sin marcar) → pasar al pedido → validar.
- **Asistente**: «algo para la tos de mi hijo» → busca por términos de catálogo, sin consejos de salud.
- **Ficha**: subir un PDF de ficha técnica → ver «Lo que leímos» → aplicar propuestas.
- **Acciones**: Inventario → «Proponer campaña de liquidación» → aprobar en la bandeja → campaña en borrador.
- **Agenda**: Fuerza de ventas → Agenda (clientes con 3 o más pedidos y atrasados según su ritmo).
- **Resumen diario**: activarlo con una hora ya pasada → llega en el minuto 5 de la hora siguiente.
- **Carga diferida**: DevTools → bloquear `*AssistantDrawer*` → debe recargar una vez y luego mostrar el error, sin bucle.
- Diagnóstico → IA → «Últimas consultas»: motivo de cada llamada (`sin_cuota`, `bloqueada`, `vacia`).
