-- Product request board: at most 10 open requests per hostel, reset every midnight (India
-- time) to its top 3. The rest are archived (kept for admins), not deleted. Additive only.
ALTER TYPE "ProductRequestStatus" ADD VALUE 'ARCHIVED';
ALTER TABLE "product_requests" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "hostels" ADD COLUMN "requestsResetAt" TIMESTAMP(3);
