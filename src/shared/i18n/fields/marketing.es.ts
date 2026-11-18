/**
 * Ayudas y errores de campo · marketing (backoffice). Namespace `help.`.
 * Un archivo por módulo para que cada uno crezca sin pisar a los demás.
 */
export const fieldHelpEsMarketing = {
  // --- Promociones -----------------------------------------------------------
  'help.promotions.percent': 'Solo el número, sin el símbolo %. Ejemplo: 15 descuenta el 15 %.',
  'help.promotions.buyQuantity': 'Unidades que el cliente lleva para activar la oferta. En un 3x2 es 3.',
  'help.promotions.minQuantity':
    'Unidades mínimas en el carrito para que la campaña aplique. Vacío = sin mínimo.',
  'help.promotions.requiredQuantity':
    'Cuántas unidades de este producto tiene que llevar el combo. Ejemplo: 2.',
  'help.promotions.tierQuantity': 'Desde cuántas unidades rige este escalón. Ejemplo: 10.',
  'help.promotions.tierPercent': 'Descuento del escalón, solo el número. Ejemplo: 5 para un 5 %.',
  'help.promotions.couponCode':
    'Lo que el cliente escribe en el checkout: letras y números, de 3 a 64. Ejemplo: VERANO25.',
  'help.promotions.couponUsageLimit':
    'Cuántas veces se puede usar el cupón en total, sumando a todos los clientes. Vacío = sin tope.',
  'help.promotions.couponUsageLimitPerCustomer':
    'Cuántas veces puede usarlo un mismo cliente. Vacío = sin tope.',
  'help.promotions.giftCardAdjust':
    'Positivo suma saldo y negativo lo resta. Ejemplo: -20 quita 20 a la tarjeta.',
  'help.promotions.giftCardReason':
    'Obligatorio, de al menos 3 caracteres: queda en el libro mayor de la tarjeta.',

  // --- Contenido -------------------------------------------------------------
  'help.content.seoTitle':
    'El título que muestran Google y la pestaña del navegador. Vacío = se usa el título de la página.',
  'help.content.seoDescription':
    'El resumen bajo el enlace en los buscadores. Hasta 320 caracteres; lo ideal es entre 120 y 160.',
  'help.content.itemLimit': 'Cuántos productos enseña el bloque como máximo, de 1 a 48.',
  'help.content.synonymTerm':
    'La palabra que escribe el cliente en el buscador, de 2 a 60 caracteres. Ejemplo: celular.',
} as const
