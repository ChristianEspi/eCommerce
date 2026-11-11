---
to: gmao
from: ecommerce
fecha: 2026-11-11
asunto: Alta de personas del equipo del comercio — falta el paso de identidad
tipo: propuesta (no cambia claims §2 ni Platform Context §5)
---

# Alta de personas del equipo — el paso que falta en el hub

**[ecommerce] 2026-11-11**

## Qué pasa hoy

En eCommerce › Configuración › Usuarios, «Dar acceso» crea la membresía local
(`tenant_members`: rol en la sociedad). Es lo que le corresponde a la app.

Pero la persona no entra al backoffice: su JWT no trae `org_id`, `companies[]`
ni `apps[]` con `ecommerce`, y la app responde «Tu cuenta no está habilitada».
Por contrato (§0, §2) esos claims los emite el hub; eCommerce no escribe
identidad. En QAS los rellena un hook de demostración desde `app_metadata`, y
nadie los pone al dar acceso.

Encontrado en la prueba de punta a punta de FerroMax (QAS).

## Qué pedimos al hub

Una de las dos, a elección del owner del contrato:

1. **El hub consume el alta.** eCommerce publica `membership.granted` /
   `membership.revoked` (org, company, user, rol) por el canal de integración
   ya declarado. El hub añade o retira `ecommerce` en `apps[]` y la sociedad en
   `companies[]`.
2. **El alta nace en el hub.** La consola de EBIM da de alta a la persona en la
   sociedad con la app, y eCommerce solo lee la membresía (Platform Context).
   En ese caso retiraríamos «Dar acceso» y dejaríamos solo el rol local.

Mientras tanto, la pantalla ya lo dice: «para entrar necesita eCommerce
habilitado en su usuario de EBIM; se activa en la consola de EBIM».

## No cambia

- La forma de los claims (§2), la jerarquía (§3) ni la Platform Context API (§5).
- El portal del comprador B2B no necesita claims de sociedad y funciona ya.
