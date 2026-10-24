-- Preserve historical Razorpay identifiers. New Cashfree identifiers live in
-- separate nullable columns so existing transactions remain attributable.
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'CASHFREE');

ALTER TABLE "payments"
  ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
  ADD COLUMN "cashfreeOrderId" TEXT,
  ADD COLUMN "cashfreePaymentId" TEXT;

ALTER TABLE "payment_attempts"
  ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
  ADD COLUMN "cashfreeOrderId" TEXT,
  ADD COLUMN "cashfreePaymentId" TEXT;

CREATE UNIQUE INDEX "payments_cashfreeOrderId_key"
  ON "payments"("cashfreeOrderId");
CREATE UNIQUE INDEX "payments_cashfreePaymentId_key"
  ON "payments"("cashfreePaymentId");
CREATE UNIQUE INDEX "payment_attempts_cashfreePaymentId_key"
  ON "payment_attempts"("cashfreePaymentId");
CREATE INDEX "payment_attempts_cashfreeOrderId_idx"
  ON "payment_attempts"("cashfreeOrderId");

ALTER TABLE "razorpay_webhook_events"
  RENAME TO "cashfree_webhook_events";

ALTER TABLE "cashfree_webhook_events"
  RENAME CONSTRAINT "razorpay_webhook_events_pkey"
  TO "cashfree_webhook_events_pkey";
