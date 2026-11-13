import type { ImportColumn, SheetSpec } from '@/features/catalog/import/columns'
import type { ExcelBook, ExcelFormat, Translate } from '@/shared/lib/excel'

/**
 * Las plantillas de importación de clientes y de usuarios B2B.
 *
 * Es la ÚNICA definición de columnas: de aquí salen la plantilla que se
 * descarga (con su hoja «Guía») y la lectura del Excel que se sube. Las claves
 * son las que acepta la función de la base (`import_customers`,
 * `import_business_account_users`); una clave que no está aquí la base la
 * rechaza para toda la carga.
 *
 * La validación es del servidor, en la misma transacción en la que escribe.
 * Aquí solo se decide qué columna es cada cabecera.
 */

interface ColumnDoc {
  readonly column: ImportColumn
  readonly description: string
  readonly format: ExcelFormat
  readonly width?: number
}

const text = (key: string, header: string, required = false): ImportColumn => ({ key, header, kind: 'text', required })
const number = (key: string, header: string): ImportColumn => ({ key, header, kind: 'number', required: false })
const flag = (key: string, header: string): ImportColumn => ({ key, header, kind: 'boolean', required: false })

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const CUSTOMER_DOCS: readonly ColumnDoc[] = [
  {
    column: text('code', 'Código', true),
    description:
      'Clave del cliente en esta tienda. Si ya existe, la fila ACTUALIZA ese cliente; si no, lo crea. Letras, números, punto, guion y guion bajo, sin espacios.',
    format: 'text',
    width: 16,
  },
  {
    column: text('kind', 'Tipo', true),
    description: '«Empresa» o «Persona». Obligatorio al crear.',
    format: 'text',
    width: 12,
  },
  {
    column: text('name', 'Nombre', true),
    description: 'Nombre comercial (empresa) o nombre y apellidos (persona). Obligatorio al crear.',
    format: 'text',
    width: 32,
  },
  {
    column: text('legal_name', 'Razón social'),
    description: 'Solo empresas, cuando difiere del nombre comercial. Es lo que sale en la factura.',
    format: 'text',
    width: 32,
  },
  {
    column: text('tax_id', 'Documento'),
    description: 'RUC de la empresa o DNI / carné de extranjería de la persona. Escríbelo como texto para no perder ceros.',
    format: 'text',
    width: 16,
  },
  { column: text('email', 'Correo'), description: 'Correo de contacto del cliente.', format: 'text', width: 28 },
  { column: text('phone', 'Teléfono'), description: 'Teléfono de contacto.', format: 'text', width: 16 },
  {
    column: text('segment', 'Segmento'),
    description:
      'Nombre o código de un segmento que ya exista (Precios → Segmentos), por ejemplo «Mayorista». Decide qué lista de precios le toca.',
    format: 'text',
    width: 20,
  },
  {
    column: flag('is_active', 'Activo'),
    description: '«Sí» o «No». Vacío al crear = Sí. Un cliente inactivo no puede comprar.',
    format: 'text',
    width: 10,
  },
  {
    column: text('erp_code', 'Código en ERP'),
    description:
      'Cómo se llama este cliente en tu ERP. Sirve para cruzar pedidos y facturas sin duplicar clientes. Solo lo pueden cargar owner y admin.',
    format: 'text',
    width: 18,
  },
  {
    column: text('erp_system', 'Sistema ERP'),
    description: 'Opcional: nombre corto del sistema, en minúsculas (por ejemplo «erp-central»). Vacío = «erp».',
    format: 'text',
    width: 14,
  },
  { column: text('notes', 'Notas'), description: 'Notas internas. No las ve el cliente.', format: 'text', width: 30 },
]

export const CUSTOMERS_SHEET: SheetSpec = {
  id: 'customers',
  name: 'Clientes',
  maxRows: 5000,
  requiredHeaders: [['code']],
  columns: CUSTOMER_DOCS.map((doc) => doc.column),
  examples: [
    {
      code: 'CLI-0001',
      kind: 'Empresa',
      name: 'Botica Central',
      legal_name: 'Botica Central S.A.C.',
      tax_id: '20123456789',
      email: 'compras@boticacentral.pe',
      phone: '014445566',
      segment: 'Mayorista',
      is_active: 'Sí',
      erp_code: 'C000123',
    },
    {
      code: 'CLI-0002',
      kind: 'Persona',
      name: 'Ana Ruiz Torres',
      tax_id: '45678912',
      email: 'ana.ruiz@correo.pe',
      phone: '987654321',
      is_active: 'Sí',
    },
  ],
}

// ---------------------------------------------------------------------------
// Usuarios de cuentas B2B
// ---------------------------------------------------------------------------

const ACCOUNT_CODE_DOC: ColumnDoc = {
  column: text('account_code', 'Cuenta B2B', true),
  description: 'Código de la cuenta B2B (por ejemplo B2B-004). Es la empresa a nombre de la que compra esta persona.',
  format: 'text',
  width: 14,
}

