# Encargo para una sesión de eCommerce: entrar desde el hub con SSO (2026-11-24)

> Copia todo lo que está debajo de la línea y pégalo en una sesión de Claude abierta en
> `D:\IA_EBIM\eCommerce`, en la rama de trabajo habitual. Lo redactó la sesión de GMAO (hub) tras
> cerrar `PROMPT_GMAO_AJUSTES_2026-11-24.md`.

---

## Contexto

eCommerce by EBIM es una app de la suite. El **hub de identidad** es GMAO (proyecto Supabase
`xikbhkfeaosasdltartg`, esquema `platform`). Desde el 2026-11-24 el hub ya tiene:
- la fila `ecommerce` en `platform.apps` y sus 24 `catalog_items`, todos `available=true` y precio 0;
- MiQuímica (Demo) con eCommerce `active`: organización `d0000000-0000-4000-8000-000000000001`,
  sociedad `d0000000-0000-4000-8000-0000000000c1`;
- la URL de eCommerce en QAS (`https://qas.d1bk7wlkgx9eqm.amplifyapp.com`), que el operador carga en la
  consola. Sin ella, el selector de apps no tiene adónde llevar al usuario.

**Lo que falta en eCommerce:** recibir al usuario que llega del selector de apps del hub. Hoy no existe la
ruta `/sso`: `docs/architecture.md` la marca `[PENDIENTE]` y `src/features/auth/session.ts` ya lee los
claims del «Modo B», pero nadie los produce.

## Cómo emite el hub el token (Modo B), tal como está desplegado

Edge `sso-issue` del hub (`D:\IA_EBIM\GMAO\supabase\functions\sso-issue\index.ts`):
- La llama el usuario con su sesión del hub. El hub busca sus `platform.memberships`; si no tiene ninguna,
  responde 403.
- Firma un JWT **HS256** con el secreto compartido `EBIM_SSO_SECRET`. Dura **60 s** y lleva estos claims:
  `sub` (uid del usuario en el hub), `email`, `org_id`, `active_company`, `role` (de la membresía) y
  `app` (`"ecommerce"`), además de `exp`.
- Devuelve `redirect: "/sso?token=<jwt>&company=<company_id>"`. El selector del hub abre
  `base_url + redirect`, por ejemplo `https://qas…amplifyapp.com/sso?token=…&company=…`.
- Si `sso-issue` falla, el selector abre solo `base_url`. El usuario cae en el login normal de eCommerce.

## Reglas de esta tarea

- Commits **locales**. **No push, no deploy, no escribir en bases remotas** sin orden explícita del
  operador en esta sesión. Si algo hay que aplicarlo en vivo, prepáralo, enséñalo y pregunta.
- Cambios de esquema **solo con migración nueva e idempotente**.
- **No cambies la interfaz** de `platform-context` ni de `platform-provisioning`: dependen de ella el
  hub y MasterAdmin.
- Ningún secreto (`EBIM_SSO_SECRET`, `service_role`, clave de aprovisionamiento…) en archivos, commits ni
  en la respuesta. `EBIM_SSO_SECRET` lo carga el operador como secreto de la Edge. Es **el mismo valor**
  que tiene el hub; pídeselo al operador, no lo inventes.
- `dcalagua@ebim.pe`, y en general cualquier `@ebim.pe`, **nunca** como actor de negocio de un tenant. Es
  el operador de la plataforma; mantén el 400 del contrato §13.
- No alteres el camino de MasterAdmin (GENERIC v1, `platform-provisioning`). El SSO es **otra puerta de
  entrada**, no un reemplazo.

## Tareas

### 1. Edge `sso`: canjear el token del hub por una sesión de eCommerce
- Recibe `token` y `company`. Verifica:
  - firma HS256 con `EBIM_SSO_SECRET`; rechaza `alg` distinto, como `none` o RS256;
  - que `exp` no haya vencido, con un margen de reloj corto;
  - `app === "ecommerce"`;
  - `company === active_company`.
- **Un solo uso:** guarda el `jti` o el hash del token hasta que venza, para que no se pueda reutilizar.
  El hub hoy no emite `jti`; usa el hash del token.
- Resuelve el usuario local por `email`: créalo si no existe. Deja en `app_metadata` el `org_id`, el
  `company_id`, el `role` y `hub_sub`, que es lo que ya lee `sessionClaims()`. Luego emite la sesión de
  eCommerce (por ejemplo, `generateLink` y `verifyOtp`, o el mecanismo que ya use la app).
- Mensajes claros para: token vencido, firma inválida, app equivocada, usuario `@ebim.pe` y token
  reutilizado.
- **Pruebas:** como en `platform-provisioning`, con un núcleo puro y tests sin red. Cubre como mínimo:
  - token válido;
  - firma inválida;
  - token vencido;
  - `alg` none;
  - app distinta;
  - empresa que no coincide;
  - token reutilizado;
  - email `@ebim.pe`.

### 2. Ruta `/sso` en el front
- Lee `token` y `company` de la URL, llama a la Edge, guarda la sesión y redirige a `/app`. Limpia el
  token de la URL y del historial.
- Si falla, va a `/login` con el motivo.
- Prueba de la ruta en `routes.test.tsx`.

### 3. Primer ingreso de una organización que aún no existe en eCommerce
- Si el `org_id` del token no tiene tenant en eCommerce, **no lo crees a ciegas**:
  1. Consulta `platform-context` con el JWT del usuario para confirmar que el hub dice
     `app_active = true` para esa organización.
  2. Si es así y el `role` es `owner` o `admin`, reutiliza el camino ya existente de `bootstrap-tenant`
     (P03, «usuario que crea su propio espacio con su JWT del hub») para crear el tenant y la membresía
     owner. **No** crees tienda: el owner la crea con «Tiendas → Nueva», como dice
     `MASTERADMIN_GENERIC_CONTRACT.md` §1.
  3. Cualquier otro rol con organización inexistente debe recibir un mensaje claro: «Tu organización aún
     no tiene eCommerce; pide a tu administrador que entre primero».
- Si el tenant ya existe porque lo aprovisionó MasterAdmin: entra y aplica el rol de la membresía.
  Comprueba qué pasa con el owner PREPROVISIONED cuando llega por SSO con el mismo email. Debe quedar
  vinculado, no duplicado.

### 4. Documentación
- Actualiza `docs/architecture.md`: el `sso` deja de estar `[PENDIENTE]`. Explica cuándo entra un usuario
  por SSO y cuándo por MasterAdmin.

## Dependencia en el hub (GMAO), no la resuelvas desde aquí

Para que esto sirva con un cliente **creado desde la consola del hub**, el hub tiene que crear también la
organización, la sociedad y la membresía del administrador. Hoy:
- `platform.memberships` está vacía, así que `sso-issue` responde 403 a todos;
- «Nuevo tenant» solo crea `platform.tenants` y `tenant_users`.

Lo hará una sesión de GMAO aparte. Mientras tanto, prueba con MiQuímica creando su membresía en QAS
**solo si el operador lo autoriza**, o con tests.

## Qué reportar al terminar

1. Commits creados (hash y mensaje) y archivos tocados.
2. Tareas 1 y 2: el diseño del canje (cómo se emite la sesión) y el resultado de los tests.
3. Tarea 3: qué pasa en cada caso: organización nueva como owner, organización nueva con otro rol,
   tenant ya aprovisionado por MasterAdmin y owner PREPROVISIONED.
4. Qué queda pendiente de aplicar en vivo: la Edge, el secreto `EBIM_SSO_SECRET`, migraciones y el
   despliegue del front, con el comando exacto, sin ejecutarlo.
