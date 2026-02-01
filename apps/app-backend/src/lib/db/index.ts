export * as schema from "./schema";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "~/lib/config";

export const pool = new Pool({ connectionString: config.DATABASE_URL });

export const db = drizzle({ client: pool, casing: "snake_case" });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | DbTransaction;

export const assertPersisted = <T>(
	value: T | undefined | null,
	entity: string,
): T => {
	if (value == null) {
		throw new Error(`Could not persist ${entity}`);
	}
	return value;
};
