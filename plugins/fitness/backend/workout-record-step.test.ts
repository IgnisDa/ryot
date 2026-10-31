import { assert, describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { EventStreamBatchInput } from "@ryot-app/plugin-backend-sdk/event-streams";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import definition, { manifest } from "./workout-record-step.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";
const secondsAfterStart = (seconds: number) =>
	DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(timestamp), { seconds }));

const input = (checkpoint: unknown = null, dirtyFrom: null | string = null) =>
	Schema.decodeUnknownEffect(EventStreamBatchInput)({
		eventSchemaSlug: "workout-set",
		streams: [{ dirtyFrom, checkpoint, entityId: "exercise-1" }],
	}).pipe(Effect.orDie);

const workoutRecord = (overrides: Readonly<Record<string, unknown>> = {}) => ({
	reps: 10,
	weight: 25,
	id: "set-1",
	setOrder: 0,
	duration: null,
	distance: null,
	exerciseOrder: 0,
	occurredAt: timestamp,
	sessionId: "workout-1",
	exerciseId: "exercise-1",
	workoutStartedAt: timestamp,
	exerciseKind: "reps_and_weight",
	...overrides,
});

const page = (items: readonly Readonly<Record<string, unknown>>[], hasMore = false) => ({
	items,
	type: "rows" as const,
	pageInfo: { hasMore, limit: 100, nextCursor: hasMore ? "unused" : null },
});

const makeHost = (pages: readonly ReturnType<typeof page>[], calls: RyotQLDocument[] = []) => {
	let nextPage = 0;
	return defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.sync(() => {
				calls.push(document);
				const result = pages[nextPage];
				nextPage += 1;
				if (result === undefined) {
					throw new Error("Unexpected workout record query page");
				}
				return { data: { records: result } };
			}),
	});
};

const run = (
	pages: readonly ReturnType<typeof page>[],
	checkpoint: unknown = null,
	dirtyFrom: null | string = null,
	calls: RyotQLDocument[] = [],
) =>
	Effect.gen(function* () {
		const output = yield* definition.run(
			yield* input(checkpoint, dirtyFrom),
			makeHost(pages, calls),
		);
		const [stream] = output.streams;
		assert(stream);
		return stream;
	});

const seekAfter = (document: undefined | RyotQLDocument) =>
	JSON.stringify(document?.queries["records"]?.where).includes('"operator":"gt"');

