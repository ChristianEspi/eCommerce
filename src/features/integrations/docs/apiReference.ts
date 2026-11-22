/**
 * La referencia de la API de socio que pinta la guía pública `/api`.
 *
 * Módulo de datos, no componente: la UI no importa nada de Supabase
 * (`src/architecture.test.ts`). Aquí se juntan la tabla de rutas con la que
 * despacha el gateway, el contrato (permisos, errores, versión) y la URL base
 * del proyecto, y la página solo los consume.
 */
import { API_ERROR_CODES, API_ERROR_STATUS, API_SCOPES, API_VERSION } from '../../../../supabase/functions/_shared/api/contract.ts'
import { API_ROUTES, type ApiParam, type ApiRoute } from '../../../../supabase/functions/_shared/api/routes.ts'
import { SUPABASE_URL } from '@/shared/lib/env'

export { API_ERROR_CODES, API_ERROR_STATUS, API_ROUTES, API_SCOPES, API_VERSION }
export type { ApiParam, ApiRoute }

export const API_BASE = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/api`
export const OPENAPI_URL = `${API_BASE}/${API_VERSION}/openapi.json`
