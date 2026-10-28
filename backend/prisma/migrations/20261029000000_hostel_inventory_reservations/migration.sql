-- Automatic inventory reduction: tie reservations to the hostel whose stock they hold,
-- and flag paid orders that found less stock than ordered. Additive only.
ALTER TABLE "inventory_reservations" ADD COLUMN "hostelId" TEXT;
CREATE INDEX "inventory_reservations_orderId_status_idx" ON "inventory_reservations"("orderId", "status");
CREATE INDEX "inventory_reservations_hostelId_idx" ON "inventory_reservations"("hostelId");
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_hostelId_fkey"
  FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders" ADD COLUMN "inventoryShortfall" BOOLEAN NOT NULL DEFAULT false;
