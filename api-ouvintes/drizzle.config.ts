import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./database/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://radio88_user:radio88_dev_password@localhost:5434/radio88_cadastros",
  },
  strict: true,
  verbose: true,
});
