/*
  Warnings:

  - You are about to drop the column `consumed` on the `inventory_reservations` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `inventory_reservations` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- DropIndex
DROP INDEX "inventory_reservations_expiresAt_idx";

-- DropIndex
DROP INDEX "inventory_reservations_productId_idx";

-- AlterTable
ALTER TABLE "inventory_reservations" DROP COLUMN "consumed",
ADD COLUMN     "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "inventory_reservations_productId_status_idx" ON "inventory_reservations"("productId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expiresAt_idx" ON "inventory_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "inventory_reservations_orderId_idx" ON "inventory_reservations"("orderId");
