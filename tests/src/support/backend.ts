import { Pool as PgPool } from "pg";
import { afterAll, inject } from "vitest";

let pgPool: PgPool | undefined;

export function getBackendUrl() {
	return inject("backendUrl");
}

export function getPgClient() {
	pgPool ??= new PgPool({ connectionString: inject("dbUrl") });
	return pgPool;
}

afterAll(async () => {
	await pgPool?.end();
});
