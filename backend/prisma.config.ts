
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const databaseUrl =
  process.env.PRISMA_USE_TEST_DATABASE === "true"
    ? env("TEST_DATABASE_URL")
    : env("DATABASE_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
