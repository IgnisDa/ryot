import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { PoolClient } from "pg";

import { dbEffect, DbService } from "#lib/infrastructure/db/service";

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

export const legacyBootstrapGate = Effect.gen(function* () {
	const { db } = yield* DbService;
	const result = yield* dbEffect(() =>
		db.execute<{ present: boolean }>(
			sql`SELECT to_regclass('"seaql_migrations"') IS NOT NULL AS "present"`,
		),
	);
	const row = result.rows[0];
	if (row === undefined) {
		return yield* Effect.die(
			new Error("Unexpected: seaql_migrations presence check returned no rows"),
		);
	}
	return row.present;
});

const logLegacyBootstrapNotice = (msg: { message?: string }) => {
	if (msg.message) {
		Effect.runSync(Effect.logInfo(`[legacy-bootstrap] ${msg.message}`));
	}
};

export const quoteSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const quoteNullableSqlString = (value: string | null) =>
	value === null ? "NULL" : quoteSqlString(value);

export const withRawPgClient = Effect.fn("withRawPgClient")(function* <A>(
	callback: (client: PoolClient) => Promise<A>,
) {
	const { pool } = yield* DbService;
	const client = yield* Effect.promise(() => pool.connect());
	client.on("notice", logLegacyBootstrapNotice);
	return yield* Effect.promise(() => callback(client)).pipe(
		Effect.ensuring(
			Effect.sync(() => {
				client.removeListener("notice", logLegacyBootstrapNotice);
				client.release();
			}),
		),
	);
});

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
