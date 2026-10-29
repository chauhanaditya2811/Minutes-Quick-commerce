-- Preserve user profiles when hostels are managed and prevent deleting referenced hostels.
ALTER TABLE "users" DROP CONSTRAINT "users_hostelId_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_hostelId_fkey"
  FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
