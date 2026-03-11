export * as schema from "./schema";

import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { config } from "~/lib/config";
import { seedInitialDatabase } from "./seed";

const migrationsFolder = resolve(process.cwd(), "drizzle");

export const pool = new Pool({ connectionString: config.DATABASE_URL });

export const db = drizzle({ client: pool, casing: "snake_case" });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | DbTransaction;

export const migrateDB = async () => {
	await migrate(db, { migrationsFolder });
	await seedInitialDatabase();
};
