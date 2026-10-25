import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	EVENT_STREAM_BATCH_LIMITS,
	EventStreamBatchInput,
	EventStreamBatchOutput,
} from "@ryot-app/plugin-backend-sdk/event-streams";
import { executeRyotqlRecipe, IsoDateString } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	workoutRecordBatchRecipe,
	type WorkoutRecordBatchResult,
	WorkoutRecordPosition,
} from "../shared/workout-record-recipes";
import {
	awardWorkoutPersonalBests,
	calculateWorkoutSetStatistics,
	WorkoutRecordMaximaSchema,
} from "../shared/workout-records";

export const manifest = defineManifest({
	kind: "script",
	name: "Recompute workout records",
	slug: "script.workout-record-step",
});

const roundsPerBatch = 20;
const updatesPerStream = 100;

const WorkoutRecordCheckpointSchema = Schema.Struct({
	after: Schema.NullOr(WorkoutRecordPosition),
	lastOccurredAt: Schema.NullOr(IsoDateString),
	phase: Schema.Literals(["records", "complete"]),
	maxima: Schema.Record(Schema.String, WorkoutRecordMaximaSchema),
});

type WorkoutRecordRow = WorkoutRecordBatchResult["items"][number];
type StreamOutput = (typeof EventStreamBatchOutput.Type)["streams"][number];
type WorkoutRecordCheckpoint = Schema.Schema.Type<typeof WorkoutRecordCheckpointSchema>;
type Stream = {
	done: boolean;
	readonly dirtyFrom: null | string;
	checkpoint: WorkoutRecordCheckpoint;
	readonly entityId: StreamOutput["entityId"];
	readonly updates: Array<StreamOutput["updates"][number]>;
};

const initialCheckpoint = (): WorkoutRecordCheckpoint => ({
	maxima: {},
	after: null,
	phase: "records",
	lastOccurredAt: null,
});

const resumeCheckpoint = (checkpoint: WorkoutRecordCheckpoint, dirtyFrom: null | string) => {
	if (checkpoint.phase === "records") {
		return checkpoint;
	}
	const canAppend =
		checkpoint.after !== null &&
		dirtyFrom !== null &&
		checkpoint.lastOccurredAt !== null &&
		dirtyFrom > checkpoint.lastOccurredAt;
	return canAppend ? { ...checkpoint, phase: "records" as const } : initialCheckpoint();
};

const measurementsOf = (row: WorkoutRecordRow) => ({
	reps: row.reps ?? undefined,
	weight: row.weight ?? undefined,
	duration: row.duration ?? undefined,
	distance: row.distance ?? undefined,
});

const positionOf = (row: WorkoutRecordRow) => ({
	id: row.id,
	setOrder: row.setOrder,
	sessionId: row.sessionId,
	occurredAt: row.occurredAt,
	exerciseOrder: row.exerciseOrder,
	workoutStartedAt: row.workoutStartedAt,
});

const advanceStream = (
	stream: Stream,
	rows: ReadonlyArray<WorkoutRecordRow>,
	ended: boolean,
	budget: { remaining: number },
) => {
	const start = stream.checkpoint;
	const maxima = { ...start.maxima };
	let after = start.after;
	let lastOccurredAt = start.lastOccurredAt;
	for (const row of rows) {
		const emits = stream.dirtyFrom === null || row.occurredAt >= stream.dirtyFrom;
		if (emits && (stream.updates.length >= updatesPerStream || budget.remaining <= 0)) {
			stream.checkpoint = { after, maxima, lastOccurredAt, phase: "records" };
			stream.done = false;
			return false;
		}
		const measurements = measurementsOf(row);
		const statistics = calculateWorkoutSetStatistics(row.exerciseKind, measurements);
		const awarded = awardWorkoutPersonalBests(
			row.exerciseKind,
			measurements,
			maxima[row.exerciseKind] ?? {},
		);
		maxima[row.exerciseKind] = awarded.maxima;
		lastOccurredAt = row.occurredAt;
		after = positionOf(row);
		if (emits) {
			stream.updates.push({
				eventId: row.id,
				properties: { ...statistics, personalBests: [...awarded.personalBests] },
			});
			budget.remaining -= 1;
		}
	}
	stream.done = ended;
	stream.checkpoint = ended
		? { lastOccurredAt, phase: "complete", after: start.after, maxima: start.maxima }
		: { after, maxima, lastOccurredAt, phase: "records" };
	return !ended;
};

export default defineScript({
	manifest,
	input: EventStreamBatchInput,
	output: EventStreamBatchOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const streams: Array<Stream> = yield* Effect.forEach(input.streams, (stream) =>
				Effect.gen(function* () {
					const checkpoint =
						stream.checkpoint === null
							? initialCheckpoint()
							: yield* Schema.decodeUnknownEffect(WorkoutRecordCheckpointSchema)(stream.checkpoint);
					return {
						done: false,
						updates: [],
						entityId: stream.entityId,
						dirtyFrom: stream.dirtyFrom,
						checkpoint: resumeCheckpoint(checkpoint, stream.dirtyFrom),
					};
				}),
			);
			let active = streams;
			const budget = { remaining: EVENT_STREAM_BATCH_LIMITS.updates };
			for (let round = 0; round < roundsPerBatch && active.length > 0; round += 1) {
				if (budget.remaining <= 0) {
					break;
				}
				const page = yield* executeRyotqlRecipe(
					host.executeRyotql,
					workoutRecordBatchRecipe({
						reference: { kind: "self" },
						streams: active.map(({ entityId, checkpoint }) => ({
							exerciseId: entityId,
							after: checkpoint.after,
						})),
					}),
				);
				const partial = page.pageInfo.hasMore ? page.items.at(-1)?.exerciseId : undefined;
				active = active.filter((stream) => {
					const own = page.items.filter((row) => row.exerciseId === stream.entityId);
					if (page.pageInfo.hasMore && own.length === 0) {
						return true;
					}
					return advanceStream(stream, own, partial !== stream.entityId, budget);
				});
			}
			return {
				streams: yield* Effect.forEach(streams, (stream) =>
					Effect.gen(function* () {
						return {
							done: stream.done,
							updates: stream.updates,
							entityId: stream.entityId,
							checkpoint: yield* Schema.encodeEffect(
								Schema.toCodecJson(WorkoutRecordCheckpointSchema),
							)(stream.checkpoint),
						};
					}),
				),
			};
		}),
});
