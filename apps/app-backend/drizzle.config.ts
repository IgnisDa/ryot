import { defineConfig } from "drizzle-kit";
import { config } from "~/lib/config";

export default defineConfig({
	out: "./drizzle",
	casing: "snake_case",
	dialect: "postgresql",
	schema: "./src/db/schema/index.ts",
	dbCredentials: { url: config.DATABASE_URL },
});
