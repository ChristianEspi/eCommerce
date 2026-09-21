/**
 * Esquemas del lote de catálogo (`POST /v1/catalog/products:batch`) para el
 * documento OpenAPI generado.
 *
 * Salen de `docs/integrations/catalog-ingest.openapi.yaml`, el contrato que se
 * acordó y se probó contra un servidor simulado antes de implementar. La base
 * (`public.api_catalog_upsert`) es quien hace cumplir cada regla; esto solo la
 * describe para el socio.
 */
export const CATALOG_SCHEMAS: Record<string, Record<string, unknown>> = {
  CatalogMoney: {
    type: 'string',
    pattern: '^\\d{1,12}(\\.\\d{1,2})?$',
    description: 'Importe en cadena decimal, hasta 2 decimales. En la moneda de la tienda.',
    examples: ['101.90'],
  },
  CatalogGtin: {
    type: 'string',
    pattern: '^(\\d{8}|\\d{12,14})$',
    description: 'GS1 GTIN-8/12/13/14. El servidor verifica el dígito de control.',
    examples: ['7750000000014'],
  },
  CatalogSku: {
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description:
      'Identificador del artículo, único en la sociedad (productos y variantes comparten espacio).',
  },
  CatalogCode: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9_-]{0,40}$',
    description:
      'Código del vocabulario de la sociedad (marca, familia, atributo, valor, categoría).',
  },
  CatalogBatchRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['products'],
    properties: {
      products: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: {
          $ref: '#/components/schemas/CatalogProductInput',
        },
      },
    },
  },
  CatalogProductInput: {
    type: 'object',
    additionalProperties: false,
    required: ['sku'],
    description:
      'Producto MAESTRO de la sociedad. En el alta son obligatorios `name` y, si se\npublica, `price` en cada publicación. En la actualización, lo omitido no se toca.\n',
    properties: {
      sku: {
        $ref: '#/components/schemas/CatalogSku',
      },
      gtin: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogGtin',
          },
          {
            type: 'null',
          },
        ],
      },
      name: {
        type: 'string',
        minLength: 2,
        maxLength: 240,
      },
      description: {
        type: ['string', 'null'],
        maxLength: 8000,
      },
      kind: {
        type: 'string',
        enum: ['simple', 'variant'],
        description:
          'Solo en el alta. `variant` exige al menos una variante. Los kits se gestionan en el backoffice.',
      },
      brand_code: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogCode',
          },
          {
            type: 'null',
          },
        ],
      },
      family_code: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogCode',
          },
          {
            type: 'null',
          },
        ],
      },
      tax_category_code: {
        type: ['string', 'null'],
        description: 'Código de la categoría fiscal; `null` la quita.',
      },
      stock: {
        type: 'integer',
        minimum: 0,
        description:
          'Stock de catálogo del producto simple. Si la sociedad trabaja con almacenes, la disponibilidad sale del inventario.',
      },
      attributes: {
        type: 'object',
        description:
          'Ficha técnica, `{codigo_atributo: codigo_valor | texto | número}`. Solo atributos existentes.',
        additionalProperties: {
          type: ['string', 'number', 'boolean', 'null'],
        },
      },
      custom_fields: {
        type: 'object',
        description:
          'Datos libres del integrador (p. ej. código del ERP). Se fusionan con los existentes.',
        additionalProperties: true,
      },
      variants: {
        type: 'array',
        maxItems: 50,
        items: {
          $ref: '#/components/schemas/CatalogVariantInput',
        },
      },
      publications: {
        type: 'array',
        maxItems: 20,
        items: {
          $ref: '#/components/schemas/CatalogPublicationInput',
        },
      },
    },
  },
  CatalogVariantInput: {
    type: 'object',
    additionalProperties: false,
    required: ['sku'],
    properties: {
      sku: {
        $ref: '#/components/schemas/CatalogSku',
      },
      gtin: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogGtin',
          },
          {
            type: 'null',
          },
        ],
      },
      name: {
        type: 'string',
        maxLength: 240,
        description:
          'Si se omite en el alta, se compone con el nombre del producto y los valores de los ejes.',
      },
      axes: {
        type: 'object',
        description:
          'Ejes de la variante, `{codigo_atributo: codigo_valor}`. Atributos marcados como eje.',
        additionalProperties: {
          type: 'string',
        },
      },
      stock: {
        type: 'integer',
        minimum: 0,
      },
      active: {
        type: 'boolean',
      },
      prices: {
        type: 'array',
        description:
          'Precio propio de la variante POR TIENDA. Sin precio propio hereda el de la publicación.',
        items: {
          $ref: '#/components/schemas/CatalogVariantPrice',
        },
      },
    },
  },
  CatalogVariantPrice: {
    type: 'object',
    additionalProperties: false,
    required: ['store', 'price'],
    properties: {
      store: {
        type: 'string',
        description: 'Slug de la tienda.',
      },
      price: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogMoney',
          },
          {
            type: 'null',
          },
        ],
        description: '`null` borra el precio propio.',
      },
      compare_at_price: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogMoney',
          },
          {
            type: 'null',
          },
        ],
      },
    },
  },
  CatalogPublicationInput: {
    type: 'object',
    additionalProperties: false,
    required: ['store'],
    description:
      'Configuración del producto EN una tienda de la sociedad. Si no existía, se crea (exige `price`).',
    properties: {
      store: {
        type: 'string',
        description: 'Slug de la tienda.',
      },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]{0,120}$',
        description: 'Dirección en la vitrina. En el alta, si se omite, se deriva del nombre.',
      },
      category_slug: {
        type: ['string', 'null'],
        description: 'Categoría DE ESA tienda; `null` la quita.',
      },
      status: {
        type: 'string',
        enum: ['draft', 'published', 'archived'],
      },
      price: {
        $ref: '#/components/schemas/CatalogMoney',
      },
      compare_at_price: {
        oneOf: [
          {
            $ref: '#/components/schemas/CatalogMoney',
          },
          {
            type: 'null',
          },
        ],
      },
      currency: {
        type: 'string',
        pattern: '^[A-Z]{3}$',
        description:
          'ISO 4217. Opcional; si viene, tiene que coincidir con la moneda de la tienda.',
      },
    },
  },
  CatalogBatchReport: {
    type: 'object',
    required: ['dry_run', 'applied', 'summary', 'items'],
    properties: {
      dry_run: {
        type: 'boolean',
      },
      applied: {
        type: 'boolean',
      },
      summary: {
        type: 'object',
        required: ['received', 'created', 'updated', 'unchanged', 'rejected'],
        properties: {
          received: {
            type: 'integer',
          },
          created: {
            type: 'integer',
          },
          updated: {
            type: 'integer',
          },
          unchanged: {
            type: 'integer',
          },
          rejected: {
            type: 'integer',
          },
        },
      },
      items: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/CatalogItemResult',
        },
      },
    },
  },
  CatalogItemResult: {
    type: 'object',
    required: ['index', 'sku', 'status', 'errors'],
    properties: {
      index: {
        type: 'integer',
        description: 'Posición en `products`.',
      },
      sku: {
        type: 'string',
      },
      status: {
        type: 'string',
        enum: ['created', 'updated', 'unchanged', 'rejected'],
      },
      product_id: {
        type: ['string', 'null'],
        format: 'uuid',
        description: '`null` en simulación de un alta.',
      },
      publications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            store: {
              type: 'string',
            },
            status: {
              type: 'string',
              enum: ['created', 'updated', 'unchanged'],
            },
          },
        },
      },
      errors: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/CatalogRowError',
        },
      },
    },
  },
  CatalogRowError: {
    type: 'object',
    required: ['code', 'field', 'message'],
    properties: {
      code: {
        type: 'string',
        description: 'Código estable para ramificar.',
        examples: [
          'CAMPO_REQUERIDO',
          'VALOR_INVALIDO',
          'GTIN_INVALIDO',
          'GTIN_EN_OTRO_PRODUCTO',
          'SKU_DUPLICADO',
          'SKU_REPETIDO_EN_LOTE',
          'TIPO_DISTINTO',
          'MARCA_NO_ENCONTRADA',
          'FAMILIA_NO_ENCONTRADA',
          'ATRIBUTO_NO_ENCONTRADO',
          'VALOR_NO_ENCONTRADO',
          'NO_ES_EJE',
          'TIENDA_NO_ENCONTRADA',
          'CATEGORIA_NO_ENCONTRADA',
          'MONEDA_INCONSISTENTE',
          'SLUG_DUPLICADO',
          'CAMPO_NO_PERMITIDO',
          'SLUG_INVALIDO',
          'TIENDA_REPETIDA',
          'PUBLICACION_FALTANTE',
          'VARIANTE_DE_OTRO_PRODUCTO',
          'CATEGORIA_FISCAL_NO_ENCONTRADA',
          'ES_EJE',
          'MODULO_NO_CONTRATADO',
          'FORMATO_INVALIDO',
          'REFERENCIA_INVALIDA',
          'DUPLICADO',
          'ERROR_INTERNO',
        ],
      },
      field: {
        type: 'string',
        description: 'Ruta JSON del campo, p. ej. `products[3].publications[0].price`.',
      },
      message: {
        type: 'string',
      },
    },
  },
}
