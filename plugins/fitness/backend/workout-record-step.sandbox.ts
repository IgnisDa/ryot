import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { EventStreamStepInput, EventStreamStepOutput } from "@ryot-app/sandbox-sdk/event-streams";
import { executeRyotqlRecipe, IsoDateString } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import {
	workoutRecordRowsRecipe,
	type WorkoutRecordRowsResult,
} from "../shared/workout-record-recipes";
import {
	awardWorkoutPersonalBests,
	calculateWorkoutSetStatistics,
	type PersonalBest,
	WorkoutRecordMaximaSchema,
} from "../shared/workout-records";

export const manifest = defineManifest({
	kind: "script",
	name: "Recompute workout records",
	slug: "script.workout-record-step",
});

const checkpointLimit = 16_384;
const pageLimit = 50;

const WorkoutRecordCheckpointSchema = Schema.Struct({
	after: Schema.NullOr(Schema.String),
	lastOccurredAt: Schema.NullOr(IsoDateString),
	phase: Schema.Literals(["normalize", "records", "complete"]),
	maxima: Schema.Record(Schema.String, WorkoutRecordMaximaSchema),
});

type WorkoutRecordCheckpoint = Schema.Schema.Type<typeof WorkoutRecordCheckpointSchema>;
type WorkoutRecordRow = WorkoutRecordRowsResult["items"][number];
type EventStreamStepResult = Schema.Schema.Type<typeof EventStreamStepOutput>;

class WorkoutRecordStepError extends Error {
	readonly _tag = "WorkoutRecordStepError";
}

const initialCheckpoint = (): WorkoutRecordCheckpoint => ({
	maxima: {},
	after: null,
	phase: "normalize",
	lastOccurredAt: null,
});

const nextCursor = (page: {
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}) => (page.pageInfo.hasMore ? page.pageInfo.nextCursor : null);

const normalizePage = (rows: readonly WorkoutRecordRow[]): EventStreamStepResult["updates"] =>
	rows.flatMap((row) => {
		const occurredAt = row.confirmedAt ?? row.workoutStartedAt;
		return row.occurredAt === occurredAt ? [] : [{ eventId: row.id, patch: { occurredAt } }];
	});

const measurementsOf = (row: WorkoutRecordRow) => ({
	reps: row.reps ?? undefined,
	weight: row.weight ?? undefined,
	duration: row.duration ?? undefined,
	distance: row.distance ?? undefined,
});

const sameJsonValue = (left: unknown, right: unknown) =>
	left === right ||
	(Array.isArray(left) &&
		Array.isArray(right) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index]));

const outputProperties = (
	row: WorkoutRecordRow,
	statistics: ReturnType<typeof calculateWorkoutSetStatistics>,
	personalBests: readonly PersonalBest[],
) => {
	const set: Record<string, JsonValue> = {};
	const remove: string[] = [];
	const values = [
		{ key: "oneRm", current: row.oneRm, value: statistics.oneRm },
		{ key: "volume", current: row.volume, value: statistics.volume },
		{ key: "pace", current: row.pace, value: statistics.pace },
		{ key: "personalBests", value: personalBests, current: row.personalBests },
	] as const;
	for (const { key, value, current } of values) {
		if (value === undefined) {
			if (current !== null) {
				remove.push(key);
			}
		} else if (!sameJsonValue(current, value)) {
			set[key] = value;
		}
	}
	return Object.keys(set).length === 0 && remove.length === 0 ? undefined : { set, remove };
};

