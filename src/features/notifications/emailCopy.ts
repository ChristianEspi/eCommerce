/**
 * El motor de los textos de correo, para la pantalla.
 *
 * Vive en `supabase/functions/_shared/notifications` porque es el MISMO que usa
 * el envío: así la vista previa es exactamente el correo que sale. Los
 * componentes lo importan desde aquí y no desde `supabase/`, que es la regla
 * de arquitectura (Supabase es persistencia, no vocabulario de la UI).
 */
export {
  defaultCopy,
  EDITABLE_KIND_LIST,
  resolveCopyFromParams,
  validateCopy,
  variablesOf,
  type CopyIssue,
  type CustomCopy,
} from '../../../supabase/functions/_shared/notifications/customCopy'
export { renderEmail } from '../../../supabase/functions/_shared/notifications/templates'
