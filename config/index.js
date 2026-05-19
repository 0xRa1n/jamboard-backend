const dotenv = require("dotenv");

dotenv.config();

const isDevelopment =
  String(process.env.DEVELOPMENT || "")
    .trim()
    .toLowerCase() === "true";
const isTestRuntime =
  process.argv.includes("--test") ||
  process.argv.includes("--test-only") ||
  process.env.NODE_ENV === "test" ||
  process.env.npm_lifecycle_event === "test" ||
  typeof process.env.NODE_TEST_CONTEXT === "string";
const primaryDatabase = process.env.POSTGRES_DATABASE;
const isolatedTestDatabase =
  process.env.POSTGRES_TEST_DATABASE || (primaryDatabase ? `${primaryDatabase}_test` : undefined);

const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "",
  acsConnectionString: process.env.ACS_CONNECTION_STRING || "",
  acsSenderAddress: process.env.ACS_SENDER_ADDRESS || "",
  isDevelopment,
  isTestRuntime,
  db: {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USERNAME,
    password: process.env.POSTGRES_PASSWORD,
    database: isDevelopment && isTestRuntime ? isolatedTestDatabase : primaryDatabase,
    primaryDatabase,
    adminDatabase: process.env.POSTGRES_ADMIN_DATABASE || "postgres",
  },
};

function assertJwtSecret() {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET is required to start the server.");
  }
}

module.exports = {
  config,
  assertJwtSecret,
};
