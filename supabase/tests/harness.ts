/**
 * Banco de pruebas de RLS sobre Postgres REAL (PGlite, Postgres 18 en WASM).
 *
 * No simula policies: aplica las migraciones tal cual están en
 * `supabase/migrations` y consulta con `SET ROLE anon|authenticated` y los
 * claims del JWT en `request.jwt.claims`, que es exactamente el mecanismo que
 * usa Supabase. Si una policy está mal escrita, aquí falla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'migrations')

export type JwtClaims = {
  sub: string
  email: string
  org_id: string
  companies: Array<{ id: string; role: string }>
  active_company: string
  apps?: string[]
}

/**
 * Piezas que Supabase ya trae hechas y que las migraciones dan por existentes:
 * los roles, `auth.jwt()` y el esquema de Storage. Se recrean con la misma
 * semántica para que las migraciones se apliquen sin retocarlas.
 */
const SUPABASE_PRELUDE = `
  create role anon          nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role  nologin noinherit bypassrls;
  -- Rol del servicio de Auth de Supabase. Lo necesita el Custom Access Token
  -- Hook de DEV/QAS (migracion 20260827120000), que le concede EXECUTE: sin el
  -- rol, la migracion no aplica y el banco de pruebas no arranca.
  create role supabase_auth_admin nologin noinherit;

  create schema auth;

  -- La tabla de usuarios de Supabase, con lo justo que este proyecto mira.
  --
  -- No es decoración del banco de pruebas: hay funciones que traducen un correo
  -- a una identidad leyendo de aquí (dar de alta a alguien por su correo en vez
  -- de por un uuid que nadie tiene a mano). Sin esta tabla, esas migraciones no
  -- aplican y la suite entera se queda sin arrancar.
  --
  -- Sigue sin ser legible para \`authenticated\`, igual que en Supabase: quien
  -- la consulta lo hace desde una funcion \`security definer\` que ya comprobo
  -- quien pregunta.
  create table auth.users (
    id    uuid primary key,
    email text unique,
    created_at timestamptz not null default now()
  );

  create or replace function auth.jwt() returns jsonb
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  $$;
  grant usage on schema auth to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    created_at timestamptz not null default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.objects to anon;
  grant select on storage.buckets to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;
`

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export function readMigration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
}

/**
 * `pg_trgm` se pasa como extensión disponible, igual que en un proyecto
 * Supabase, donde está en la lista de extensiones instalables y vive en el
 * esquema `extensions`. La migración `20260828140300` la habilita con
 * `create extension if not exists`; sin declararla aquí, PGlite no la tiene
 * compilada y la migración no aplicaría — que es exactamente la señal que este
 * banco de pruebas tiene que dar si alguien usa una extensión que el proyecto
 * real no tendría.
 */
export async function createTestDatabase(options: { before?: string } = {}): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm } })
  await db.exec(SUPABASE_PRELUDE)
  await applyMigrations(db, { before: options.before })
  return db
}

/**
 * Aplica un TRAMO de migraciones, por prefijo de nombre de archivo.
 *
 * Existe para las migraciones que transforman datos: con
 * `createTestDatabase({ before: X })` se siembra la forma ANTIGUA y con
 * `applyMigrations(db, { from: X })` se aplica el resto, exactamente como
 * ocurre en una base que ya tenía datos. Sin opciones, todas.
 */
export async function applyMigrations(
  db: PGlite,
  options: { from?: string; before?: string } = {},
): Promise<void> {
  for (const file of migrationFiles()) {
    if (options.from && file < options.from) continue
    if (options.before && file >= options.before) continue
    try {
      await db.exec(readMigration(file))
    } catch (error) {
      throw new Error(`Migración ${file} falló: ${(error as Error).message}`)
    }
  }
}

/** Ejecuta como `anon` o `authenticated` con los claims dados, y siempre restaura. */
export async function asRole<T>(
  db: PGlite,
  role: 'anon' | 'authenticated' | 'service_role',
  claims: JwtClaims | null,
  run: (tx: PGlite) => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role};`)
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    claims ? JSON.stringify(claims) : '',
  ])
  try {
    return await run(db)
  } finally {
    await db.exec('reset role;')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

/** Captura el error de una consulta que DEBE fallar. */
export async function expectFailure(
  run: () => Promise<unknown>,
): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('Se esperaba un fallo y la operación tuvo éxito')
}

export const TENANT_A = {
  organizationId: '0a000000-0000-4000-8000-000000000001',
  companyId: '0a000000-0000-4000-8000-0000000000c1',
  ownerId: '0a000000-0000-4000-8000-0000000000a1',
  slug: 'tenant-a',
  storeSlug: 'tienda-a',
  adminEmail: 'admin@tenant-a.com',
}

export const TENANT_B = {
  organizationId: '0b000000-0000-4000-8000-000000000002',
  companyId: '0b000000-0000-4000-8000-0000000000c2',
  ownerId: '0b000000-0000-4000-8000-0000000000b2',
  slug: 'tenant-b',
  storeSlug: 'tienda-b',
  adminEmail: 'admin@tenant-b.com',
}

export function claimsFor(
  tenant: typeof TENANT_A,
  overrides: Partial<JwtClaims> = {},
): JwtClaims {
  return {
    sub: tenant.ownerId,
    email: tenant.adminEmail,
    org_id: tenant.organizationId,
    companies: [{ id: tenant.companyId, role: 'admin' }],
    active_company: tenant.companyId,
    apps: ['ecommerce'],
    ...overrides,
  }
}
