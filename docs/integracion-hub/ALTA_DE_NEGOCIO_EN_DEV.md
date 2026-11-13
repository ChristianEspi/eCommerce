# Dar de alta un negocio nuevo en DEV, paso a paso

> **Desde 2026-11-13 el alta se hace con un comando:** `node scripts/alta-negocio.mjs` (ver
> [`docs/operacion/ALTA_DE_TIENDAS.md`](../operacion/ALTA_DE_TIENDAS.md)). Esta guía queda como referencia de lo que
> hace por dentro y para ajustar los módulos de una sociedad (paso 5).

Guía para el operador del proyecto. Cubre lo único que hoy **no** tiene pantalla: crear la cuenta del
owner con su organización y activarle los módulos. Todo lo demás —usuarios, clientes, catálogo, marca— se
hace desde el admin de eCommerce.

> **Solo DEV.** Los pasos 1, 3 y 5 se ejecutan en el SQL Editor del panel de Supabase, que trabaja con
> privilegios de administrador y **se salta la RLS**. En producción esto lo hará el hub EBIM.
> No desactives RLS, no toques filas de otro negocio y no reutilices identificadores existentes.

Ejemplo usado abajo: negocio **Biel**, tienda `biel`, owner `owner@biel.pe`.

---

## Paso 1 · Generar los identificadores

Panel de Supabase → proyecto de eCommerce → **SQL Editor**:

```sql
select gen_random_uuid() as organization_id,
       gen_random_uuid() as company_id;
```

Guarda los dos uuid: son la **cuenta** (organización) y la **sociedad** (empresa) de Biel. Son los mismos
que se registrarán en el hub el día que se conecte, así que no se improvisan dos veces.

## Paso 2 · Crear la cuenta del owner

Panel → **Authentication → Users → Add user**:

- correo: `owner@biel.pe` (nunca `@ebim.pe`);
- contraseña: elige una y guárdala en tu gestor;
- marca **Auto Confirm User**, si no la cuenta espera un correo de confirmación que este proyecto todavía
  no envía.

## Paso 3 · Decirle a qué empresa pertenece

SQL Editor, sustituyendo los dos uuid del paso 1 y el correo:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
      'ebim_demo',      true,
      'org_id',         'PEGA-AQUI-EL-ORGANIZATION-ID',
      'companies',      jsonb_build_array(jsonb_build_object('id', 'PEGA-AQUI-EL-COMPANY-ID', 'role', 'owner')),
      'active_company', 'PEGA-AQUI-EL-COMPANY-ID',
      'apps',           jsonb_build_array('ecommerce')
    )
