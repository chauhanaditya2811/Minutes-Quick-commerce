UPDATE "orders"
SET "orderStatus" = 'PENDING_PAYMENT'
WHERE "orderStatus" = 'CONFIRMED'
  AND "paymentStatus" IN ('CREATED', 'PENDING');