const USER_DOCS: readonly ColumnDoc[] = [
  {
    column: text('email', 'Correo', true),
    description:
      'Correo con el que la persona entra a la tienda. Si ya está en la cuenta, la fila la ACTUALIZA. Si todavía no tiene usuario, la revisión lo avisa y te ofrece crearlo.',
    format: 'text',
    width: 30,
  },
  {
    column: text('role', 'Rol'),
    description:
      '«Administrador» (gestiona la cuenta y compra), «Comprador», «Aprobador» (aprueba, no compra) u «Observador» (solo mira). Vacío al crear = Comprador.',
    format: 'text',
    width: 16,
  },
  {
    column: number('spending_limit', 'Límite de gasto'),
    description: 'Monto máximo por pedido de esta persona. Vacío = sin límite propio; manda el de la cuenta.',
    format: 'money',
    width: 16,
  },
  {
    column: text('status', 'Estado'),
    description:
      '«Activo» (puede comprar), «Invitado» (vinculado, pero SIN acceso hasta activarlo) o «Revocado». Vacío al crear = Activo.',
    format: 'text',
    width: 12,
  },
  {
    column: text('location_code', 'Sucursal'),
    description: 'Código o nombre de una sucursal de esa cuenta: su dirección de entrega por defecto. Opcional.',
    format: 'text',
    width: 16,
  },
]

/**
 * La hoja de usuarios. Desde la ficha de una cuenta la cuenta ya se sabe y la
 * columna «Cuenta B2B» sobra; desde la pestaña Cuentas B2B (`withAccount`) es
 * la que dice a qué empresa va cada persona.
 */
export function accountUsersSheet(withAccount: boolean): SheetSpec {
  const docs = withAccount ? [ACCOUNT_CODE_DOC, ...USER_DOCS] : USER_DOCS
  return {
    id: 'account_users',
    name: 'Usuarios',
    maxRows: 5000,
    requiredHeaders: withAccount ? [['account_code'], ['email']] : [['email']],
    columns: docs.map((doc) => doc.column),
    examples: [
      {
        ...(withAccount ? { account_code: 'B2B-004' } : {}),
        email: 'compras@boticacentral.pe',
        role: 'Administrador',
        status: 'Activo',
      },
      {
        ...(withAccount ? { account_code: 'B2B-004' } : {}),
        email: 'almacen@boticacentral.pe',
        role: 'Comprador',
        spending_limit: 1500,
        status: 'Activo',
        location_code: 'SEDE-SUR',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

const USER_POOL: readonly ColumnDoc[] = [ACCOUNT_CODE_DOC, ...USER_DOCS]

/** La documentación de cada columna de la hoja, en su orden. */
function docsOf(spec: SheetSpec): readonly ColumnDoc[] {
  if (spec.id === 'customers') return CUSTOMER_DOCS
  return USER_POOL.filter((doc) => spec.columns.some((column) => column.key === doc.column.key))
}

const COMMON_NOTES = [
  'Llena la hoja de datos a partir de la fila 2. Las filas de ejemplo bórralas o cámbialas por tus datos.',
  'Una celda vacía NO borra: al actualizar conserva lo que ya hay. Puedes subir solo la clave y las columnas que cambian.',
  'Primero se revisa todo el archivo y se te muestra qué se crea, qué se actualiza y qué falla. No se guarda nada hasta que pulses «Aplicar importación».',
  'Si una sola fila tiene error no se aplica ninguna: corrige el Excel y vuelve a subirlo.',
  'Las cabeceras tienen que quedarse como están. Las columnas que no reconozca se ignoran y se avisan.',
]

/** El libro de la plantilla: la «Guía» primero y la hoja de datos con ejemplos. */
export function templateBook(spec: SheetSpec, t: Translate): ExcelBook {
  const docs = docsOf(spec)
  const isCustomers = spec.id === 'customers'
  return {
    fileName: isCustomers ? 'plantilla-clientes' : 'plantilla-usuarios-b2b',
    template: true,
    guide: {
      title: isCustomers ? 'Plantilla de clientes' : 'Plantilla de usuarios de cuentas B2B',
      paragraphs: [
        isCustomers
          ? 'Una fila por cliente. La clave es el Código: si ya existe se actualiza, si no se crea.'
          : 'Una fila por persona y cuenta. La clave es el Correo: si ya está en la cuenta se actualiza, si no se vincula.',
        ...(isCustomers
          ? []
          : [
              'La cuenta B2B tiene que existir antes (Clientes → Cuentas B2B). Esta plantilla vincula personas a cuentas; no crea las cuentas.',
            ]),
        ...COMMON_NOTES,
        t('excel.guide.leadingZeros'),
      ],
    },
    sheets: [
      {
        name: spec.name,
        columns: docs.map((doc) => ({
          header: doc.column.header,
          description: doc.description,
          format: doc.format,
          required: doc.column.required,
          ...(doc.width ? { width: doc.width } : {}),
        })),
        rows: spec.examples.map((example) => docs.map((doc) => example[doc.column.key] ?? null)),
      },
    ],
  }
}
