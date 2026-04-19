import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./src/drizzle",
	casing: "snake_case",
	dialect: "postgresql",
	schema: "./src/lib/db/schema/index.ts",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
	},
});