where email = lower('owner@biel.pe');
```

Esto es lo que en producción emitirá el hub. El interruptor `ebim_demo` es el que autoriza al hook de
DEV/QAS a poner esos datos en la sesión; sin él, el resto se ignora.

**Comprobación:**

```sql
select email, raw_app_meta_data from auth.users where email = lower('owner@biel.pe');
```

## Paso 4 · Crear el negocio desde la aplicación

1. Abre eCommerce e inicia sesión con `owner@biel.pe`. Si ya tenías sesión abierta, cierra y vuelve a
   entrar: los datos viajan en el token y el token se emite al entrar.
2. Al no tener negocio todavía, la app te lleva sola a **`/onboarding`**.
3. Rellena: nombre del negocio **Biel**, dirección de la tienda **`biel`**, moneda **PEN**.

Queda creado: el negocio, el owner y la tienda en estado borrador.

## Paso 5 · Ajustar los módulos, solo si hacen falta otros

**Desde la migración `20260926100000`, este paso es opcional.** El alta aplica un *paquete de
arranque* dentro de la misma transacción: los módulos que un negocio necesita para vender, las cuatro
capacidades de IA y la cuota de IA. El negocio entra funcionando, sin SQL.

El paquete lo declara `ebim.starter_entitlements()` y se cambia reemplazando esa función. Lo de abajo
sirve cuando **este** negocio concreto contrata algo distinto: la lista reemplaza a la anterior, así que
va completa, incluidos los códigos de IA si quieres conservarla.

```sql
select public.sync_platform_context(
  'PEGA-AQUI-EL-ORGANIZATION-ID'::uuid,
  'PEGA-AQUI-EL-COMPANY-ID'::uuid,
  true,                        -- la cuenta tiene eCommerce activo
  array[
    'ecommerce.catalog.advanced',
    'ecommerce.pricing.lists',
    'ecommerce.customers.b2b',
    'ecommerce.inventory.multiwarehouse',
    'ecommerce.orders.advanced',
    'ecommerce.payments',
    'ecommerce.promotions',
    'ecommerce.content.cms',
    'ecommerce.fulfillment',
    'ecommerce.analytics.advanced',
    'ecommerce.ai.assist',
    'ecommerce.ai.catalog.copy',
    'ecommerce.ai.insights',
    'ecommerce.ai.content'
  ]::text[],
  'provisioning'::public.entitlement_source,
  'demo'                       -- plan, informativo
);
```

- La lista **reemplaza** lo anterior: un módulo que quites aquí se apaga.
- `provisioning` significa «lo activó el operador», frente a `hub`. Cuando el hub responda, se sincroniza
  solo y estas filas se sustituyen.
- Para ver qué quedó activo: `/app/diagnostics` dentro de la app, o

```sql
select entitlement_code from public.tenant_entitlements
where company_id = 'PEGA-AQUI-EL-COMPANY-ID'::uuid order by 1;
```

Recarga la aplicación después; el menú lateral se arma con esto.

### La IA ya viene activa

Las cuatro capacidades de IA **no son de base**, pero el paquete de arranque las incluye, así que un
negocio dado de alta hoy entra con IA y con cuota mensual. Antes no era así: a `biel` le tocó la época
en la que había que activarla a mano, y nació sin un solo botón.

Dos casos en los que sí hay que tocarla. Si reemplazas la lista del paso 5, incluye los cuatro códigos o
la apagas. Y si la sociedad ya existía antes del paquete de arranque, dale cuota:

```sql
insert into public.ai_quotas (organization_id, company_id, plan, monthly_quota)
values ('PEGA-AQUI-EL-ORGANIZATION-ID'::uuid, 'PEGA-AQUI-EL-COMPANY-ID'::uuid, 'active', 2000)
on conflict (organization_id, company_id) do update
   set plan = excluded.plan, monthly_quota = excluded.monthly_quota;
```

La IA de cada módulo exige además **ese** módulo contratado: la de cobranza no existe sin
`ecommerce.credit.management`. El recorrido completo está en
[`FLUJO_COMPLETO_IA.md`](../demo/FLUJO_COMPLETO_IA.md).

## Paso 6 · Todo lo demás, ya sin SQL

Con el owner dentro:

1. **Configuración → Usuarios:** crear al administrador de Biel. El sistema devuelve una clave temporal
   que se muestra **una sola vez**. Roles disponibles: admin, catálogo, pedidos, viewer.
2. Entrar como ese administrador y montar el negocio:
   - **PIM:** marcas, familias, atributos (`talla` y `color` como ejes de variante) y unidades;
   - **Productos:** fichas, imágenes, variantes, precios;
   - **Clientes:** cuentas de empresa con sus compradores, aprobadores, sedes y reglas de aprobación;
   - **Configuración → Marca y Diseño:** logo, color, tipografía;
   - publicar la tienda pasándola de borrador a activa.
3. Los clientes B2C se registran solos en `/s/biel/register`.

---

## Errores frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| Tras entrar, la app dice que no tienes acceso | El token se emitió antes del paso 3 | Cierra sesión y vuelve a entrar |
| `/onboarding` responde `TENANT_YA_EXISTE` | Ese `organization_id` ya tiene negocio | Genera uuid nuevos; una organización = un negocio |
| Faltan secciones en el menú | Módulos sin activar | Paso 5 y recarga |
| El correo es `@ebim.pe` | Es el operador de la suite, no un actor de negocio | Usa un correo del negocio |

## Qué cambia cuando el hub esté conectado

Los pasos 1, 2, 3 y 5 desaparecen: la empresa, el usuario y los módulos se crean en el hub EBIM, y
eCommerce los recibe al iniciar sesión. Los pasos 4 y 6 se quedan igual.
