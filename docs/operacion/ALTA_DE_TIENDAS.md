# Alta de tiendas: el procedimiento

Para el operador de QAS. Cuando alguien diga «crea una tienda nueva», este es el orden.

---

## 1. Primero: ¿qué te están pidiendo?

| Lo que piden | Qué es | Cómo se hace |
|---|---|---|
| «Un cliente nuevo quiere su tienda» | **Negocio nuevo**: cuenta + sociedad + dueño + primera tienda | Script `alta-negocio.mjs` (§3) |
| «Porta quiere una segunda tienda» | **Otra tienda** de un negocio que ya existe | El dueño, en el backoffice (§4) |
| «MiQuímica abre otra empresa (otro RUC)» | **Otra sociedad** en una cuenta existente | No lo hace el script: va por el hub. Consúltalo antes |

Regla de oro: **un cliente = una cuenta**. No metas la tienda de un cliente nuevo dentro de la cuenta de otro.

---

## 2. Convenciones (el orden)

| Dato | Regla | Ejemplo |
|---|---|---|
| Cuenta (`--cuenta`) | Razón social del cliente | `Ferretería Sol S.A.C.` |
| Tienda (`--tienda`) | Nombre que ve el comprador | `Ferretería Sol` |
| Dirección (`--slug`) | Minúsculas, números y guiones, sin tildes; queda en `/s/<slug>` | `ferreteria-sol` |
| Dueño (`--owner`) | Demo: `owner@<negocio>.demo`. Cliente real: su correo | `owner@ferreteriasol.demo` |
| Contraseña | Demo: la contraseña de suite, vía `ALTA_OWNER_PASSWORD`. Cliente real: aleatoria, se le entrega una vez | — |
| Moneda | La del país | `PEN`, `USD`, `BOB` |

Prohibido:

- Un correo **@ebim.pe** como dueño de un negocio (contrato de plataforma).
- Usar como dueño a alguien que ya pertenece a otra cuenta: **un usuario = una cuenta**. El script lo rechaza.

---

## 3. Negocio nuevo (script)

### 3.1 Ver lo que ya existe

```powershell
node scripts/alta-negocio.mjs --listar
```

### 3.2 Comprobar (no escribe nada)

```powershell
node scripts/alta-negocio.mjs --cuenta "Ferretería Sol S.A.C." --tienda "Ferretería Sol" `
  --slug ferreteria-sol --owner owner@ferreteriasol.demo --moneda PEN
```

Muestra el plan y comprueba lo siguiente: que la dirección esté libre, que la moneda exista y que el correo no pertenezca ya a otra cuenta. Si algo falla, dice qué y no hace nada.

### 3.3 Dar el alta

Es el mismo comando, más `--aplicar`. En demos, primero la contraseña de suite:

```powershell
$env:ALTA_OWNER_PASSWORD = '<contraseña de suite>'
node scripts/alta-negocio.mjs --cuenta "Ferretería Sol S.A.C." --tienda "Ferretería Sol" `
  --slug ferreteria-sol --owner owner@ferreteriasol.demo --moneda PEN --aplicar
Remove-Item Env:ALTA_OWNER_PASSWORD
```

Opciones:

- `--modulos arranque` (por defecto): el paquete con el que nace todo negocio. Incluye catálogo avanzado, precios, promociones, multialmacén, pagos, entregas, CMS, analítica, crédito, cotizaciones, fuerza de ventas e IA.
- `--modulos completo`: además B2B (cuentas de empresa), territorios, metas y comisiones, dominio propio, ruteo de entregas e integraciones enterprise.
- `--activar`: deja la tienda visible al público. **Sin esta opción nace en borrador**, que es lo recomendable: se activa cuando ya tiene productos con precio.

Lo que hace, en una sola transacción: cuenta, sociedad, dueño, tienda, ajustes y módulos. Si algo falla, no queda nada a medias.

> QAS es compartido: `--aplicar` solo cuando el alta esté pedida.

---

## 4. Otra tienda para un negocio que ya existe

1. Entra con el **dueño** de ese negocio.
2. **Tiendas** → **Nueva tienda**: nombre, dirección, moneda.
3. Con el selector de tienda (arriba), cámbiate a la nueva y sigue la lista del §5.

El catálogo de productos es de la **sociedad**: la tienda nueva ve los mismos productos, pero cada uno hay que **publicarlo** en ella con su precio.

---

## 5. Después del alta: la lista para dejarla vendiendo

Entra al backoffice como el dueño, con la tienda nueva elegida.

1. **Configuración**
   - **General**: datos de la tienda, contacto y datos legales (los usa el pie y el Libro de Reclamaciones).
   - **Marca**: logo y color.
   - **Apariencia** y **Diseño de tienda**: tema y portada.
   - **Impuestos**: revisa la categoría por defecto (IGV).
   - **Usuarios**: invita al equipo del cliente.
2. **Pagos**: activa los métodos de pago.
3. **Entregas**: métodos de envío o recojo y sus zonas.
4. **Inventario → almacenes**. Ojo: si la tienda tiene almacenes asignados, el stock que vale es el de **Inventario**, no el campo «Stock» del producto. Sin almacenes, vale el campo del producto.
5. **Catálogo**: crea los productos o impórtalos desde Excel (**Productos → Importar**), con sus categorías.
6. **Publicar**: en cada producto, pestaña **Tiendas** → precio y estado **Publicado**. Sin publicar, no se ve.
7. Opcional: **Promociones**, **Precios** (listas por segmento) y **Clientes**.
8. **Tiendas** → activa la tienda.
9. Verifica:
   - Abre `/s/<slug>` como visitante.
   - Revisa **Diagnóstico** en el backoffice, que muestra los módulos activos y lo que falta.

---

## 6. Mantener el orden

- `node scripts/alta-negocio.mjs --listar` muestra en un solo lugar todas las cuentas, sus dueños y sus tiendas.
- Pendientes de limpieza al 2026-11-13 (requieren decisión del operador):
  - **Empresa Enterprise Omega**: cuenta sin sociedad ni tienda.
  - **Biel**: tienda suspendida y sin dueño.
- Un módulo que falte después del alta (por ejemplo, territorios) se activa reemplazando la lista de módulos de la sociedad. Ver `docs/integracion-hub/ALTA_DE_NEGOCIO_EN_DEV.md`, paso 5. La lista **reemplaza**, así que debe ir completa.
