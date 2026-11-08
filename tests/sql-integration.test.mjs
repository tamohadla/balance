import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createMigratedDatabase } from './fixtures/migrated-database.mjs';

test('all migrations and SQL regression scripts run together in isolated PostgreSQL', async (t) => {
  const { db, applied } = await createMigratedDatabase();
  try {
    const expected = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    assert.deepEqual(applied, expected);

    for (const script of ['atomic-workflows.sql', 'workspace-improvements.sql']) {
      await t.test(script, async () => {
        // These are the existing rollback scripts, executed without replacing
        // functions, suppressing failures or requiring a running Supabase project.
        await db.exec(await readFile(new URL(script, import.meta.url), 'utf8'));
        assert.equal(
          (await db.query('select count(*)::int as count from public.items')).rows[0].count,
          0,
          'rollback script must leave no synthetic application records',
        );
        assert.equal(
          (await db.query('select count(*)::int as count from public.operation_events')).rows[0]
            .count,
          0,
          'rollback must include audit writes',
        );
      });
    }
  } finally {
    await db.close();
  }
});
