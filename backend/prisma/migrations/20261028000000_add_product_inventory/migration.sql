-- Hostel-wise inventory: one stock record per product and hostel.
-- Additive only. Legacy "products"."stock" is left untouched and no inventory
-- rows are created, so existing stock is never duplicated across hostels.
CREATE TABLE "product_inventories" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_inventories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_inventories_quantity_check" CHECK ("quantity" >= 0)
);

CREATE UNIQUE INDEX "product_inventories_productId_hostelId_key"
  ON "product_inventories"("productId", "hostelId");
CREATE INDEX "product_inventories_hostelId_isAvailable_idx"
  ON "product_inventories"("hostelId", "isAvailable");

ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_hostelId_fkey"
  FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Orders remember the store hostel they were placed against. Historical orders
-- stay NULL and keep their "customerHostel" name snapshot.
ALTER TABLE "orders" ADD COLUMN "hostelId" TEXT;
CREATE INDEX "orders_hostelId_idx" ON "orders"("hostelId");
ALTER TABLE "orders" ADD CONSTRAINT "orders_hostelId_fkey"
  FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
