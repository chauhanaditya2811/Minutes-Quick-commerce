-- Stock groups: several hostels can share one stock (e.g. every boys' hostel sells from one
-- shelf). Stock moves from per hostel to per group. Every existing hostel gets its own group
-- with the same id and name, so all current stock, holds and behaviour carry over unchanged.

-- CreateTable
CREATE TABLE "stock_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_groups_pkey" PRIMARY KEY ("id")
);

INSERT INTO "stock_groups" ("id", "name", "createdAt", "updatedAt")
SELECT "id", "name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "hostels";

-- Hostels: each belongs to one stock group (initially its own).
ALTER TABLE "hostels" ADD COLUMN "stockGroupId" TEXT;
UPDATE "hostels" SET "stockGroupId" = "id";
ALTER TABLE "hostels" ALTER COLUMN "stockGroupId" SET NOT NULL;
CREATE INDEX "hostels_stockGroupId_idx" ON "hostels"("stockGroupId");
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_stockGroupId_fkey" FOREIGN KEY ("stockGroupId") REFERENCES "stock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Product stock: keyed by stock group instead of hostel. Group ids equal the old hostel ids,
-- so renaming the column keeps every row pointing at the same stock.
ALTER TABLE "product_inventories" DROP CONSTRAINT "product_inventories_hostelId_fkey";
DROP INDEX "product_inventories_productId_hostelId_key";
DROP INDEX "product_inventories_hostelId_isAvailable_idx";
ALTER TABLE "product_inventories" RENAME COLUMN "hostelId" TO "stockGroupId";
CREATE UNIQUE INDEX "product_inventories_productId_stockGroupId_key" ON "product_inventories"("productId", "stockGroupId");
CREATE INDEX "product_inventories_stockGroupId_isAvailable_idx" ON "product_inventories"("stockGroupId", "isAvailable");
ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_stockGroupId_fkey" FOREIGN KEY ("stockGroupId") REFERENCES "stock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Holds: remember whose stock they took, so it goes back to the same group.
ALTER TABLE "inventory_reservations" ADD COLUMN "stockGroupId" TEXT;
UPDATE "inventory_reservations" SET "stockGroupId" = "hostelId" WHERE "hostelId" IS NOT NULL;
CREATE INDEX "inventory_reservations_stockGroupId_idx" ON "inventory_reservations"("stockGroupId");
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_stockGroupId_fkey" FOREIGN KEY ("stockGroupId") REFERENCES "stock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
