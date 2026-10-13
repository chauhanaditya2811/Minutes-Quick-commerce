-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- DropIndex
DROP INDEX "inventory_reservations_expiresAt_idx";

-- DropIndex
DROP INDEX "inventory_reservations_productId_idx";

-- AlterTable
ALTER TABLE "inventory_reservations"
ADD COLUMN     "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve consumed reservations when converting from the legacy boolean.
UPDATE "inventory_reservations"
SET "status" = CASE
    WHEN "consumed" THEN 'CONSUMED'::"ReservationStatus"
    ELSE 'ACTIVE'::"ReservationStatus"
END;

-- Remove the legacy column and temporary timestamp default.
ALTER TABLE "inventory_reservations"
DROP COLUMN "consumed",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "inventory_reservations_productId_status_idx" ON "inventory_reservations"("productId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expiresAt_idx" ON "inventory_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "inventory_reservations_orderId_idx" ON "inventory_reservations"("orderId");
