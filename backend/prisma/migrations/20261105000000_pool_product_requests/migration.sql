-- Customers now shop per pool (stock group), so the product request board is per pool too.
-- Requests move from their hostel to that hostel's pool. When hostels in one pool requested the
-- same product, those requests merge into the oldest one: votes are combined (one per device)
-- and the strongest status wins (Hidden, then Added, then Open, then Archived). The midnight
-- reset bookkeeping moves from hostels to pools. Nothing else changes.

-- Reset bookkeeping: per pool.
ALTER TABLE "stock_groups" ADD COLUMN "requestsResetAt" TIMESTAMP(3);
UPDATE "stock_groups" AS g
SET "requestsResetAt" = h."last"
FROM (SELECT "stockGroupId", MAX("requestsResetAt") AS "last" FROM "hostels" GROUP BY "stockGroupId") AS h
WHERE g."id" = h."stockGroupId";
ALTER TABLE "hostels" DROP COLUMN "requestsResetAt";

-- Requests: point at the pool of their hostel.
ALTER TABLE "product_requests" ADD COLUMN "stockGroupId" TEXT;
UPDATE "product_requests" AS r SET "stockGroupId" = h."stockGroupId" FROM "hostels" AS h WHERE h."id" = r."hostelId";

-- Merge requests for the same product within a pool into the oldest one. (A plain temp
-- table: Prisma runs each statement separately, so ON COMMIT DROP would drop it at once.)
CREATE TEMP TABLE "request_merge" AS
SELECT "id",
       FIRST_VALUE("id") OVER (PARTITION BY "stockGroupId", "normalizedName" ORDER BY "createdAt", "id") AS "keeper"
FROM "product_requests";

UPDATE "product_requests" AS k
SET "status" = merged."status",
    "addedAt" = merged."addedAt",
    "archivedAt" = CASE WHEN merged."status" = 'ARCHIVED' THEN merged."archivedAt" END
FROM (
  SELECT m."keeper",
         (ARRAY_AGG(r."status" ORDER BY CASE r."status" WHEN 'HIDDEN' THEN 0 WHEN 'ADDED' THEN 1 WHEN 'OPEN' THEN 2 ELSE 3 END))[1] AS "status",
         MIN(r."addedAt") AS "addedAt",
         MAX(r."archivedAt") AS "archivedAt"
  FROM "request_merge" AS m JOIN "product_requests" AS r ON r."id" = m."id"
  GROUP BY m."keeper"
  HAVING COUNT(*) > 1
) AS merged
WHERE k."id" = merged."keeper";

-- Move votes to the kept request; a device that voted on several copies counts once.
INSERT INTO "product_request_votes" ("id", "requestId", "voterHash", "createdAt")
SELECT v."id" || '-merged', m."keeper", v."voterHash", v."createdAt"
FROM "product_request_votes" AS v
JOIN "request_merge" AS m ON m."id" = v."requestId"
WHERE m."id" <> m."keeper"
ON CONFLICT ("requestId", "voterHash") DO NOTHING;

DELETE FROM "product_requests" WHERE "id" IN (SELECT "id" FROM "request_merge" WHERE "id" <> "keeper");
DROP TABLE "request_merge";

UPDATE "product_requests" AS r
SET "voteCount" = (SELECT COUNT(*) FROM "product_request_votes" AS v WHERE v."requestId" = r."id");

-- Swap the hostel link for the pool link.
ALTER TABLE "product_requests" DROP CONSTRAINT "product_requests_hostelId_fkey";
DROP INDEX "product_requests_hostelId_normalizedName_key";
DROP INDEX "product_requests_hostelId_status_idx";
ALTER TABLE "product_requests" DROP COLUMN "hostelId";
ALTER TABLE "product_requests" ALTER COLUMN "stockGroupId" SET NOT NULL;
CREATE UNIQUE INDEX "product_requests_stockGroupId_normalizedName_key" ON "product_requests"("stockGroupId", "normalizedName");
CREATE INDEX "product_requests_stockGroupId_status_idx" ON "product_requests"("stockGroupId", "status");
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_stockGroupId_fkey" FOREIGN KEY ("stockGroupId") REFERENCES "stock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
