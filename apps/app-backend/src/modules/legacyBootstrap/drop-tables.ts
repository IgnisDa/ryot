import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

const dropLegacyMigrationsTableSql = sql`
DROP TABLE IF EXISTS "seaql_migrations" CASCADE;
`;

const dropLegacyMetadataTableSql = sql`
DROP TABLE IF EXISTS "metadata" CASCADE;
`;

const dropLegacyUserTableSql = sql`
DROP TABLE IF EXISTS "old_user" CASCADE;
`;

const dropLegacyMigrationsTable = async (database: DbClient) => {
	await database.execute(dropLegacyMigrationsTableSql);
};

const dropLegacyMetadataTable = async (database: DbClient) => {
	await database.execute(dropLegacyMetadataTableSql);
};

const dropLegacyUserTable = async (database: DbClient) => {
	await database.execute(dropLegacyUserTableSql);
};

export const dropLegacyTables = async (database: DbClient) => {
	await dropLegacyMigrationsTable(database);
	await dropLegacyMetadataTable(database);
	await dropLegacyUserTable(database);
};
