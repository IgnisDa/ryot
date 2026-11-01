import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
	dialect: "postgresql",
	out: "app/drizzle/migrations",
	dbCredentials: { url: DATABASE_URL },
	schema: "app/drizzle/schema.server.ts",
});
