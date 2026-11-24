# Encargo para una sesión de GMAO: dejar eCommerce listo en la consola del hub (2026-11-24)

> Copia todo lo que está debajo de la línea y pégalo en una sesión de Claude abierta en
> `D:\IA_EBIM\GMAO`, rama `dev`.

---

## Contexto

Trabajas en el repo de **GMAO**, que además es el **hub de identidad y plataforma de la suite EBIM**
(esquema `platform`, proyecto Supabase `xikbhkfeaosasdltartg`). Lee antes el `CLAUDE.md` de este repo.

La app **eCommerce by EBIM** (repo `D:\IA_EBIM\eCommerce`, proyecto Supabase `ehxlxbhtlmfgneiagdcj`) **ya
está dada de alta en el hub** por la migración `supabase/migrations/20260915120000_hub_alta_ecommerce_catalogo_y_miquimica.sql`
(commit `bbb5600`). Esa migración crea:
- la fila `ecommerce` en `platform.apps`;
- sus 24 `catalog_items`, con precio 0 y `available=false`;
- la organización MiQuímica (Demo) con la app activa y 22 addons.

Los identificadores de MiQuímica coinciden con eCommerce. Lo comprobé en QAS el 2026-11-24:
- organización `d0000000-0000-4000-8000-000000000001`
- sociedad `d0000000-0000-4000-8000-0000000000c1`

Una revisión de solo lectura de este repo (2026-11-24) encontró lo que falta para que eCommerce quede
utilizable desde la consola y un error de la consola. Este encargo es para cerrarlo.

## Reglas de esta tarea

- Commits **locales** en `dev`. **No push, no deploy, no escribir en la base remota** sin orden
  explícita del operador en esta sesión. Si algo hay que aplicarlo en vivo, prepáralo, enséñalo y pregunta.
- Cambios de esquema o datos **solo con migración nueva e idempotente**. No edites migraciones aplicadas.
- **No cambies la interfaz** de `platform-context`, `sso-issue` ni `platform-register`: otras apps
  dependen de ella.
- **Precios: 0 por ahora** (decisión del operador). No inventes planes, precios ni códigos.
- Varias funciones del hub **no tienen su cuerpo en git**: `provision_or_attach_tenant`, `provision_app`,
  `create_organization`, `operator_summary` y las de facturación. Antes de cambiar algo que dependa de
  ellas, **lee su definición vigente en la base (solo lectura, `pg_get_functiondef`)** y repórtala. No la
  reescribas a ciegas.
- Ningún secreto (`EBIM_SERVICE_SECRET`, `service_role`…) en archivos, commits ni en la respuesta.
- `dcalagua@ebim.pe` nunca como actor de negocio de un tenant.

## Tareas

### 1. Error: «Nuevo tenant» ignora el plan elegido
- **Síntoma:** el diálogo de `web/src/pages/TenantsPage.tsx` envía `plan_code` (alrededor de la línea
  302), pero la Edge `supabase/functions/tenant-provision/index.ts` no lo usa. El tenant queda con el plan
  por defecto, sea cual sea el elegido.
- **Arreglo esperado:** que la Edge aplique el plan elegido. Lo natural es la RPC `set_tenant_plan`
  después de `provision_or_attach_tenant`, si existe y hace eso; verifícalo en la base. El plan es un
  dato del body, así que valida que sea uno de `platform.plans` y responde 400 si no lo es.
- **Prueba:** test de la Edge (o del núcleo puro si lo separas): el plan llega y se aplica, y un plan
  desconocido se rechaza.

### 2. Addons de eCommerce: disponibles, con precio 0
- **Primero, solo lectura:** lista los `catalog_items` con `app_code = 'ecommerce'` (código, categoría,
  precio, `available`) y confirma que son los 24 de la migración `20260915120000`.
- **Después:** una migración nueva e idempotente que ponga `available = true` y `price_month = 0` en
  esos ítems y en la fila de `platform.apps`, si tiene su propio `available`. No toques otras apps.
- **Ojo con el gobierno comercial (CCP):** si `hub:ecommerce` está en `MASTERADMIN_AUTHORITY`, el hub
  congela addons y suscripciones de eCommerce (`20261010100000_ccp_commercial_authority.sql`,
  `20261010140000_ccp_hub_commercial_freeze.sql`). Comprueba su estado antes (sin fila = LEGACY) y
  repórtalo; si estuviera congelado, **para y pregunta**.

### 3. URL de eCommerce para el selector de apps
- `platform.apps.base_url` de `ecommerce` está **vacía a propósito**. Depende del entorno y se carga desde
  la consola: **Pagos → «Apps de la plataforma (URLs)»** (RPC `set_app_url`).
- **No la pongas en una migración.** Indícale al operador qué valor cargar en QAS:
  `https://qas.d1bk7wlkgx9eqm.amplifyapp.com`. Comprueba que `set_app_url` la valida (https, sin barra
  final) y, si no la valida, repórtalo. No lo arregles sin preguntar.

### 4. «Provisionar» y eCommerce (solo investigar y reportar)
- La revisión dedujo que el botón «Provisionar» (`OperatorDashboardPage.tsx` → RPC `provision_app`) **solo
  marca la app activa** y no llama al endpoint de aprovisionamiento de la app. Confírmalo leyendo la
  definición vigente de `provision_app` en la base.
- Contexto: en eCommerce, el tenant real (organización, sociedad y dueño) lo crea **EBIM MasterAdmin** por
  el contrato GENERIC v1 (Edge `platform-provisioning` de eCommerce, JWT ES256). Ver
  `D:\IA_EBIM\eCommerce\docs\platform-provisioning\MASTERADMIN_GENERIC_CONTRACT.md`.
- **No implementes** ninguna llamada nueva. Reporta si «Provisionar» debería disparar algo en eCommerce o
  si esa responsabilidad es de MasterAdmin, con la evidencia que encuentres en los docs de plataforma.

## Qué reportar al terminar

1. Commits creados (hash y mensaje) y archivos tocados.
2. Tarea 1: qué cambiaste y el resultado de los tests.
3. Tarea 2: la lista de los 24 ítems (antes y después) y el estado CCP de `hub:ecommerce`.
4. Tarea 3: si `set_app_url` valida la URL, y el valor exacto que debe cargar el operador.
5. Tarea 4: definición vigente de `provision_app` (resumen) y tu conclusión.
6. Qué queda pendiente de aplicar en vivo (migraciones, Edge) y el comando exacto, sin ejecutarlo.
