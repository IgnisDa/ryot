export * as schema from "./schema";

import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "../lib/config";
import { seedEntitySchemas } from "./seed";

const migrationsFolder = resolve(process.cwd(), "drizzle");

export const db = drizzle(config.DATABASE_URL, { casing: "snake_case" });

export const migrateDB = async () => {
	try {
		await migrate(db, { migrationsFolder });
		await seedEntitySchemas();
	} catch (error) {
		console.error("Database migration failed:", error);
		throw error;
	}
};
