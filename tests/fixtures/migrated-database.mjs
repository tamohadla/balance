import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);

/**
 * Apply unmodified repository migrations to an isolated, in-memory PostgreSQL.
 * The baseline represents the pre-migration application columns, not a complete
 * Supabase installation. No environment variables or remote credentials are read.
 */
export async function createMigratedDatabase() {
  const db = new PGlite();
  const applied = [];
  try {
    await db.exec(await readFile(new URL('application-baseline.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('sql/2026-04-12-import-batches.sql', root), 'utf8'));
    const migrations = (await readdir(new URL('supabase/migrations/', root)))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    for (const name of migrations) {
      try {
        await db.exec(await readFile(new URL(`supabase/migrations/${name}`, root), 'utf8'));
      } catch (cause) {
        throw new Error(`Local migration failed: ${name}`, { cause });
      }
      applied.push(name);
      if (name.endsWith('_app_access_foundation.sql')) {
        // The enforcement migration requires a verified active administrator.
        // All identities here are synthetic, never drawn from production.
        await db.exec(`
          insert into public.app_members(user_id, display_name, role, is_active)
          values
            ('11111111-1111-4111-8111-111111111111', 'Test administrator', 'admin', true),
            ('22222222-2222-4222-8222-222222222222', 'Test viewer', 'viewer', true);
        `);
      }
    }
    return { db, applied };
  } catch (error) {
    await db.close();
    throw error;
  }
}
