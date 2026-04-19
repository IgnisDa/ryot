import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./src/drizzle",
	casing: "snake_case",
	dialect: "postgresql",
	schema: "./src/lib/schema.ts",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ryot_reference",
	},
});
