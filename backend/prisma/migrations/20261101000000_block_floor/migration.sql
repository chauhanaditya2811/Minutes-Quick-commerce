-- Floor becomes free text so customers can enter a block and floor together (e.g. "A/2").
-- Existing whole-number floors are kept as their text form ("2"); no other data changes.
ALTER TABLE "users" ALTER COLUMN "floor" SET DATA TYPE TEXT USING "floor"::TEXT;
ALTER TABLE "orders" ALTER COLUMN "customerFloor" SET DATA TYPE TEXT USING "customerFloor"::TEXT;
