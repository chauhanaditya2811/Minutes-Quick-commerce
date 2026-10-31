-- Convenience fees: a fee per order-value range plus an optional late-night fee, all set by the
-- admin in Store settings. The current flat delivery fee becomes the only range and the
-- late-night fee starts switched off, so prices don't change until the admin edits them.

ALTER TABLE "settings" ADD COLUMN "feeTiers" JSONB NOT NULL DEFAULT '[{"minSubtotal":0,"fee":0}]';
UPDATE "settings" SET "feeTiers" = jsonb_build_array(jsonb_build_object('minSubtotal', 0, 'fee', "deliveryFee"));
ALTER TABLE "settings" ADD COLUMN "lateNightFeeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "lateNightFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "settings" ADD COLUMN "lateNightStart" TEXT NOT NULL DEFAULT '01:00';
ALTER TABLE "settings" ADD COLUMN "lateNightEnd" TEXT NOT NULL DEFAULT '06:00';

-- Orders record the late-night fee separately from the convenience fee (existing orders: 0).
ALTER TABLE "orders" ADD COLUMN "lateNightFee" INTEGER NOT NULL DEFAULT 0;
