# Inventory Reservation Backend Test Report

**Execution date:** 2026-10-09
**Test database:** `minutes_test`
**Development database:** `minutes` was not selected or modified.

## Database safety and migration history

Before recording migration history, the shared Prisma client ran
`SELECT current_database()` and returned `minutes_test`. Prisma migration
status showed both local migrations pending and no `_prisma_migrations` table.
The test database already contained the application tables and
`ReservationStatus` enum. A read-only
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
reported no difference between that database and the current Prisma schema.

Because the schema was already in the final shape, executing either migration
SQL would have collided with existing database objects. Instead, after the
database-name and schema-equivalence checks, the two migration records were
reconciled using `prisma migrate resolve --applied` against `minutes_test`.
This changed migration metadata only; **the migration SQL was not executed**.
Afterward `prisma migrate status` reported that the database schema is up to
date. No destructive database command was run.

## Migration review

### `20261008180552_init`

Creates the `PaymentStatus` and `OrderStatus` enums; the users, products,
orders, order-items, payments, payment-attempts, inventory-reservations, and
settings tables; the declared unique and lookup indexes; and foreign keys.
The foreign keys restrict user/product deletion, cascade order-item deletion
from orders, and set nullable order references to null on deletion.

- The SQL contains no explicit `DROP` or row-update statement, so it does not
  intentionally discard existing row data.
- It is a create-only migration without existence guards. Applying it to a
  database whose schema was already created by `db push` would fail on
  duplicate types/tables/indexes rather than safely adopting those objects.
- Unique-index creation can fail if existing rows contain duplicate values;
  foreign-key creation can fail if existing rows contain orphan references.
- `createdAt` columns with defaults receive the database current time for
  subsequently inserted rows. Required `updatedAt` columns have no SQL
  default; inserts must provide them. No existing-row timestamp backfill is
  part of this fresh-schema migration.

### `20261009163708_add_reservation_status`

Creates the `ReservationStatus` enum; drops the old reservation `productId`
and `expiresAt` indexes; adds non-null `status` (default `ACTIVE`) and
non-null `updatedAt` (temporarily defaulted to `CURRENT_TIMESTAMP`); maps
legacy `consumed = true` to `CONSUMED` and `false` to `ACTIVE`; drops the
legacy `consumed` column and the temporary `updatedAt` default; then creates
indexes on `(productId, status)`, `(status, expiresAt)`, and `orderId`.

- The migration preserves the legacy consumed distinction in `status` before
  removing the boolean column. The old boolean representation itself is
  discarded, but its value is represented by the new enum.
- Legacy rows with `consumed = false` become `ACTIVE` even if their expiration
  time is in the past; the expiration cleanup job must subsequently process
  them.
- Existing rows receive the migration-time value for `updatedAt`. This is a
  required timestamp backfill, but it cannot reconstruct a historical update
  time. The default is removed afterward so future writes must supply the
  value (Prisma does so).
- The migration is not idempotent. A partial failure may leave created types,
  removed indexes, or added columns, and a blind retry could fail. Inspect
  database state before retrying a partially completed execution.
- This migration's SQL was reviewed but **was not executed** in this run;
  existing test schema already matched the Prisma datamodel.

## Automated PostgreSQL integration results

`npm test` â€” **PASS**, 1 test file, 11 tests passed.

Each inventory suite verifies `current_database() = 'minutes_test'` before
creating its test records. The shared client selects `TEST_DATABASE_URL` in
Vitest's `NODE_ENV=test` process. Records use unique IDs and cleanup is scoped
to records created by the tests.

| Scenario | Result |
|---|---|
| Reserve stock and create an active reservation | PASS |
| Reject invalid quantity and insufficient stock without changing stock | PASS |
| Two concurrent requests compete for the last unit; only one reserves it | PASS |
| Aggregate duplicate product lines into one reservation | PASS |
| Roll back all stock changes when one item in a multi-product reservation is unavailable | PASS |
| Reject reservation of a soft-deleted product | PASS |
| Restore stock once on release; reject duplicate release | PASS |
| Consume an active reservation without restoring stock | PASS |
| Reject consumption of an expired reservation | PASS |
| Reject duplicate consumption without restoring stock again | PASS |
| Expire an overdue reservation and restore stock once; repeated expiry is a no-op | PASS |

## Other checks

| Command | Result |
|---|---|
| `npx prisma migrate diff --exit-code --from-config-datasource --to-schema prisma/schema.prisma` | PASS â€” no difference detected |
| `npx prisma migrate status` after history reconciliation | PASS â€” schema up to date |
| `npx prisma validate` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS â€” 11/11 |

## Final review verification

Re-run on 2026-10-09 before commit preparation:

| Command | Actual result |
|---|---|
| `npm test` | PASS â€” 1 test file, 11 tests passed |
| `npm run build` | PASS |
| `npx prisma validate` | PASS |
| `PRISMA_USE_TEST_DATABASE=true npx prisma migrate status` | PASS â€” datasource reported `minutes_test`; 2 migrations found; database schema up to date |
| `git diff --check` | PASS |

No migration SQL was executed during final review. The tests' database identity
guard passed as part of the test run. No files were staged, and no commit or
push was made.

## Not run

- Migration SQL execution and legacy-row backfill behavior: **NOT RUN**. The
  database already had the target schema; migration history was reconciled
  instead of reapplying conflicting DDL.
- Fresh-database migration testing on an empty PostgreSQL database: **NOT RUN**.
- Legacy-schema migration testing, including the consumed/timestamp backfill:
  **NOT RUN**.
- Additional concurrency races between consume, release, and expiry workers:
  **NOT RUN**.
- Application/API-level ordering, checkout, and payment flows: **NOT RUN** and
  outside this inventory-service test scope.
