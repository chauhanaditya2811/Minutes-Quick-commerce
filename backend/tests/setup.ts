
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

if (process.env.NODE_ENV !== "test") {
  throw new Error("Tests must run with NODE_ENV=test.");
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is not configured.");
}

let databaseUrl: URL;

try {
  databaseUrl = new URL(testDatabaseUrl);
} catch {
  throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
}

if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
  throw new Error("TEST_DATABASE_URL must use the PostgreSQL protocol.");
}

const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));

if (databaseName !== "minutes_test") {
  throw new Error(
    `Tests must use minutes_test, but TEST_DATABASE_URL targets "${databaseName}".`
  );
}
