import type { MigrationReportDetail } from "@ryot-app/contract/modules/god-mode/migration-report";
import { exerciseKindSchema, type ExerciseKind } from "@ryot-app/fitness-plugin/exercise-kinds";
import {
	WorkoutSetMeasurementsSchema,
	awardWorkoutPersonalBests,
	calculateWorkoutSetStatistics,
	normalizeWorkoutMeasurements,
	type WorkoutRecordMaxima,
} from "@ryot-app/fitness-plugin/workout-records";
import { Effect, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import type { QualifiedSchema } from "./migration-resolution";
import { insertAnomalyReport, insertReportRows } from "./shared";

const batchSize = 500;
const reportPhase = "workout sets -> event records";

const WorkoutStreamSchema = Schema.Struct({ userId: Schema.String, entityId: Schema.String });

const WorkoutRecordRowSchema = Schema.Struct({
	userId: Schema.String,
	eventId: Schema.String,
	entityId: Schema.String,
	outsideSession: Schema.Boolean,
	kind: Schema.NullOr(Schema.String),
	endedAt: Schema.NullOr(Schema.String),
	workoutId: Schema.NullOr(Schema.String),
	exerciseId: Schema.NullOr(Schema.String),
	confirmedAt: Schema.NullOr(Schema.String),
	setOrderKey: Schema.NullOr(Schema.Finite),
	occurredAtKey: Schema.NullOr(Schema.String),
	workoutUserId: Schema.NullOr(Schema.String),
	sessionEntityId: Schema.NullOr(Schema.String),
	exerciseOrderKey: Schema.NullOr(Schema.Finite),
	workoutStartedAtKey: Schema.NullOr(Schema.String),
	properties: Schema.Record(Schema.String, Schema.Unknown),
});

const WorkoutRecordPropertyPatchSchema = Schema.Struct({
	id: Schema.String,
	removeKeys: Schema.Array(Schema.String),
	setProperties: Schema.Record(Schema.String, Schema.Unknown),
});

type WorkoutStream = typeof WorkoutStreamSchema.Type;
type WorkoutRecordRow = typeof WorkoutRecordRowSchema.Type;

const streamRowsSql = `
SELECT DISTINCT
	ev."user_id" COLLATE "C" AS "userId",
	ev."entity_id" COLLATE "C" AS "entityId"
FROM "event" ev
WHERE ev."event_schema_slug" = $3
	AND ev."event_schema_plugin_id" IS NOT DISTINCT FROM $4
	AND (
		$1::text IS NULL
		OR (ev."user_id" COLLATE "C", ev."entity_id" COLLATE "C")
			> ($1::text COLLATE "C", $2::text COLLATE "C")
	)
ORDER BY "userId", "entityId"
LIMIT $5::int
`;

const eventOrderKeys = [
	{ parameterKind: "timestamp", expression: 'ev."occurred_at"' },
	{ parameterKind: "text", expression: `NULLIF(w."properties" ->> 'startedAt', '') COLLATE "C"` },
	{ parameterKind: "text", expression: 'ev."session_entity_id" COLLATE "C"' },
	{
		parameterKind: "integer",
		expression: "NULLIF(ev.\"properties\" ->> 'exerciseOrder', '')::int",
	},
	{ parameterKind: "integer", expression: "NULLIF(ev.\"properties\" ->> 'setOrder', '')::int" },
	{ parameterKind: "text", expression: 'ev."id" COLLATE "C"' },
] satisfies ReadonlyArray<{ expression: string; parameterKind: "integer" | "text" | "timestamp" }>;

const eventOrderBySql = eventOrderKeys
	.map((key) => `${key.expression} ASC NULLS LAST`)
	.join(",\n\t");

const eventCursorParameter = (index: number) => {
	const parameterIndex = index + 9;
	const kind = eventOrderKeys[index]?.parameterKind;
	if (kind === "timestamp") {
		return `($${parameterIndex}::text)::timestamptz`;
	}
	if (kind === "integer") {
		return `$${parameterIndex}::int`;
	}
	return `$${parameterIndex}::text COLLATE "C"`;
};

const eventCursorPredicate = () =>
	eventOrderKeys
		.map((key, index) => {
			const cursor = eventCursorParameter(index);
			const prefix = eventOrderKeys
				.slice(0, index)
				.map(
					(previousKey, previousIndex) =>
						`${previousKey.expression} IS NOT DISTINCT FROM ${eventCursorParameter(previousIndex)}`,
				);
			const after = `(${cursor} IS NOT NULL AND ${key.expression} IS NULL)
				OR (${cursor} IS NOT NULL AND ${key.expression} IS NOT NULL AND ${key.expression} > ${cursor})`;
			return `(${[...prefix, `(${after})`].join(" AND ")})`;
		})
		.join(" OR ");

const workoutRecordRowsSql = (hasCursor: boolean) => `
SELECT
	ev."id"::text AS "eventId",
	ev."user_id" AS "userId",
	ev."entity_id" AS "entityId",
	ev."session_entity_id" AS "sessionEntityId",
	w."id" AS "workoutId",
	w."user_id" AS "workoutUserId",
	ex."id" AS "exerciseId",
	ex."properties" ->> 'kind' AS "kind",
	w."properties" ->> 'endedAt' AS "endedAt",
	ev."properties" ->> 'confirmedAt' AS "confirmedAt",
	CASE
		WHEN NULLIF(ev."properties" ->> 'confirmedAt', '') IS NOT NULL
			AND pg_input_is_valid(ev."properties" ->> 'confirmedAt', 'timestamp with time zone')
			AND pg_input_is_valid(w."properties" ->> 'startedAt', 'timestamp with time zone')
			AND (
				NULLIF(w."properties" ->> 'endedAt', '') IS NULL
				OR pg_input_is_valid(w."properties" ->> 'endedAt', 'timestamp with time zone')
			)
		THEN
			(ev."properties" ->> 'confirmedAt')::timestamptz
				< (w."properties" ->> 'startedAt')::timestamptz
			OR (
				NULLIF(w."properties" ->> 'endedAt', '') IS NOT NULL
				AND (ev."properties" ->> 'confirmedAt')::timestamptz
					> (w."properties" ->> 'endedAt')::timestamptz
			)
		ELSE false
	END AS "outsideSession",
	ev."occurred_at"::text AS "occurredAtKey",
	w."properties" ->> 'startedAt' AS "workoutStartedAtKey",
	NULLIF(ev."properties" ->> 'exerciseOrder', '')::int AS "exerciseOrderKey",
	NULLIF(ev."properties" ->> 'setOrder', '')::int AS "setOrderKey",
	ev."properties" AS "properties"
FROM "event" ev
LEFT JOIN "entity" w
	ON w."id" = ev."session_entity_id"
	AND w."entity_schema_slug" = $5
	AND w."entity_schema_plugin_id" IS NOT DISTINCT FROM $6
LEFT JOIN "entity" ex
	ON ex."id" = ev."entity_id"
	AND ex."entity_schema_slug" = $7
	AND ex."entity_schema_plugin_id" IS NOT DISTINCT FROM $8
WHERE ev."user_id" = $1
	AND ev."entity_id" = $2
	AND ev."event_schema_slug" = $3
	AND ev."event_schema_plugin_id" IS NOT DISTINCT FROM $4
${hasCursor ? `\tAND (${eventCursorPredicate()})` : ""}
ORDER BY ${eventOrderBySql}
	LIMIT $${hasCursor ? 15 : 9}::int
`;

const updateWorkoutRecordPropertiesSql = `
UPDATE "event" AS event
SET "properties" = (event."properties" - patch."removeKeys") || patch."setProperties"
FROM jsonb_to_recordset($1::jsonb) AS patch("id" text, "removeKeys" text[], "setProperties" jsonb)
WHERE event."id" = patch."id"
RETURNING event."id"
`;

const decodeStreams = Schema.decodeUnknownEffect(Schema.Array(WorkoutStreamSchema));
const decodeWorkoutRecords = Schema.decodeUnknownEffect(Schema.Array(WorkoutRecordRowSchema));

const propertyValues = (properties: WorkoutRecordRow["properties"]) => ({
	reps: properties["reps"],
	weight: properties["weight"],
	duration: properties["duration"],
	distance: properties["distance"],
});

const sameValue = (left: unknown, right: unknown) =>
	left === right ||
	(Array.isArray(left) &&
		Array.isArray(right) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index]));

