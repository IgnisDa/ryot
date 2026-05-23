import { sql } from "drizzle-orm";
import type { Client, Pool, PoolClient } from "pg";

import type { DbClient } from "~/lib/db";

export type EntityMigrationTarget = {
	source: string;
	entitySchemaSlug: string;
	sandboxScriptSlug: string | null;
};

export type ResolvedEntityMigrationTarget = {
	source: string;
	entitySchemaId: string;
	sandboxScriptId: string | null;
};

export type LotEntityMigrationTarget = EntityMigrationTarget & { lot: string };
export type ResolvedLotEntityMigrationTarget = ResolvedEntityMigrationTarget & { lot: string };

export type ResolvedRelationshipTarget = {
	lot: string;
	relationshipSchemaId: string;
};

export const legacyMigrationsTableExistsSql = sql`
SELECT to_regclass('"seaql_migrations"') IS NOT NULL AS "present";
`;

export const hasLegacyMigrationsTable = async (database: DbClient) => {
	const result = await database.execute(legacyMigrationsTableExistsSql);
	const row = result.rows[0];
	if (row === undefined) {
		throw new Error("Unexpected: seaql_migrations presence check returned no rows");
	}

	return row.present === true;
};

export const shouldRunLegacyBootstrap = async (database: DbClient) => {
	return hasLegacyMigrationsTable(database);
};

export const logLegacyBootstrapNotice = (msg: { message?: string }) => {
	if (msg.message) {
		console.info(`[legacy-bootstrap] ${msg.message}`);
	}
};

export const quoteSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const quoteNullableSqlString = (value: string | null) =>
	value === null ? "NULL" : quoteSqlString(value);

type NoticeClient = Client | PoolClient;
type ClientCarrier = {
	$client?: Pool | NoticeClient;
	_: { session: { client?: Pool | NoticeClient } };
};

const isPool = (client: Pool | NoticeClient): client is Pool => "connect" in client;

const resolveLegacyBootstrapNoticeClient = async (database: DbClient) => {
	const carrier = database as DbClient & ClientCarrier;
	const sessionClient = carrier._.session.client;
	if (sessionClient && !isPool(sessionClient)) {
		return { client: sessionClient, release: () => {} };
	}

	const databaseClient = carrier.$client ?? sessionClient;
	if (databaseClient && !isPool(databaseClient)) {
		return { client: databaseClient, release: () => {} };
	}
	if (databaseClient) {
		const client = await databaseClient.connect();
		return { client, release: () => client.release() };
	}

	throw new Error("Could not resolve PostgreSQL client for legacy bootstrap progress reporting");
};

export const withLegacyBootstrapNoticeClient = async <T>(
	database: DbClient,
	callback: (client: NoticeClient) => Promise<T>,
) => {
	const { client, release } = await resolveLegacyBootstrapNoticeClient(database);
	client.on("notice", logLegacyBootstrapNotice);
	try {
		return await callback(client);
	} finally {
		client.removeListener("notice", logLegacyBootstrapNotice);
		release();
	}
};

export const buildUniqueSlugMap = (
	rows: Array<{ id: string; slug: string }>,
	kind: string,
): Map<string, string> => {
	const idsBySlug = new Map<string, string>();
	const duplicateSlugs = new Set<string>();

	for (const row of rows) {
		if (idsBySlug.has(row.slug)) {
			duplicateSlugs.add(row.slug);
		}
		idsBySlug.set(row.slug, row.id);
	}

	if (duplicateSlugs.size > 0) {
		throw new Error(`Duplicate ${kind} slugs: ${Array.from(duplicateSlugs).join(", ")}`);
	}

	return idsBySlug;
};

export const buildPrimaryImageSql = (tableAlias: string) => `CASE
	WHEN jsonb_array_length(COALESCE(${tableAlias}.assets -> 'remote_images', '[]'::jsonb)) > 0 THEN jsonb_build_object(
		'type', 'remote',
		'url', ${tableAlias}.assets -> 'remote_images' ->> 0
	)
	WHEN jsonb_array_length(COALESCE(${tableAlias}.assets -> 's3_images', '[]'::jsonb)) > 0 THEN jsonb_build_object(
		'type', 's3',
		'key', ${tableAlias}.assets -> 's3_images' ->> 0
	)
	ELSE NULL
END`;

export const buildLotEntityTargetValuesSql = (targets: ResolvedLotEntityMigrationTarget[]) =>
	targets
		.map(
			(t) =>
				`(${quoteSqlString(t.lot)}, ${quoteSqlString(t.source)}, ${quoteSqlString(t.entitySchemaId)}, ${quoteNullableSqlString(t.sandboxScriptId)})`,
		)
		.join(", ");

export const buildEntityTargetValuesSql = (targets: ResolvedEntityMigrationTarget[]) =>
	targets
		.map(
			(t) =>
				`(${quoteSqlString(t.source)}, ${quoteSqlString(t.entitySchemaId)}, ${quoteNullableSqlString(t.sandboxScriptId)})`,
		)
		.join(", ");

export const buildRelationshipTargetValuesSql = (targets: ResolvedRelationshipTarget[]) =>
	targets
		.map((t) => `(${quoteSqlString(t.lot)}, ${quoteSqlString(t.relationshipSchemaId)})`)
		.join(", ");
