import { PgClient } from "@effect/sql-pg/PgClient";
import {
	MigrationReportAnomalyCode,
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/god-mode/migration-report";
import {
	Database,
	mapDatabaseErrors,
} from "@ryot-app/kernel-backend/lib/infrastructure/db/service";
import { sql } from "drizzle-orm";
import { Data, Effect, Match, Schema } from "effect";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

export type EntityMigrationTarget = {
	source: string;
	entitySchemaSlug: string;
	providerSlug: string | null;
};

export type ResolvedEntityMigrationTarget = {
	source: string;
	entitySchemaPluginId: string | null;
	entitySchemaSlug: string;
	providerId: string | null;
};

export type LotEntityMigrationTarget = EntityMigrationTarget & { lot: string };
export type ResolvedLotEntityMigrationTarget = ResolvedEntityMigrationTarget & { lot: string };

export type ResolvedRelationshipTarget = {
	lot: string;
	relationshipSchemaPluginId: string | null;
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

export const quoteNullableSqlString = (value: string | null) =>
	value === null ? "NULL" : quoteSqlString(value);

export const withReservedConnection = Effect.fn("withReservedConnection")(function* <A, E, R>(
	callback: (connection: SqlConnection.Connection) => Effect.Effect<A, E, R>,
) {
	const client = yield* PgClient;
	return yield* mapDatabaseErrors(Effect.scoped(Effect.flatMap(client.reserve, callback)));
});

// Bootstrap SQL reports progress and anomalies as rows in a report table. The orchestration selects
// newly written rows after each phase, so every report is a value it can log and act on. Anomalies
// additionally write one detail row per offending record: the legacy tables they describe are
// dropped when the migration finishes, so the explanation cannot be reconstructed later.
const reportTable = "migration_report";

const detailTable = "migration_report_detail";

const elapsedSecondsSql = "round(extract(epoch from clock_timestamp() - started_at)::numeric, 1)";

const ReportRow = Schema.Struct({
	seq: Schema.Finite,
	phase: Schema.String,
	message: Schema.String,
	level: MigrationReportLevel,
	count: Schema.NullOr(Schema.Finite),
	elapsedSeconds: Schema.NullOr(Schema.Finite),
	code: Schema.NullOr(MigrationReportAnomalyCode),
});

export type ReportEntry =
	| { count?: string; message: string; level?: "info" }
	| { count?: string; message: string; level: "warning"; code: MigrationReportAnomalyCode };

const decodeReportRows = Schema.decodeUnknownEffect(Schema.Array(ReportRow));

const decodeReportDetails = Schema.decodeUnknownEffect(
	Schema.Array(Schema.Struct({ detail: MigrationReportDetail })),
);

// Anomalies are allowed by code, never by message text, so report copy can be rewritten freely
// without silently turning a documented omission into a startup abort.
const allowedWarningCodes: ReadonlySet<MigrationReportAnomalyCode> = new Set([
	"seen-episode-absent",
	"seen-episode-ambiguous",
	"seen-episode-malformed",
	"review-episode-absent",
	"review-episode-ambiguous",
	"asset-locator-unresolved",
	"asset-deletion-failed",
	"integration-cache-provider-unmapped",
	"integration-cache-entity-unresolved",
]);

class UnexpectedLegacyBootstrapWarning extends Data.TaggedError(
	"UnexpectedLegacyBootstrapWarning",
)<{
	phase: string;
	message: string;
	count: number | null;
	code: MigrationReportAnomalyCode | null;
}> {}

const reportSequenceSql = `SELECT COALESCE(MAX("seq"), 0) AS "seq" FROM "${reportTable}";`;

const selectReportSql = (afterSequence: number) => `
SELECT "seq", "phase", "level", "code", "message", "count", "elapsed_seconds" AS "elapsedSeconds"
FROM "${reportTable}"
WHERE "seq" > ${afterSequence}
ORDER BY "seq";
`;

const loggedDetailSampleSize = 3;

const selectDetailSampleSql = (reportSequence: number) => `
SELECT "detail" FROM "${detailTable}"
WHERE "report_seq" = ${reportSequence}
ORDER BY "seq"
LIMIT ${loggedDetailSampleSize};
`;

// Emitted inside `DO $$` blocks, which all declare `started_at`. `count` is a PL/pgSQL numeric
// expression, so only controlled identifiers belong there.
export const buildReportSql = (phase: string, entries: ReadonlyArray<ReportEntry>) =>
	`INSERT INTO "${reportTable}" ("phase", "level", "code", "message", "count", "elapsed_seconds")
	VALUES ${entries
		.map(
			(entry) =>
				`(${quoteSqlString(phase)}, ${quoteSqlString(entry.level ?? "info")}, ${quoteNullableSqlString(entry.level === "warning" ? entry.code : null)}, ${quoteSqlString(entry.message)}, ${entry.count ?? "NULL"}, ${elapsedSecondsSql})`,
		)
		.join(", ")};`;

// `source` is a table expression the caller has already materialised and `detail` a jsonb
// expression over it, so no legacy value is ever inlined into SQL text.
export const buildAnomalyReportSql = (input: {
	phase: string;
	source: string;
	detail: string;
	message: string;
	seqVariable: string;
	countVariable: string;
	code: MigrationReportAnomalyCode;
}) => `
	SELECT count(*) INTO ${input.countVariable} FROM ${input.source};
	IF ${input.countVariable} > 0 THEN
		INSERT INTO "${reportTable}"
			("phase", "level", "code", "message", "count", "elapsed_seconds")
		VALUES (
			${quoteSqlString(input.phase)}, 'warning', ${quoteSqlString(input.code)},
			${quoteSqlString(input.message)}, ${input.countVariable}, ${elapsedSecondsSql}
		)
		RETURNING "seq" INTO ${input.seqVariable};

		INSERT INTO "${detailTable}" ("report_seq", "detail")
		SELECT ${input.seqVariable}, ${input.detail} FROM ${input.source};
	END IF;
`;

const insertAnomalyReportSql = `
WITH summary AS (
	INSERT INTO "${reportTable}" ("phase", "level", "code", "message", "count", "elapsed_seconds")
	VALUES ($1, 'warning', $2, $3, $4, $5)
	RETURNING "seq"
)
INSERT INTO "${detailTable}" ("report_seq", "detail")
SELECT summary."seq", entry."value"
FROM summary, jsonb_array_elements($6::jsonb) AS entry("value");
`;

export const insertAnomalyReport = (
	connection: SqlConnection.Connection,
	input: {
		phase: string;
		count: number;
		message: string;
		elapsedSeconds: number | null;
		code: MigrationReportAnomalyCode;
		details: ReadonlyArray<MigrationReportDetail>;
	},
) =>
	connection.execute(
		insertAnomalyReportSql,
		[
			input.phase,
			input.code,
			input.message,
			input.count,
			input.elapsedSeconds,
			JSON.stringify(input.details),
		],
		undefined,
	);

const insertReportRowsSql = `
INSERT INTO "${reportTable}" ("phase", "level", "code", "message", "count", "elapsed_seconds")
SELECT entry."phase", entry."level", entry."code", entry."message", entry."count", entry."elapsedSeconds"
FROM jsonb_to_recordset($1::jsonb) AS entry(
	"phase" text, "level" text, "code" text, "message" text,
	"count" int, "elapsedSeconds" double precision
);
`;

export const insertReportRows = (
	connection: SqlConnection.Connection,
	rows: ReadonlyArray<
		{ phase: string; message: string; count: number | null; elapsedSeconds: number | null } & (
			| { level?: "info" }
			| { level: "warning"; code: MigrationReportAnomalyCode }
		)
	>,
) =>
	rows.length === 0
		? Effect.void
		: connection.execute(
				insertReportRowsSql,
				[
					JSON.stringify(
						rows.map((row) => ({
							...row,
							level: row.level ?? "info",
							code: row.level === "warning" ? row.code : null,
						})),
					),
				],
				undefined,
			);

const logReportRow = (row: typeof ReportRow.Type) => {
	const annotations = {
		phase: row.phase,
		...(row.code === null ? {} : { code: row.code }),
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

// Detail rows are unbounded, so only a sample reaches the terminal; the full set stays in
// `migration_report_detail` and in the god-mode report.
const logDetailSample = (
	connection: SqlConnection.Connection,
	row: typeof ReportRow.Type,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const rows = yield* connection.execute(selectDetailSampleSql(row.seq), [], undefined);
		const sampled = yield* Effect.orDie(decodeReportDetails(rows));
		for (const { detail } of sampled) {
			yield* Effect.logWarning(`  ${JSON.stringify(detail)}`).pipe(
				Effect.annotateLogs({ phase: row.phase, code: detail.code }),
			);
		}
		// Codes that record no per-record detail must not claim there are more to look at.
		const remaining = (row.count ?? sampled.length) - sampled.length;
		if (sampled.length > 0 && remaining > 0) {
			yield* Effect.logWarning(
				`  ...and ${remaining} more; open the god-mode Migration Report for the full list`,
			).pipe(Effect.annotateLogs({ phase: row.phase }));
		}
	}).pipe(Effect.orDie);

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
			if (row.level !== "warning") {
				continue;
			}
			if (row.code === null || !allowedWarningCodes.has(row.code)) {
				return yield* new UnexpectedLegacyBootstrapWarning({
					code: row.code,
					count: row.count,
					phase: row.phase,
					message: row.message,
				});
			}
			yield* logDetailSample(connection, row);
		}
		return reported.at(-1)?.seq ?? afterSequence;
	});