const recordPage = (
	rows: readonly WorkoutRecordRow[],
	checkpoint: WorkoutRecordCheckpoint,
	dirtyFrom: string | null,
) => {
	const maxima = { ...checkpoint.maxima };
	let lastOccurredAt = checkpoint.lastOccurredAt;
	const updates: Array<EventStreamStepResult["updates"][number]> = [];
	for (const row of rows) {
		const measurements = measurementsOf(row);
		const statistics = calculateWorkoutSetStatistics(row.exerciseKind, measurements);
		const awarded = awardWorkoutPersonalBests(
			row.exerciseKind,
			measurements,
			maxima[row.exerciseKind] ?? {},
		);
		maxima[row.exerciseKind] = awarded.maxima;
		lastOccurredAt = row.occurredAt;
		if (dirtyFrom !== null && row.occurredAt < dirtyFrom) {
			continue;
		}
		const properties = outputProperties(row, statistics, awarded.personalBests);
		if (properties) {
			updates.push({ eventId: row.id, patch: { properties } });
		}
	}
	return { maxima, updates, lastOccurredAt };
};

const makeOutput = (
	done: boolean,
	checkpoint: WorkoutRecordCheckpoint,
	updates: EventStreamStepResult["updates"],
) =>
	Effect.gen(function* () {
		const checkpointJson = yield* Schema.encodeEffect(
			Schema.fromJsonString(WorkoutRecordCheckpointSchema),
		)(checkpoint);
		const checkpointBytes = new TextEncoder().encode(checkpointJson).byteLength;
		if (checkpointBytes > checkpointLimit) {
			return yield* Effect.fail(
				new WorkoutRecordStepError("Workout record checkpoint exceeds 16 KiB"),
			);
		}
		const checkpointValue = yield* Schema.encodeEffect(
			Schema.toCodecJson(WorkoutRecordCheckpointSchema),
		)(checkpoint);
		return yield* Schema.decodeEffect(EventStreamStepOutput)({
			done,
			updates,
			checkpoint: checkpointValue,
		});
	});

export default defineScript({
	manifest,
	input: EventStreamStepInput,
	output: EventStreamStepOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			let checkpoint =
				input.checkpoint === null
					? initialCheckpoint()
					: yield* Schema.decodeUnknownEffect(WorkoutRecordCheckpointSchema)(input.checkpoint);
			if (checkpoint.phase === "complete") {
				const canAppend =
					checkpoint.after !== null &&
					input.dirtyFrom !== null &&
					checkpoint.lastOccurredAt !== null &&
					input.dirtyFrom > checkpoint.lastOccurredAt;
				checkpoint = canAppend ? { ...checkpoint, phase: "records" } : initialCheckpoint();
			}

			const page = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutRecordRowsRecipe({
					limit: pageLimit,
					exerciseId: input.entityId,
					after: checkpoint.after ?? undefined,
					order: checkpoint.phase === "normalize" ? "id" : "records",
				}),
			);
			if (checkpoint.phase === "normalize") {
				const updates = normalizePage(page.items);
				const cursor = nextCursor(page);
				if (page.pageInfo.hasMore && cursor === null) {
					return yield* Effect.fail(
						new WorkoutRecordStepError("Workout record normalization page has no cursor"),
					);
				}
				const nextCheckpoint = page.pageInfo.hasMore
					? { ...checkpoint, after: cursor, phase: "normalize" as const }
					: { ...checkpoint, after: null, phase: "records" as const };
				return yield* makeOutput(false, nextCheckpoint, updates);
			}

			const pageStart = checkpoint;
			const processed = recordPage(page.items, checkpoint, input.dirtyFrom);
			const cursor = nextCursor(page);
			if (page.pageInfo.hasMore && cursor === null) {
				return yield* Effect.fail(new WorkoutRecordStepError("Workout record page has no cursor"));
			}
			const nextCheckpoint: WorkoutRecordCheckpoint = page.pageInfo.hasMore
				? {
						after: cursor,
						phase: "records",
						maxima: processed.maxima,
						lastOccurredAt: processed.lastOccurredAt,
					}
				: {
						phase: "complete",
						after: pageStart.after,
						maxima: pageStart.maxima,
						lastOccurredAt: processed.lastOccurredAt,
					};
			return yield* makeOutput(!page.pageInfo.hasMore, nextCheckpoint, processed.updates);
		}),
});
