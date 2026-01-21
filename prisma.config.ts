import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.development" });
config({ path: ".env.development.local" });

export default defineConfig({
  datasource: {
    url:
      process.env.DEV_STORAGE_POSTGRES_URL ||
      process.env.DATABASE_URL ||
      process.env.PROD_STORAGE_POSTGRES_URL ||
      "",
  },
});
