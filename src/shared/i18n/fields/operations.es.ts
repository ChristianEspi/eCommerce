/**
 * Ayudas y errores de campo · operations (backoffice). Namespace `help.`.
 * Un archivo por módulo para que cada uno crezca sin pisar a los demás.
 */
export const fieldHelpEsOperations = {
  // Despacho: red de entrega, puntos de recojo, hojas de ruta y entregas
  'help.fulfillment.methodCode':
    'Identifica el método en reportes e integraciones; el comprador no lo ve. Ejemplo: reparto-lima.',
  'help.fulfillment.zoneCode':
    'Identifica la zona en las tarifas y en los reportes. Ejemplo: lima-centro.',
  'help.fulfillment.pickupCode':
    'Identifica el punto de recojo en reportes e integraciones. Ejemplo: tienda-miraflores.',
  'help.fulfillment.leadDays':
    'Días que tarda el pedido en llegar desde que se confirma, de 0 a 365. El mínimo no puede pasar del máximo.',
  'help.fulfillment.baseAmount':
    'Lo que se cobra siempre por el envío, antes de sumar líneas o peso. Hasta dos decimales. Ejemplo: 10.00.',
  'help.fulfillment.perItemAmount':
    'Se suma una vez por cada línea del pedido. Déjalo en 0 si no cobras por línea.',
  'help.fulfillment.ratePriority':
    'Número de 0 a 9999. Si dos tarifas encajan con el mismo pedido, gana la de número menor.',
  'help.fulfillment.pickupPosition':
    'Orden en que aparece el punto en el checkout: el número menor sale primero.',
  'help.fulfillment.planCode':
    'Identifica la hoja de ruta ante el chofer y en los reportes. Ejemplo: RUTA-20261118-01.',
  'help.fulfillment.documentId':
    'DNI, carné de extranjería o pasaporte de quien recibe: de 6 a 15 letras o números, sin espacios.',
  'help.fulfillment.error.documentId': 'Escribe de 6 a 15 letras o números, sin espacios.',

  // Comercial B2B: surtidos y cotizaciones
  'help.trade.assortmentCode':
    'Identifica el surtido al asignarlo a clientes o importarlo. Ejemplo: SURT-FARMA.',
  'help.trade.quoteNumber':
    'Se propone uno automático; puedes reemplazarlo por el número de tu ERP. Sin espacios. Ejemplo: COT-20261118-103000.',
  'help.trade.currency': 'Código ISO de tres letras. Ejemplo: PEN o USD.',
  'help.trade.quantity':
    'Admite hasta tres decimales si el producto se vende fraccionado. Ejemplo: 2.5.',
  'help.trade.error.quoteNumber':
    'El número admite letras, números, punto, guion, guion bajo y barra, sin espacios.',

  // Fuerza de ventas: vendedores, territorios, rutas y metas
  'help.sales.repCode':
    'El código del vendedor en tu empresa o ERP; sirve para cruzar ventas y comisiones. Ejemplo: VEN-014.',
  'help.sales.territoryCode':
    'Identifica el territorio en metas y reportes. Ejemplo: LIM-NORTE.',
  'help.sales.routeCode': 'Identifica la ruta en la agenda del vendedor. Ejemplo: RUTA-LUN-01.',
  'help.sales.currency': 'Código ISO de tres letras de la moneda de la meta. Ejemplo: PEN.',
  'help.sales.target':
    'La cifra a alcanzar en el periodo, en la unidad de la métrica elegida: importe, unidades, pedidos o clientes.',
} as const
