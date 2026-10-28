-- Guest checkout: orders and their stock holds may belong to a guest instead of a
-- registered user. Additive and non-destructive: existing rows keep their user.

-- Guest orders have no user and no email; delivery details stay in the snapshot columns.
ALTER TABLE "orders" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "customerEmail" DROP NOT NULL;

-- SHA-256 of the guest's secret checkout token (the token itself is never stored).
ALTER TABLE "orders" ADD COLUMN "guestAccessTokenHash" TEXT;
CREATE UNIQUE INDEX "orders_guestAccessTokenHash_key" ON "orders"("guestAccessTokenHash");

-- Every order is owned by a registered user or a guest token, never neither.
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_check"
  CHECK ("userId" IS NOT NULL OR "guestAccessTokenHash" IS NOT NULL);

-- Stock holds for guest orders have no user.
ALTER TABLE "inventory_reservations" ALTER COLUMN "userId" DROP NOT NULL;
