import { sql } from "drizzle-orm";

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
