import { sql } from "drizzle-orm";
import { Effect, Runtime } from "effect";
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

export const quoteSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const quoteNullableSqlString = (value: string | null) =>
	value === null ? "NULL" : quoteSqlString(value);

export const withRawPgClient = Effect.fn("withRawPgClient")(function* <A>(
	callback: (client: PoolClient) => Promise<A>,
) {
	const { pool } = yield* DbService;
	const runtime = yield* Effect.runtime();
	const client = yield* Effect.promise(() => pool.connect());
	const logLegacyBootstrapNotice = (msg: { message?: string | undefined }) => {
		if (msg.message) {
			Runtime.runFork(runtime)(
				Effect.logInfo("legacy bootstrap notice").pipe(
					Effect.annotateLogs({ notice: msg.message }),
				),
			);
		}
	};
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

// Session temp table of every entity id referenced by V1 user data, used to restrict provider
// entity migration to the referenced subset. Created without ON COMMIT DROP so it survives across
// the separate autocommit statements of phase 3. See "Slim Migration Strategy" in AGENTS.md.
export const buildReferencedGlobalEntityIdsSql = () => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('pg_temp._referenced_global_entity_ids') IS NOT NULL THEN
		RETURN;
	END IF;

	CREATE TEMP TABLE _referenced_global_entity_ids (id text PRIMARY KEY);

	INSERT INTO _referenced_global_entity_ids (id)
	SELECT DISTINCT refs.id
	FROM (
		SELECT s.metadata_id::text AS id FROM "seen" s WHERE s.metadata_id IS NOT NULL
		UNION
		SELECT r.entity_id::text AS id FROM "review" r WHERE r.entity_id IS NOT NULL
		UNION
		SELECT cte.entity_id::text AS id FROM "collection_to_entity" cte WHERE cte.entity_id IS NOT NULL
		UNION
		SELECT ute.entity_id::text AS id FROM "user_to_entity" ute WHERE ute.entity_id IS NOT NULL
		UNION
		SELECT m2p.person_id::text FROM "metadata_to_person" m2p
			INNER JOIN "person" p ON p.id = m2p.person_id
			INNER JOIN "metadata" m ON m.id = m2p.metadata_id
			WHERE p.created_by_user_id IS NOT NULL OR m.created_by_user_id IS NOT NULL
		UNION
		SELECT m2p.metadata_id::text FROM "metadata_to_person" m2p
			INNER JOIN "person" p ON p.id = m2p.person_id
			INNER JOIN "metadata" m ON m.id = m2p.metadata_id
			WHERE p.created_by_user_id IS NOT NULL OR m.created_by_user_id IS NOT NULL
		UNION
		SELECT mg2p.person_id::text FROM "metadata_group_to_person" mg2p
			INNER JOIN "person" p ON p.id = mg2p.person_id
			INNER JOIN "metadata_group" mg ON mg.id = mg2p.metadata_group_id
			WHERE p.created_by_user_id IS NOT NULL OR mg.created_by_user_id IS NOT NULL
		UNION
		SELECT mg2p.metadata_group_id::text FROM "metadata_group_to_person" mg2p
			INNER JOIN "person" p ON p.id = mg2p.person_id
			INNER JOIN "metadata_group" mg ON mg.id = mg2p.metadata_group_id
			WHERE p.created_by_user_id IS NOT NULL OR mg.created_by_user_id IS NOT NULL
		UNION
		SELECT m2mg.metadata_id::text FROM "metadata_to_metadata_group" m2mg
			INNER JOIN "metadata_group" mg ON mg.id = m2mg.metadata_group_id
			INNER JOIN "metadata" m ON m.id = m2mg.metadata_id
			WHERE mg.created_by_user_id IS NOT NULL OR m.created_by_user_id IS NOT NULL
		UNION
		SELECT m2mg.metadata_group_id::text FROM "metadata_to_metadata_group" m2mg
			INNER JOIN "metadata_group" mg ON mg.id = m2mg.metadata_group_id
			INNER JOIN "metadata" m ON m.id = m2mg.metadata_id
			WHERE mg.created_by_user_id IS NOT NULL OR m.created_by_user_id IS NOT NULL
	) refs
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	ANALYZE _referenced_global_entity_ids;

	RAISE NOTICE 'referenced global entity ids: % collected (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
