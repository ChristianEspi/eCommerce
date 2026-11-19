# Pruebas de flujos de compra en QAS — tienda `miquimica`

Fecha: 18/11/2026. Entorno: QAS (Supabase `ehxlxbhtlmfgneiagdcj`, rama `qas`).
Tienda: `/s/miquimica` (Química Suiza). El local de desarrollo también apunta a QAS.

Este documento resume la conversación sobre cómo probar los flujos de compra con
clientes B2C y B2B: usuarios, casos, qué esperar y qué se cambió para poder probarlo.

---

## 1. Usuarios de prueba

Contraseña de todos: `Demo2026!`

| Usuario | Rol | Para qué |
|---|---|---|
| `prueba.b2c@miquimica.demo` | Consumidor (B2C) | Compras con tarjeta y Yape, precios de catálogo. |
| `prueba.b2b@miquimica.demo` | Comprador (`buyer`) de **Distribuidora Prueba SAC** | Compras a crédito de empresa. |
| `emoreno` (owner de Química Suiza) | Dueño de la tienda (backoffice) | Confirmar Yape, despachar, cobrar créditos. |

Datos de la cuenta B2B:

- Cuenta `B2B-QA-01`, cliente `CLI-QA-01`, RUC ficticio válido `20990000019`, segmento clínicas.
- Línea de crédito **S/ 10,000 a 30 días**, sin aprobación previa ni orden de compra obligatoria.
- Sede «Almacén principal» — Av. Javier Prado Este 1234, Lima.

Cupón: **PRUEBA10** (promoción «Prueba QA 10%», `prueba-qa-10`)

- 10 % de descuento, vigente hasta el 31/12/2026, hasta 20 usos por cliente.
- Los cupones antiguos (`MIQ00x`, `ANDINO8`) ya vencieron. Policlínico Andino está bloqueado por mora: no usarlo.

> Si estos datos se pierden, se recrean con el script idempotente `datos_prueba_qa.sql`
> (estaba en el scratchpad de la sesión; no está versionado).

---

## 2. Medios de pago y entregas de la tienda

**Pagos:** tarjeta (pasarela en modo prueba), Yape (billetera), crédito empresa (solo B2B),
transferencia y contraentrega.

**Entregas:** envío estándar, envío express, recojo en tienda (Botica Miraflores o Botica San Isidro).

**Tarjeta de prueba:** `4111 1111 1111 1111`, CVV `123`, cualquier fecha futura.

---

## 3. Casos de prueba

| # | Usuario | Entrega | Pago | Cupón | Resultado esperado |
|---|---|---|---|---|---|
| 1 | B2C | Envío estándar | Tarjeta | PRUEBA10 | Pago aprobado al instante; pedido pagado con comprobante y 10 % de descuento. |
| 2 | B2C | Recojo — Botica Miraflores | Yape | — | Pedido «por confirmar». En backoffice *Pagos › Confirmar cobro* pasa a pagado. |
| 3 | B2B | Envío estándar | Crédito empresa | PRUEBA10 | Nace deuda a 30 días en *Crédito y cobranza*; la línea disponible baja. |
| 4 | B2B | Recojo — Botica San Isidro | Crédito empresa | — | Deuda nueva; al «Cobrar» en backoffice sale el recibo y la línea se libera. |
| 5 | B2B | Envío express | Yape | — | En *Tu cuenta › Estado de cuenta* aparece en «Pagos por confirmar», no como deuda. |

Qué revisar además en cada caso:

- **Comprador:** *Tu cuenta › Pedidos* (estado del pedido) y, para B2B, *Estado de cuenta*.
- **Backoffice (`emoreno`):** el pedido en *Pedidos*, el cobro en *Pagos*, la deuda en *Crédito y cobranza*.
- **Pendiente de confirmar en la prueba:** que el cupón se aplique también sobre los precios de
  la cuenta empresa (B2B). Si no se aplica, reportarlo.

---

## 4. Cambios hechos en esta sesión (ya en `dev` y `qas`)

- **Estado de cuenta — pagos por confirmar:** los pedidos pagados con Yape/transferencia aún sin
  confirmar se muestran aparte («Pagos por confirmar»), no mezclados con la deuda.
  Migración `20261118160000_statement_pending_payments.sql`.
- **Estado de cuenta por tienda:** cada tienda solo muestra las cuentas con SU vendedor
  (antes Distribuidora Andina, cliente de FerroMax, salía en `/s/miquimica`).
  Migración `20261118200000_statement_per_store.sql`.
- **Validación de todos los campos** (tienda y backoffice, ~400 campos): cada campo filtra por tipo
  de dato (RUC 11 dígitos, DNI 8, carné/pasaporte alfanumérico, teléfono, importe, porcentaje,
  código…), tiene máximo de caracteres y valida igual al guardar. Los campos que pueden generar
  dudas tienen un icono «i» con tooltip de ayuda.
- **Tipo de documento del cliente:** la ficha del cliente pide RUC / DNI / CE / pasaporte y valida
  el número según el tipo. Migración `20261118180000_customer_document_type.sql`.
- **RUC antiguos inválidos:** 13 de 15 RUC de ejemplo y el de Surtidora Andes no pasan el dígito
  verificador; un documento ya guardado no bloquea editar el resto, solo se valida si se cambia.

Las tres migraciones ya están aplicadas en QAS.

---

## 5. Pendientes conocidos (no bloquean las pruebas)

- Código de gift card: falta una regla propia (`[A-Z0-9]{12,40}`); hoy deja pasar `.`, `-` y `_`.
- Teléfono del libro de reclamaciones: no acepta guiones.
- Código postal: el máximo bajó de 20 a 10 caracteres.
- SKUs o códigos de barras guardados con espacios podrían bloquear la edición del producto.
