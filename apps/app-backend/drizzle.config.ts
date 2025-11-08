import { defineConfig } from "drizzle-kit";

export default defineConfig({
	breakpoints: false,
	out: "./src/drizzle",
	casing: "snake_case",
	dialect: "postgresql",
	schema: "./src/lib/db/schema",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
	},
});
