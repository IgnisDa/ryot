import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	casing: "snake_case",
	dialect: "postgresql",
	schema: "./src/db/schema/index.ts",
	dbCredentials: { url: process.env.DATABASE_URL || "" },
});
