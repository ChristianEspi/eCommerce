/**
 * Ayudas y errores de campo · catalog (backoffice). Namespace `help.`.
 * Un archivo por módulo para que cada uno crezca sin pisar a los demás.
 */
export const fieldHelpEsCatalog = {
  'help.catalog.sku':
    'Código interno del producto, único en la sociedad. Letras, números, guion, guion bajo, punto o barra, sin espacios. Ejemplo: POL-AZUL-M.',
  'help.catalog.slug':
    'Parte final de la dirección web: minúsculas, números y guiones, de 3 a 62 caracteres. Ejemplo: polo-algodon-azul.',
  'help.catalog.error.sku':
    'El SKU solo admite letras, números, guion, guion bajo, punto y barra, sin espacios.',
  'help.catalog.variantSku':
    'Código propio de esta variante, distinto del SKU del producto. Letras, números, guion, guion bajo, punto o barra, sin espacios. Ejemplo: POL-AZUL-M.',
  'help.catalog.barcode':
    'El número impreso bajo las barras (EAN, UPC o el código de tu proveedor), de 4 a 64 caracteres sin espacios. Ejemplo: 7751234567890.',
  'help.catalog.error.barcode':
    'El código de barras solo admite letras, números, guion, guion bajo y punto, sin espacios.',
  'help.catalog.entryCode':
    'Identificador interno: minúsculas, números, guion o guion bajo, sin espacios. Se propone a partir del nombre. Ejemplo: cuidado-personal.',
  'help.catalog.attributeCode':
    'Identificador interno del atributo: empieza con una letra y lleva minúsculas, números o guion bajo. Ejemplo: color_principal.',
  'help.catalog.attributeUnit':
    'Unidad en que se expresa el valor, si la tiene. Se muestra junto al dato en la ficha. Ejemplo: kg, cm, ml.',
  'help.catalog.uomCode':
    'Código corto de la unidad, hasta 16 caracteres: letras, números, guion o guion bajo. Ejemplo: CJA12.',
  'help.catalog.uomSymbol':
    'Abreviatura que verá el cliente junto al precio o la cantidad. Ejemplo: und, kg, caja.',
  'help.catalog.uomFactor':
    'Cuántas unidades base contiene esta unidad. Ejemplo: una caja de 12 botellas lleva factor 12. La unidad base siempre es 1.',
  'help.inventory.safetyStock':
    'Se descuenta de lo que la tienda puede vender. Ejemplo: con 100 en almacén y un colchón de 5, se ofrecen como máximo 95.',
  'help.inventory.reorderPoint':
    'Cuando lo disponible llega a esta cifra o baja de ella, el producto aparece en Alertas. Con 0 no avisa. Ejemplo: 10.',
  'help.inventory.warehouseCode':
    'Código corto del almacén, hasta 31 caracteres: letras, números, punto, guion o guion bajo, sin espacios. Ejemplo: ALM-LIMA01.',
  'help.inventory.staleMinutes':
    'Minutos sin una nueva sincronización del ERP tras los que la existencia copiada se considera desactualizada. Ejemplo: 90.',
  'help.inventory.priority':
    'Orden en que se usa este almacén para atender pedidos: el número menor va primero. De 0 a 9999. Ejemplo: 10.',
  'help.inventory.country':
    'Código ISO del país, de 2 letras. Ejemplo: PE para Perú.',
  'help.pricing.code':
    'Identificador interno de la lista: minúsculas, números, guion o guion bajo, sin espacios, hasta 41 caracteres. Ejemplo: mayoristas-2026.',
  'help.pricing.segmentCode':
    'Identificador interno del segmento: minúsculas, números, guion o guion bajo, sin espacios. Se propone a partir del nombre. Ejemplo: distribuidores.',
  'help.pricing.currency':
    'Código ISO de la moneda, de 3 letras. Ejemplo: PEN para soles o USD para dólares.',
  'help.pricing.priority':
    'Si dos listas del mismo alcance cubren el mismo producto, gana la de número más alto. De 0 a 1000. Ejemplo: 10.',
  'help.pricing.validFrom':
    'Fecha y hora desde la que la lista empieza a aplicarse. Antes de eso se cobra el precio de catálogo.',
  'help.pricing.validTo':
    'Fecha y hora en que la lista deja de aplicarse. Déjala vacía si no vence.',
  'help.pricing.minQuantity':
    'Precio por volumen: se aplica cuando la línea del pedido llega a esta cantidad, contada en unidades base. Ejemplo: con 12, rige desde 12 unidades.',
  'help.pricing.compareAt':
    'Precio anterior que la tienda muestra tachado junto al precio. Déjalo vacío si no es una oferta.',
} as const