const buildPropertyPatch = (
	row: WorkoutRecordRow,
	measurements: ReturnType<typeof normalizeWorkoutMeasurements>,
	statistics: ReturnType<typeof calculateWorkoutSetStatistics>,
	personalBests: ReturnType<typeof awardWorkoutPersonalBests>["personalBests"],
) => {
	const recalculated: Record<string, unknown> = {
		personalBests,
		unitSystem: "metric",
		pace: statistics.pace,
		reps: measurements.reps,
		oneRm: statistics.oneRm,
		volume: statistics.volume,
		weight: measurements.weight,
		duration: measurements.duration,
		distance: measurements.distance,
	};
	const removeKeys: Array<string> = [];
	const setProperties: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(recalculated)) {
		if (sameValue(row.properties[key], value)) {
			continue;
		}
		if (value === undefined) {
			if (Object.hasOwn(row.properties, key)) {
				removeKeys.push(key);
			}
		} else {
			setProperties[key] = value;
		}
	}
	return removeKeys.length === 0 && Object.keys(setProperties).length === 0
		? undefined
		: { removeKeys, setProperties, id: row.eventId };
};

const invalidWorkoutRecord = (row: WorkoutRecordRow, reason: string) =>
	new Error(
		`workout sets -> event records: set event ${row.eventId} for user ${row.userId}, exercise ${row.entityId}, and session ${row.sessionEntityId ?? "<missing>"} ${reason}. The record cannot be ordered or recalculated safely. Keep the dump and report this migration defect.`,
	);

