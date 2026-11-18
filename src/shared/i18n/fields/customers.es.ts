/**
 * Ayudas y errores de campo · customers (backoffice). Namespace `help.`.
 * Un archivo por módulo para que cada uno crezca sin pisar a los demás.
 */
export const fieldHelpEsCustomers = {
  // Clientes y cuentas B2B
  'help.customers.code':
    'Identificador interno, igual al de tu ERP si lo tienes. Letras, números, punto, guion o guion bajo, sin espacios. Ejemplo: CLI-020.',
  'help.customers.country': 'Código ISO del país, de dos letras. Ejemplo: PE para Perú, CL para Chile.',
  'help.customers.systemCode': 'El sistema que usa este identificador, en minúsculas. Ejemplo: erp, pos, marketplace.',
  'help.customers.externalId': 'El código con el que ese sistema conoce a este cliente. Ejemplo: C000123.',
  'help.customers.locationCode': 'Código corto de la sucursal, sin espacios. Ejemplo: LIM-01.',
  'help.customers.approvalThreshold':
    'Importe del pedido desde el que la compra necesita aprobación, en la moneda de la tienda. Ejemplo: 5000.',
  'help.customers.ruleMinAmount':
    'La regla se aplica a los pedidos desde este importe, con hasta dos decimales. Ejemplo: 10000.',
  'help.customers.simulateAmount':
    'Importe de un pedido de prueba para ver qué regla le tocaría. No se guarda nada.',
  'help.customers.creditLimit':
    'Lo máximo que la cuenta puede deber a la vez, sumando sus pedidos sin pagar. Ejemplo: 20000.',
  'help.customers.paymentTerms': 'Días que tiene el cliente para pagar cada pedido. Ejemplo: 30.',
  'help.customers.watchAfter':
    'Días de atraso en un pago tras los que la cuenta pasa sola a «En vigilancia». Ejemplo: 15.',
  'help.customers.blockAfter':
    'Días de atraso tras los que la cuenta se bloquea sola y no puede comprar. Debe ser mayor o igual que la vigilancia.',

  // Crédito y cobranza
  'help.credit.orderNumber': 'El número del pedido del que sale el comprobante. Ejemplo: EC-20261117-00046.',
  'help.credit.receiptNumber':
    'Letras, números y guiones, sin espacios. Si lo dejas vacío se pone el correlativo del día (RC-AAAAMMDD-001).',

  // Pedidos
  'help.orders.refSystem': 'El sistema donde existe este pedido, en minúsculas y sin espacios. Ejemplo: erp, contabilidad, marketplace.',
  'help.orders.refType': 'Qué documento es en ese sistema. Ejemplo: pedido, factura, guia.',
  'help.orders.refValue': 'El número o código con el que ese sistema identifica el pedido. Ejemplo: OV-004512.',

  // Pagos
  'help.payments.confirmReference':
    'El número que da el banco o la billetera al hacer la operación. Ejemplo: 00451287.',
  'help.payments.refundAmount':
    'Puedes devolver una parte o todo, pero nunca más de lo que queda cobrado. Hasta dos decimales.',
  'help.payments.code':
    'Identificador interno del medio, en minúsculas, sin espacios; no cambia después. Ejemplo: transferencia-bcp.',
  'help.payments.position': 'Orden en que aparece en el checkout: el número más bajo sale primero.',
  'help.payments.reconciliationPaste':
    'Pega las filas del reporte del proveedor separadas por punto y coma. Ejemplo: 2026-11-17;OP-1234;150.00;4.50;PEN',
} as const
