import { defineConfig } from "drizzle-kit";

import { config } from "~/lib/config";

export default defineConfig({
	out: "./src/drizzle",
	casing: "snake_case",
	dialect: "postgresql",
	schema: "./src/lib/db/schema/index.ts",
	dbCredentials: { url: config.databaseUrl },
});
