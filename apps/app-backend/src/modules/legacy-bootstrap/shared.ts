import { PgClient } from "@effect/sql-pg/PgClient";
import { sql } from "drizzle-orm";
import { Data, Effect, Match, Schema } from "effect";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type EntityMigrationTarget = {
	source: string;
	entitySchemaSlug: string;
	providerSlug: string | null;
};

export type ResolvedEntityMigrationTarget = {
	source: string;
	entitySchemaSlug: string;
	providerId: string | null;
};

export type LotEntityMigrationTarget = EntityMigrationTarget & { lot: string };
export type ResolvedLotEntityMigrationTarget = ResolvedEntityMigrationTarget & { lot: string };

export type ResolvedRelationshipTarget = {
	lot: string;
	relationshipSchemaSlug: string;
};

export const legacyBootstrapGate = Effect.gen(function* () {
	const database = yield* Database;
	const result = yield* mapDatabaseErrors(
		database.execute<{ present: boolean }>(
			sql`SELECT to_regclass('"seaql_migrations"') IS NOT NULL AS "present"`,
			"objects",
		),
	);
	const row = result[0];
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

export const withReservedConnection = Effect.fn("withReservedConnection")(function* <A, E, R>(
	callback: (connection: SqlConnection.Connection) => Effect.Effect<A, E, R>,
) {
	const client = yield* PgClient;
	return yield* mapDatabaseErrors(Effect.scoped(Effect.flatMap(client.reserve, callback)));
});

// Bootstrap SQL reports progress and anomalies as rows in a report table. The orchestration selects
// newly written rows after each phase, so every report is a value it can log and act on.
const reportTable = "migration_report";

const elapsedSecondsSql = "round(extract(epoch from clock_timestamp() - started_at)::numeric, 1)";

const ReportRow = Schema.Struct({
	seq: Schema.Finite,
	phase: Schema.String,
	message: Schema.String,
	count: Schema.NullOr(Schema.Finite),
	elapsedSeconds: Schema.NullOr(Schema.Finite),
	level: Schema.Literals(["info", "warning"]),
});

type ReportEntry = {
	count?: string;
	message: string;
	level?: typeof ReportRow.Type.level;
};

const decodeReportRows = Schema.decodeUnknownEffect(Schema.Array(ReportRow));

const allowedWarningReports = new Set([
	"application_cache -> integration progress persistent cache|cache row(s) skipped because their provider identity cannot be mapped to V2",
	"application_cache -> integration progress persistent cache|cache row(s) skipped because their target entity could not be resolved",
	"legacy S3 assets -> managed_asset|asset locator(s) could not be resolved or registered; original locators were retained",
	"review -> event|show/podcast review(s) skipped because their episode could not be resolved positionally; these reviews were not migrated",
	"seen -> event|show/podcast row(s) skipped because their episode could not be resolved positionally; progress/completion for them was not migrated",
]);

class UnexpectedLegacyBootstrapWarning extends Data.TaggedError(
	"UnexpectedLegacyBootstrapWarning",
)<{ phase: string; message: string; count: number | null }> {}

const reportSequenceSql = `SELECT COALESCE(MAX("seq"), 0) AS "seq" FROM "${reportTable}";`;

const selectReportSql = (afterSequence: number) => `
SELECT "seq", "phase", "level", "message", "count", "elapsed_seconds" AS "elapsedSeconds"
FROM "${reportTable}"
WHERE "seq" > ${afterSequence}
ORDER BY "seq";
`;

// Emitted inside `DO $$` blocks, which all declare `started_at`. `count` is a PL/pgSQL numeric
// expression, so only controlled identifiers belong there.
export const buildReportSql = (phase: string, entries: ReadonlyArray<ReportEntry>) =>
	`INSERT INTO "${reportTable}" ("phase", "level", "message", "count", "elapsed_seconds")
	VALUES ${entries
		.map(
			(entry) =>
				`(${quoteSqlString(phase)}, ${quoteSqlString(entry.level ?? "info")}, ${quoteSqlString(entry.message)}, ${entry.count ?? "NULL"}, ${elapsedSecondsSql})`,
		)
		.join(", ")};`;

const logReportRow = (row: typeof ReportRow.Type) => {
	const annotations = {
		phase: row.phase,
		...(row.count === null ? {} : { count: row.count }),
		...(row.elapsedSeconds === null ? {} : { elapsedSeconds: row.elapsedSeconds }),
	};
	return Match.value(row.level).pipe(
		Match.when("info", () => Effect.logInfo(row.message)),
		Match.when("warning", () => Effect.logWarning(row.message)),
		Match.exhaustive,
		Effect.annotateLogs(annotations),
	);
};

export const getLatestReportSequence = (connection: SqlConnection.Connection) =>
	Effect.gen(function* () {
		const rows = yield* connection.execute(reportSequenceSql, [], undefined);
		const row = rows[0];
		if (row === undefined) {
			return yield* Effect.die(new Error("Unexpected: report sequence query returned no rows"));
		}
		const sequence = yield* Effect.orDie(
			Schema.decodeUnknownEffect(Schema.Struct({ seq: Schema.Finite }))(row),
		);
		return sequence.seq;
	});

export const logReportRows = (connection: SqlConnection.Connection, afterSequence: number) =>
	Effect.gen(function* () {
		const rows = yield* connection.execute(selectReportSql(afterSequence), [], undefined);
		const reported = yield* Effect.orDie(decodeReportRows(rows));
		for (const row of reported) {
			yield* logReportRow(row);
			if (row.level === "warning" && !allowedWarningReports.has(`${row.phase}|${row.message}`)) {
				return yield* new UnexpectedLegacyBootstrapWarning({
					count: row.count,
					phase: row.phase,
					message: row.message,
				});
			}
		}
		return reported.at(-1)?.seq ?? afterSequence;
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
				`(${quoteSqlString(t.lot)}, ${quoteSqlString(t.source)}, ${quoteSqlString(t.entitySchemaSlug)}, ${quoteNullableSqlString(t.providerId)})`,
		)
		.join(", ");

export const buildEntityTargetValuesSql = (targets: ResolvedEntityMigrationTarget[]) =>
	targets
		.map(
			(t) =>
				`(${quoteSqlString(t.source)}, ${quoteSqlString(t.entitySchemaSlug)}, ${quoteNullableSqlString(t.providerId)})`,
		)
		.join(", ");

export const buildRelationshipTargetValuesSql = (targets: ResolvedRelationshipTarget[]) =>
	targets
		.map((t) => `(${quoteSqlString(t.lot)}, ${quoteSqlString(t.relationshipSchemaSlug)})`)
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

	${buildReportSql("referenced global entity ids", [{ count: "rows_inserted", message: "ids collected" }])}
END $$;
`;