const streamEventRows = (
	connection: SqlConnection.Connection,
	stream: WorkoutStream,
	eventSchema: QualifiedSchema,
	workoutEntitySchema: QualifiedSchema,
	exerciseEntitySchema: QualifiedSchema,
	cursor: WorkoutRecordRow | undefined,
) => {
	const query = workoutRecordRowsSql(cursor !== undefined);
	const parameters: ReadonlyArray<unknown> = [
		stream.userId,
		stream.entityId,
		eventSchema.slug,
		eventSchema.pluginId,
		workoutEntitySchema.slug,
		workoutEntitySchema.pluginId,
		exerciseEntitySchema.slug,
		exerciseEntitySchema.pluginId,
		...(cursor
			? [
					cursor.occurredAtKey,
					cursor.workoutStartedAtKey,
					cursor.sessionEntityId,
					cursor.exerciseOrderKey,
					cursor.setOrderKey,
					cursor.eventId,
				]
			: []),
		batchSize,
	];
	return connection.execute(query, parameters, undefined);
};

export const migrateWorkoutRecords = Effect.fn("migrateWorkoutRecords")(function* (
	connection: SqlConnection.Connection,
	schemas: {
		eventSchema: QualifiedSchema;
		workoutEntitySchema: QualifiedSchema;
		exerciseEntitySchema: QualifiedSchema;
	},
) {
	const { eventSchema, workoutEntitySchema, exerciseEntitySchema } = schemas;
	let streamCursor: WorkoutStream | undefined;
	let eventsRead = 0;
	let eventsUpdated = 0;
	let streamsExhausted = false;

	while (!streamsExhausted) {
		const streamRows = yield* connection.execute(
			streamRowsSql,
			[
				streamCursor?.userId ?? null,
				streamCursor?.entityId ?? null,
				eventSchema.slug,
				eventSchema.pluginId,
				batchSize,
			],
			undefined,
		);
		const streams = yield* Effect.orDie(decodeStreams(streamRows));
		if (streams.length === 0) {
			streamsExhausted = true;
			continue;
		}

		for (const stream of streams) {
			let eventCursor: WorkoutRecordRow | undefined;
			let maxima: WorkoutRecordMaxima = {};
			let streamKind: ExerciseKind | undefined;
			let eventsExhausted = false;

			while (!eventsExhausted) {
				const rawRows = yield* streamEventRows(
					connection,
					stream,
					eventSchema,
					workoutEntitySchema,
					exerciseEntitySchema,
					eventCursor,
				);
				const rows = yield* Effect.orDie(decodeWorkoutRecords(rawRows));
				if (rows.length === 0) {
					eventsExhausted = true;
					continue;
				}

				const patches: Array<{
					id: string;
					removeKeys: ReadonlyArray<string>;
					setProperties: Record<string, unknown>;
				}> = [];
				const completionWarnings: Array<MigrationReportDetail> = [];

				for (const row of rows) {
					if (
						row.userId !== stream.userId ||
						row.entityId !== stream.entityId ||
						row.sessionEntityId === null ||
						row.workoutId !== row.sessionEntityId ||
						row.workoutUserId !== row.userId ||
						row.exerciseId !== row.entityId ||
						row.workoutStartedAtKey === null
					) {
						return yield* Effect.die(
							invalidWorkoutRecord(row, "does not match its exercise and workout entities"),
						);
					}
					if (
						!Number.isFinite(Date.parse(row.workoutStartedAtKey)) ||
						(row.endedAt !== null && !Number.isFinite(Date.parse(row.endedAt)))
					) {
						return yield* Effect.die(invalidWorkoutRecord(row, "has an invalid workout interval"));
					}

					const kind = yield* Schema.decodeUnknownEffect(exerciseKindSchema)(row.kind).pipe(
						Effect.mapError(() =>
							invalidWorkoutRecord(
								row,
								`has an unsupported exercise kind ${JSON.stringify(row.kind)}`,
							),
						),
						Effect.orDie,
					);
					if (streamKind !== undefined && kind !== streamKind) {
						return yield* Effect.die(
							invalidWorkoutRecord(row, "changes exercise kind within its stream"),
						);
					}
					streamKind = kind;

					const measurements = yield* Schema.decodeUnknownEffect(WorkoutSetMeasurementsSchema)(
						propertyValues(row.properties),
					).pipe(
						Effect.mapError(() => invalidWorkoutRecord(row, "has invalid measurements")),
						Effect.orDie,
					);
					const normalized = normalizeWorkoutMeasurements(measurements);
					const statistics = calculateWorkoutSetStatistics(kind, normalized);
					const awarded = awardWorkoutPersonalBests(kind, normalized, maxima);
					maxima = awarded.maxima;
					const patch = buildPropertyPatch(row, normalized, statistics, awarded.personalBests);
					if (patch) {
						patches.push(patch);
					}

					if (row.outsideSession) {
						completionWarnings.push({
							userId: row.userId,
							endedAt: row.endedAt,
							setOrder: row.setOrderKey,
							confirmedAt: row.confirmedAt,
							workoutId: row.sessionEntityId,
							startedAt: row.workoutStartedAtKey,
							exerciseOrder: row.exerciseOrderKey,
							code: "workout-set-completion-outside-session",
						});
					}
				}

				if (patches.length > 0) {
					const patchesJson = yield* Schema.encodeEffect(
						Schema.fromJsonString(Schema.Array(WorkoutRecordPropertyPatchSchema)),
					)(patches).pipe(Effect.orDie);
					const updatedRows = yield* connection.execute(
						updateWorkoutRecordPropertiesSql,
						[patchesJson],
						undefined,
					);
					if (updatedRows.length !== patches.length) {
						return yield* Effect.die(
							new Error(
								`workout sets -> event records: expected to patch ${patches.length} set event(s) in one bounded batch, but updated ${updatedRows.length}. Keep the dump and report this migration defect.`,
							),
						);
					}
					eventsUpdated += patches.length;
				}
				if (completionWarnings.length > 0) {
					yield* insertAnomalyReport(connection, {
						phase: reportPhase,
						elapsedSeconds: null,
						details: completionWarnings,
						count: completionWarnings.length,
						code: "workout-set-completion-outside-session",
						message:
							"Some confirmed workout sets occurred outside the recorded workout interval. The original completion times were kept unchanged.",
					});
				}

				eventsRead += rows.length;
				eventCursor = rows.at(-1);
			}
			streamCursor = stream;
		}
	}

	return yield* insertReportRows(connection, [
		{
			count: eventsRead,
			phase: reportPhase,
			elapsedSeconds: null,
			message: "set event(s) examined",
		},
		{
			phase: reportPhase,
			count: eventsUpdated,
			elapsedSeconds: null,
			message: "set event(s) updated",
		},
	]);
});
