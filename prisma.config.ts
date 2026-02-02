import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.development", quiet: true });
config({ path: ".env.development.local", quiet: true });

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || "",
  },
});
