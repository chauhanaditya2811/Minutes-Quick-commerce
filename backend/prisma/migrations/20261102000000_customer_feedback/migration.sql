-- Customer feedback: product requests customers can upvote (per hostel) and private feedback
-- messages for admins. New tables only; no existing data changes.
-- CreateEnum
CREATE TYPE "ProductRequestStatus" AS ENUM ('OPEN', 'ADDED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'DONE');

-- CreateTable
CREATE TABLE "product_requests" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "status" "ProductRequestStatus" NOT NULL DEFAULT 'OPEN',
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_request_votes" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "voterHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_request_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT,
    "message" TEXT NOT NULL,
    "rating" INTEGER,
    "contactPhone" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_requests_hostelId_status_idx" ON "product_requests"("hostelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_requests_hostelId_normalizedName_key" ON "product_requests"("hostelId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "product_request_votes_requestId_voterHash_key" ON "product_request_votes"("requestId", "voterHash");

-- CreateIndex
CREATE INDEX "feedback_status_createdAt_idx" ON "feedback"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_request_votes" ADD CONSTRAINT "product_request_votes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "product_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