// Aborts state what was found, why it blocks the migration, and what the operator should do next.
// A `RAISE EXCEPTION` rolls back its own `DO $$` block, so nothing it writes to `migration_report`
// survives; the exception message is the only channel an operator ever sees.
export const buildRequireLegacyTableSql = (phase: string, table: string) => `
	IF to_regclass('"${table}"') IS NULL THEN
		RAISE EXCEPTION '${phase}: the legacy table "${table}" is missing, so there is nothing to migrate from. This migration runs because "seaql_migrations" exists, which means a complete V1 database is expected. Restore a complete V1 dump, or drop "seaql_migrations" if this is not a V1 database, then start the server again.';
	END IF;
`;

const abortSampleLimit = 20;

// Gathers a bounded, sorted sample of the offending rows so the operator learns which records
// broke the invariant. The bound matters: an unbounded `string_agg` over a large dump produces a
// multi-megabyte exception message.
export const buildAbortOnRowsSql = (input: {
	source: string;
	message: string;
	countVariable: string;
	sampleVariable: string;
}) => `
	SELECT count(*) INTO ${input.countVariable} FROM (${input.source}) offending;
	IF ${input.countVariable} > 0 THEN
		SELECT string_agg(sample.label, '; ' ORDER BY sample.label)
		INTO ${input.sampleVariable}
		FROM (
			SELECT offending.label FROM (${input.source}) offending
			ORDER BY offending.label LIMIT ${abortSampleLimit}
		) sample;
		RAISE EXCEPTION ${quoteSqlString(input.message)}, ${input.countVariable}, ${input.sampleVariable};
	END IF;
`;

export const buildLotEntityTargetValuesSql = (targets: ResolvedLotEntityMigrationTarget[]) =>
	targets
		.map(
			(t) =>
				`(${quoteSqlString(t.lot)}, ${quoteSqlString(t.source)}, ${quoteSqlString(t.entitySchemaSlug)}, ${quoteNullableSqlString(t.entitySchemaPluginId)}, ${quoteNullableSqlString(t.providerId)})`,
		)
		.join(", ");

export const buildEntityTargetValuesSql = (targets: ResolvedEntityMigrationTarget[]) =>
	targets
		.map(
			(t) =>
				`(${quoteSqlString(t.source)}, ${quoteSqlString(t.entitySchemaSlug)}, ${quoteNullableSqlString(t.entitySchemaPluginId)}, ${quoteNullableSqlString(t.providerId)})`,
		)
		.join(", ");

export const buildRelationshipTargetValuesSql = (targets: ResolvedRelationshipTarget[]) =>
	targets
		.map(
			(t) =>
				`(${quoteSqlString(t.lot)}, ${quoteSqlString(t.relationshipSchemaSlug)}, ${quoteNullableSqlString(t.relationshipSchemaPluginId)})`,
		)
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
