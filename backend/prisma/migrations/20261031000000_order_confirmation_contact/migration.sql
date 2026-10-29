-- Order confirmation screen: when an order was confirmed (starts the 10-minute delivery
-- countdown) and the store's phone number for the "Call Store" button. Additive only.
ALTER TABLE "orders" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "settings" ADD COLUMN "storePhone" TEXT;
