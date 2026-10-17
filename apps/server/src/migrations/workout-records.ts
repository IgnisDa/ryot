import type { MigrationReportDetail } from "@ryot-app/contract/modules/instance-admin/migration-report";
import { exerciseKindSchema } from "@ryot-app/fitness-plugin/exercise-kinds";
import {
	normalizeWorkoutMeasurements,
	WorkoutSetMeasurementsSchema,
} from "@ryot-app/fitness-plugin/workout-records";
import {
	eventStreamId,
	StreamKeySchema,
} from "@ryot-app/kernel-backend/modules/events/stream-repository";
import { Clock, Effect, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import type { QualifiedSchema } from "./migration-resolution";
import { insertAnomalyReport, insertReportRows } from "./shared";

const batchSize = 500;
const reportPhase = "workout sets -> event records";

const WorkoutStreamSchema = Schema.Struct({ ...StreamKeySchema.fields, id: Schema.String });

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

type WorkoutRecordRow = typeof WorkoutRecordRowSchema.Type;

const workoutRecordRowsSql = (hasCursor: boolean) => `
SELECT
	ev."id"::text AS "eventId",
	ev."user_id" AS "userId",
	ev."entity_id" AS "entityId",
	ev."session_entity_id" AS "sessionEntityId",
	w."id" AS "workoutId",
	w."user_id" AS "workoutUserId",
	ex."id" AS "exerciseId",
	ev."properties" ->> 'exerciseKind' AS "kind",
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
	w."properties" ->> 'startedAt' AS "workoutStartedAtKey",
	NULLIF(ev."properties" ->> 'exerciseOrder', '')::int AS "exerciseOrderKey",
	NULLIF(ev."properties" ->> 'setOrder', '')::int AS "setOrderKey",
	ev."properties" AS "properties"
FROM "event" ev
LEFT JOIN "entity" w
	ON w."id" = ev."session_entity_id"
	AND w."entity_schema_slug" = $3
	AND w."entity_schema_plugin_id" IS NOT DISTINCT FROM $4
LEFT JOIN "entity" ex
	ON ex."id" = ev."entity_id"
	AND ex."entity_schema_slug" = $5
	AND ex."entity_schema_plugin_id" IS NOT DISTINCT FROM $6
WHERE ev."event_schema_slug" = $1
	AND ev."event_schema_plugin_id" IS NOT DISTINCT FROM $2
${hasCursor ? '\tAND ev."id" COLLATE "C" > $7::text COLLATE "C"' : ""}
ORDER BY ev."id" COLLATE "C"
LIMIT $${hasCursor ? 8 : 7}::int
`;

const insertWorkoutStreamsSql = `
INSERT INTO "event_stream" ("id", "user_id", "entity_id", "event_schema_slug", "event_schema_plugin_id")
SELECT stream."id", stream."userId", stream."entityId", stream."eventSchemaSlug", stream."eventSchemaPluginId"
FROM jsonb_to_recordset($1::jsonb) AS stream(
	"id" text, "userId" text, "entityId" text, "eventSchemaSlug" text, "eventSchemaPluginId" text
)
ON CONFLICT DO NOTHING
`;

const updateWorkoutRecordPropertiesSql = `
UPDATE "event" AS event
SET "properties" = (event."properties" - patch."removeKeys") || patch."setProperties"
FROM jsonb_to_recordset($1::jsonb) AS patch("id" text, "removeKeys" text[], "setProperties" jsonb)
WHERE event."id" = patch."id"
RETURNING event."id"
`;

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
) => {
	const recalculated: Record<string, unknown> = {
		pace: undefined,
		oneRm: undefined,
		volume: undefined,
		reps: measurements.reps,
		personalBests: undefined,
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

export const migrateWorkoutRecords = Effect.fn("migrateWorkoutRecords")(function* (
	connection: SqlConnection.Connection,
	schemas: {
		eventSchema: QualifiedSchema;
		workoutEntitySchema: QualifiedSchema;
		exerciseEntitySchema: QualifiedSchema;
	},
) {
	const startedAt = yield* Clock.currentTimeMillis;
	const { eventSchema, workoutEntitySchema, exerciseEntitySchema } = schemas;
	let eventCursor: string | undefined;
	let eventsRead = 0;
	let eventsUpdated = 0;

	for (;;) {
		const rawRows = yield* connection.execute(
			workoutRecordRowsSql(eventCursor !== undefined),
			[
				eventSchema.slug,
				eventSchema.pluginId,
				workoutEntitySchema.slug,
				workoutEntitySchema.pluginId,
				exerciseEntitySchema.slug,
				exerciseEntitySchema.pluginId,
				...(eventCursor === undefined ? [] : [eventCursor]),
				batchSize,
			],
			undefined,
		);
		const rows = yield* Effect.orDie(decodeWorkoutRecords(rawRows));
		if (rows.length === 0) {
			break;
		}

		const streams = new Map<string, typeof WorkoutStreamSchema.Type>();
		for (const row of rows) {
			const key = yield* Schema.decodeEffect(StreamKeySchema)({
				userId: row.userId,
				entityId: row.entityId,
				eventSchemaSlug: eventSchema.slug,
				eventSchemaPluginId: eventSchema.pluginId,
			}).pipe(Effect.orDie);
			const id = eventStreamId(key);
			streams.set(id, { ...key, id });
		}
		const streamsJson = yield* Schema.encodeEffect(
			Schema.fromJsonString(Schema.Array(WorkoutStreamSchema)),
		)([...streams.values()]).pipe(Effect.orDie);
		yield* connection.execute(insertWorkoutStreamsSql, [streamsJson], undefined);

		const patches: Array<{
			id: string;
			removeKeys: ReadonlyArray<string>;
			setProperties: Record<string, unknown>;
		}> = [];
		const completionWarnings: Array<MigrationReportDetail> = [];

		for (const row of rows) {
			if (
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

			yield* Schema.decodeUnknownEffect(exerciseKindSchema)(row.kind).pipe(
				Effect.mapError(() =>
					invalidWorkoutRecord(row, `has an unsupported exercise kind ${JSON.stringify(row.kind)}`),
				),
				Effect.orDie,
			);

			const measurements = yield* Schema.decodeUnknownEffect(WorkoutSetMeasurementsSchema)(
				propertyValues(row.properties),
			).pipe(
				Effect.mapError(() => invalidWorkoutRecord(row, "has invalid measurements")),
				Effect.orDie,
			);
			const normalized = normalizeWorkoutMeasurements(measurements);
			const patch = buildPropertyPatch(row, normalized);
			if (patch) {
				patches.push(patch);
			}

			if (row.outsideSession) {
				const exerciseOrder = row.exerciseOrderKey?.toString() ?? null;
				const setOrder = row.setOrderKey?.toString() ?? null;
				completionWarnings.push({
					key: `${row.sessionEntityId}:${exerciseOrder}:${setOrder}`,
					label: `Workout ${row.sessionEntityId} — exercise ${exerciseOrder ?? "unknown"}, set ${setOrder ?? "unknown"}`,
					sentence:
						"This set's completion timestamp falls outside the recorded workout interval. Its original completion time was kept unchanged.",
					provenance: [
						{ key: "Workout", value: row.sessionEntityId },
						{ key: "User", value: row.userId },
						{ value: exerciseOrder, key: "Exercise order" },
						{ value: setOrder, key: "Set order" },
						{ key: "Confirmed at", value: row.confirmedAt },
						{ key: "Started at", value: row.workoutStartedAtKey },
						{ key: "Ended at", value: row.endedAt },
					],
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
		eventCursor = rows.at(-1)?.eventId;
	}

	const elapsedSeconds = ((yield* Clock.currentTimeMillis) - startedAt) / 1000;
	return yield* insertReportRows(connection, [
		{ elapsedSeconds, count: eventsRead, phase: reportPhase, message: "set event(s) examined" },
		{ elapsedSeconds, phase: reportPhase, count: eventsUpdated, message: "set event(s) updated" },
	]);
});
