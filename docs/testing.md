# Testing

Run the regression suite with a supported Node.js version:

```sh
npm ci
npm test
```

The suite uses Node's test runner. PostgreSQL integration tests use PGlite with
an in-memory database; they do not read Supabase credentials, environment
variables, or production data.

## Full migration integration

`tests/sql-integration.test.mjs` creates the pre-migration application tables
from `tests/fixtures/application-baseline.sql`, applies the historical import
schema from `sql/`, and applies every SQL migration in filename order without
editing their contents. It provisions synthetic confirmed administrator and
viewer identities after the access foundation migration, before enforcement.

It then runs the existing regression scripts:

- `tests/atomic-workflows.sql`: failed-sale rollback, atomic order completion,
  idempotent sale and reconciliation retries, stale reconciliation rejection,
  and invalid actual-quantity rejection.
- `tests/workspace-improvements.sql`: stale/empty/unsupported order-line edit
  rejection, the summary view, audit snapshots, audit immutability and viewer
  restrictions.

Both scripts run inside rollback transactions. The integration test also checks
that application records and audit entries are absent afterward.

Run just this integration test with:

```sh
node --test tests/sql-integration.test.mjs
```

The baseline fixture models the columns, constraints and Auth/Storage surfaces
used by the application migrations. It is not a complete Supabase installation
or a production bootstrap. Existing migrations extend a pre-existing schema;
they are not sufficient to rebuild a production project from scratch. PGlite
tests do not validate hosted Auth email delivery, PostgREST configuration,
Storage service behavior or contention between independent database connections.

Keep these regression scripts local. They execute SQL writes before rollback
and must not be used as a production health probe.
