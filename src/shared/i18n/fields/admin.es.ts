/**
 * Ayudas y errores de campo · admin (backoffice). Namespace `help.`.
 * Un archivo por módulo para que cada uno crezca sin pisar a los demás.
 */
export const fieldHelpEsAdmin = {
  // Configuración · Atención y datos legales
  'help.admin.contact.legalName':
    'El nombre legal con el que tu empresa está inscrita en SUNAT, tal como figura en la ficha RUC. Sale en el pie de la tienda y en el Libro de Reclamaciones.',
  'help.admin.contact.whatsapp':
    'El número al que te escriben los clientes desde el botón de WhatsApp. Con código de país, por ejemplo +51 987 654 321.',
  'help.admin.contact.note':
    'Una frase corta que aparece junto a los datos de atención. Ejemplo: «Respondemos en menos de 2 horas hábiles».',
  'help.admin.contact.socialUrl':
    'La dirección completa de tu perfil, empezando por https://. Ejemplo: https://www.instagram.com/mitienda',
  // Configuración · Identidad y correo
  'help.admin.settings.accentHex':
    'El color de tu marca en formato hexadecimal: # y seis caracteres (0–9, A–F). Ejemplo: #5AA97F. Se usa en botones y enlaces de la tienda.',
  'help.admin.settings.emailReplyTo':
    'Cuando un cliente responde a un correo de la tienda (la confirmación de un pedido, por ejemplo), la respuesta llega a esta dirección.',
  // Configuración · Portada
  'help.admin.home.maxItems':
    'Cuántos elementos muestra como máximo esta sección de la portada, entre 1 y 24. Vacío = lo que proponga el tema.',
  // Configuración · Cuotas
  'help.admin.installments.count':
    'En cuántas cuotas sin intereses permite pagar tu medio de pago, entre 2 y 36. La ficha del producto muestra el monto de cada cuota.',
  'help.admin.installments.provider':
    'El nombre del medio de pago que ofrece las cuotas, tal como lo reconoce el cliente. Ejemplo: Tarjeta Andes.',
  'help.admin.installments.min':
    'El precio a partir del cual se anuncian las cuotas. Déjalo vacío para anunciarlas en todos los productos.',
  // Configuración · Miembros
  'help.admin.members.email':
    'El correo de la persona a la que das acceso. Si aún no tiene cuenta, se te ofrece crearla con ese mismo correo.',
  // Configuración · Impuestos
  'help.admin.taxes.code':
    'Identificador interno de la categoría, sin espacios. Ejemplo: igv-general o exonerado. Una vez creada, no conviene cambiarlo.',
  'help.admin.taxes.rate':
    'El porcentaje del impuesto, de 0 a 100 con hasta dos decimales. Ejemplo: 18 para el IGV; 0 para productos exonerados.',
  // Canales de venta
  'help.channels.code':
    'Identificador corto del canal para integraciones e informes: minúsculas, números, guion o guion bajo. Ejemplo: mayoristas o tienda-lima.',
  // Integraciones
  'help.integrations.api.name':
    'Un nombre que te ayude a reconocer qué sistema usa esta credencial. Ejemplo: ERP central o App de vendedores.',
  'help.integrations.webhooks.url':
    'La dirección https pública de tu sistema que recibirá los avisos. Ejemplo: https://erp.miempresa.com/webhooks/ebim. No se aceptan direcciones locales ni privadas.',
  'help.integrations.sources.username':
    'El usuario que tu API acepta con autenticación básica. La contraseña va en el campo de abajo y se guarda cifrada.',
  'help.integrations.sources.clientId':
    'El identificador de cliente (client_id) que te dio el proveedor de la API al registrar la aplicación OAuth 2.0.',
  'help.integrations.sources.tokenUrl':
    'La dirección https donde se pide el token de acceso OAuth 2.0. Ejemplo: https://erp.miempresa.com/oauth/token',
  'help.integrations.sources.scope':
    'Los permisos (scopes) que se piden al obtener el token, separados por espacios. Déjalo vacío si tu API no los usa.',
  'help.integrations.sources.timeout':
    'Segundos que se espera la respuesta de tu API antes de darla por fallida, entre 5 y 60. Si tu ERP es lento, súbelo.',
  'help.integrations.sources.pageSize':
    'Cuántos registros se piden en cada llamada a tu API, entre 1 y 1000. Bájalo si tu ERP se demora o corta las respuestas grandes.',
  // Tiendas
  'help.stores.slug':
    'La parte de la dirección pública que identifica a la tienda: minúsculas, números y guiones. Ejemplo: mi-tienda → /s/mi-tienda.',
  'help.stores.domain':
    'Tu propio dominio, sin https:// ni barras. Ejemplo: tienda.midominio.com. Después tienes que apuntarlo en tu proveedor de dominio y verificarlo en Configuración.',
  // Alta del negocio
  'help.onboarding.storeSlug':
    'La dirección pública de tu tienda: minúsculas, números y guiones, entre 3 y 62 caracteres. Ejemplo: mi-tienda. Se propone sola a partir del nombre.',
} as const
