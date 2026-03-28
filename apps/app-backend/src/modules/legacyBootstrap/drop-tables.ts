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

const dropLegacyMetadataToMetadataGroupTableSql = sql`
DROP TABLE IF EXISTS "metadata_to_metadata_group" CASCADE;
`;

const dropLegacyMetadataGroupToPersonTableSql = sql`
DROP TABLE IF EXISTS "metadata_group_to_person" CASCADE;
`;

const dropLegacyMetadataToPersonTableSql = sql`
DROP TABLE IF EXISTS "metadata_to_person" CASCADE;
`;

const dropLegacyMetadataGroupTableSql = sql`
DROP TABLE IF EXISTS "metadata_group" CASCADE;
`;

const dropLegacyPersonTableSql = sql`
DROP TABLE IF EXISTS "person" CASCADE;
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

const dropLegacyMetadataGroupTables = async (database: DbClient) => {
	await database.execute(dropLegacyMetadataToMetadataGroupTableSql);
	await database.execute(dropLegacyMetadataGroupToPersonTableSql);
	await database.execute(dropLegacyMetadataGroupTableSql);
};

const dropLegacyPersonTables = async (database: DbClient) => {
	await database.execute(dropLegacyMetadataToPersonTableSql);
	await database.execute(dropLegacyPersonTableSql);
};

export const dropLegacyTables = async (database: DbClient) => {
	console.info("[legacy-bootstrap] dropping legacy tables");
	await dropLegacyMigrationsTable(database);
	await dropLegacyMetadataTable(database);
	await dropLegacyMetadataGroupTables(database);
	await dropLegacyPersonTables(database);
	await dropLegacyUserTable(database);
};
