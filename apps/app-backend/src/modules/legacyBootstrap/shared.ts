import { sql } from "drizzle-orm";
import type { Client, Pool, PoolClient } from "pg";

import type { DbClient } from "~/lib/db";

export const legacyMigrationsTableExistsSql = sql`
SELECT to_regclass('"seaql_migrations"') IS NOT NULL AS "present";
`;

export const hasLegacyMigrationsTable = async (database: DbClient) => {
	const result = await database.execute(legacyMigrationsTableExistsSql);

	return result.rows[0]?.present === true;
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
