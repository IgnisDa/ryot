import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	dialect: "postgresql",
	schema: "./src/utils/db/schema.ts",
	dbCredentials: { url: process.env.DATABASE_URL || "" },
});
