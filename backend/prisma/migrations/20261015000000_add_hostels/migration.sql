-- Replace the legacy free-text user hostel value with a managed Hostel record.
CREATE TABLE "hostels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- Use deterministic IDs during backfill so a single statement can safely link users.
INSERT INTO "hostels" ("id", "name", "updatedAt")
SELECT 'legacy-' || md5(LOWER(TRIM("hostel"))), MIN(TRIM("hostel")), CURRENT_TIMESTAMP
FROM "users"
WHERE "hostel" IS NOT NULL AND TRIM("hostel") <> ''
GROUP BY LOWER(TRIM("hostel"));

CREATE UNIQUE INDEX "hostels_name_ci_unique" ON "hostels" (LOWER("name"));
CREATE UNIQUE INDEX "hostels_name_key" ON "hostels"("name");

ALTER TABLE "users" ADD COLUMN "hostelId" TEXT;
UPDATE "users" AS u
SET "hostelId" = h."id"
FROM "hostels" AS h
WHERE LOWER(TRIM(u."hostel")) = LOWER(h."name");

ALTER TABLE "users" DROP COLUMN "hostel";
ALTER TABLE "users" ADD CONSTRAINT "users_hostelId_fkey"
  FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "users_hostelId_idx" ON "users"("hostelId");