describe("workout record step", () => {
	it.effect("uses recorded event times without returning timestamp updates", () =>
		Effect.gen(function* () {
			const calls: RyotQLDocument[] = [];
			const result = yield* run(
				[
					page([
						workoutRecord({
							id: "set-1",
							occurredAt: "2026-01-01T07:00:00.000Z",
							workoutStartedAt: "2026-01-01T08:00:00.000Z",
						}),
						workoutRecord({
							id: "set-2",
							occurredAt: "2026-01-01T08:10:00.000Z",
							workoutStartedAt: "2026-01-01T08:00:00.000Z",
						}),
					]),
				],
				null,
				null,
				calls,
			);
			expect(result.done).toBe(true);
			expect(result.checkpoint).toMatchObject({
				after: null,
				phase: "complete",
				lastOccurredAt: "2026-01-01T08:10:00.000Z",
			});
			expect(result.updates).toEqual([
				{
					eventId: "set-1",
					properties: {
						volume: 250,
						oneRm: 33.333333,
						personalBests: ["reps", "one_rm", "volume", "weight"],
					},
				},
				{ eventId: "set-2", properties: { volume: 250, oneRm: 33.333333, personalBests: [] } },
			]);
			const query = calls[0]?.queries.records;
			assert(query?.output.type === "rows");
			expect(query.output.orderBy[0]?.expr).toMatchObject({ field: "entityId" });
			expect(query.output.orderBy[1]?.expr).toMatchObject({ field: "occurredAt" });
			expect(query.output.orderBy.at(-1)?.expr).toMatchObject({ field: "id" });
			expect(query.output.pagination.limit).toBe(100);
		}),
	);

	it.effect("projects an empty personal-best result", () =>
		Effect.gen(function* () {
			const checkpoint = {
				after: null,
				phase: "records",
				lastOccurredAt: timestamp,
				maxima: { reps_and_weight: { reps: 10, weight: 25, volume: 250, one_rm: 33.333333 } },
			};
			const result = yield* run([page([workoutRecord()])], checkpoint, timestamp);
			expect(result.updates).toEqual([
				{ eventId: "set-1", properties: { volume: 250, oneRm: 33.333333, personalBests: [] } },
			]);
		}),
	);

	it.effect("tracks personal bests separately for each recorded kind", () =>
		Effect.gen(function* () {
			const result = yield* run(
				[
					page([
						workoutRecord({ reps: 10, id: "weighted" }),
						workoutRecord({
							reps: 6,
							weight: null,
							id: "bodyweight",
							exerciseKind: "reps",
							occurredAt: "2026-01-02T08:00:00.000Z",
						}),
					]),
				],
				null,
				timestamp,
			);
			expect(result.updates).toEqual([
				{
					eventId: "weighted",
					properties: {
						volume: 250,
						oneRm: 33.333333,
						personalBests: ["reps", "one_rm", "volume", "weight"],
					},
				},
				{ eventId: "bodyweight", properties: { personalBests: ["reps"] } },
			]);
		}),
	);

	it.effect("omits statistics that are unavailable for the current set", () =>
		Effect.gen(function* () {
			const result = yield* run(
				[page([workoutRecord({ reps: null, weight: null })])],
				null,
				timestamp,
			);
			expect(result.updates).toEqual([{ eventId: "set-1", properties: { personalBests: [] } }]);
		}),
	);

	it.effect("pauses a stream at its update budget and resumes after the last emitted set", () =>
		Effect.gen(function* () {
			const records = Array.from({ length: 150 }, (_, index) =>
				workoutRecord({
					occurredAt: "2026-01-01T07:59:00.000Z",
					id: `set-${String(index).padStart(3, "0")}`,
				}),
			);
			const first = yield* run([page(records.slice(0, 100), true), page(records.slice(100))]);
			expect(first.done).toBe(false);
			expect(first.updates).toHaveLength(100);
			expect(first.updates.every(({ properties }) => !("occurredAt" in properties))).toBe(true);
			expect(first.checkpoint).toMatchObject({ phase: "records", after: { id: "set-099" } });
			const calls: RyotQLDocument[] = [];
			const second = yield* run([page(records.slice(100))], first.checkpoint, null, calls);
			expect(second.done).toBe(true);
			expect(second.updates.map(({ eventId }) => eventId)).toEqual(
				records.slice(100).map(({ id }) => id),
			);
			expect(seekAfter(calls[0])).toBe(true);
		}),
	);

	it.effect("scans a prefix and allows only newer appends to use its tail checkpoint", () =>
		Effect.gen(function* () {
			const prefixRows = Array.from({ length: 50 }, (_, index) =>
				workoutRecord({
					occurredAt: secondsAfterStart(index),
					id: `prefix-${String(index).padStart(2, "0")}`,
				}),
			);
			const targetTime = secondsAfterStart(50);
			const appendedTime = secondsAfterStart(51);
			const target = workoutRecord({ id: "target", occurredAt: targetTime });

			const completed = yield* run([page(prefixRows, true), page([target])], null, targetTime);
			expect(completed.done).toBe(true);
			expect(completed.checkpoint).toMatchObject({
				phase: "complete",
				after: { id: "prefix-49" },
				lastOccurredAt: targetTime,
			});
			expect(completed.updates).toEqual([
				{ eventId: "target", properties: { volume: 250, oneRm: 33.333333, personalBests: [] } },
			]);
			const checkpointJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
				completed.checkpoint,
			);
			expect(new TextEncoder().encode(checkpointJson).byteLength).toBeLessThanOrEqual(16_384);

			const nonAppendCalls: RyotQLDocument[] = [];
			const nonAppend = yield* run([page([])], completed.checkpoint, targetTime, nonAppendCalls);
			expect(nonAppend.done).toBe(true);
			expect(seekAfter(nonAppendCalls[0])).toBe(false);

			const appendCalls: RyotQLDocument[] = [];
			const appended = yield* run(
				[page([target, workoutRecord({ reps: 11, id: "append", occurredAt: appendedTime })])],
				completed.checkpoint,
				appendedTime,
				appendCalls,
			);
			expect(appended.done).toBe(true);
			expect(appended.updates).toEqual([
				{
					eventId: "append",
					properties: {
						volume: 275,
						oneRm: 34.166667,
						personalBests: ["reps", "one_rm", "volume"],
					},
				},
			]);
			expect(seekAfter(appendCalls[0])).toBe(true);
		}),
	);
});
