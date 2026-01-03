import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load environment variables from .env.development.local
config({ path: ".env.development.local" });

export default defineConfig({
  datasource: {
    // Use DEV_STORAGE_POSTGRES_URL for local development
    // Vercel will automatically use PROD_STORAGE_POSTGRES_URL in production
    url:
      process.env.PROD_STORAGE_POSTGRES_URL ||
      process.env.DEV_STORAGE_POSTGRES_URL ||
      "",
  },
});
