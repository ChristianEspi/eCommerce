/**
 * Migra la base de pruebas UNA vez por ejecución de Vitest y deja la
 * instantánea que carga `createTestDatabase()` (ver `harness.ts`).
 */
import { ensureMigratedSnapshot } from './harness'

export default async function setup(): Promise<void> {
  await ensureMigratedSnapshot()
}
