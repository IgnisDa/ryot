import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { EventStreamStepInput } from "@ryot-app/sandbox-sdk/event-streams";
import type { RyotQLDocument } from "@ryot-app/sandbox-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { assert, describe, expect, it } from "vitest";

import definition, { manifest } from "./workout-record-step.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";

const input = (checkpoint: unknown = null, dirtyFrom: string | null = null) =>
	Schema.decodeUnknownSync(EventStreamStepInput)({
		dirtyFrom,
		checkpoint,
		entityId: "exercise-1",
		eventSchemaSlug: "workout-set",
	});

const workoutRecord = (overrides: Readonly<Record<string, unknown>> = {}) => ({
	reps: 10,
	weight: 25,
	pace: null,
	id: "set-1",
	setOrder: 0,
	volume: 250,
	duration: null,
	distance: null,
	exerciseOrder: 0,
	oneRm: 33.333333,
	confirmedAt: null,
	personalBests: null,
	occurredAt: timestamp,
	sessionId: "workout-1",
	exerciseId: "exercise-1",
	workoutStartedAt: timestamp,
	exerciseKind: "reps_and_weight",
	...overrides,
});

const page = (
	items: readonly Readonly<Record<string, unknown>>[],
	options: { readonly hasMore?: boolean; readonly nextCursor?: string | null } = {},
) => ({
	items,
	type: "rows" as const,
	pageInfo: {
		limit: 50,
		hasMore: options.hasMore ?? false,
		nextCursor: options.nextCursor ?? null,
	},
});

const response = (records: ReturnType<typeof page>) => ({ data: { records } });

const makeHost = (
	pages: readonly ReturnType<typeof page>[],
	calls: RyotQLDocument[] = [],
	writes: unknown[] = [],
) => {
	let nextPage = 0;
	return defineSandboxTestHost(manifest, {
		updateEvents: (updates) =>
			Effect.sync(() => {
				writes.push(updates);
				return { count: updates.length };
			}),
		executeRyotql: (document) =>
			Effect.sync(() => {
				calls.push(document);
				const result = pages[nextPage];
				nextPage += 1;
				if (result === undefined) {
					throw new Error("Unexpected workout record query page");
				}
				return response(result);
			}),
	});
};

describe("workout record step", () => {
	it("normalizes only event time anchors and keeps missing confirmations and rest data intact", () => {
		const calls: RyotQLDocument[] = [];
		const writes: unknown[] = [];
		const host = makeHost(
			[
				page([
					workoutRecord({
						id: "set-1",
						confirmedAt: null,
						occurredAt: "2026-01-01T07:00:00.000Z",
						workoutStartedAt: "2026-01-01T08:00:00.000Z",
					}),
					workoutRecord({
						id: "set-2",
						occurredAt: "2026-01-01T08:10:00.000Z",
						confirmedAt: "2026-01-01T08:30:00.000Z",
						workoutStartedAt: "2026-01-01T08:00:00.000Z",
					}),
				]),
			],
			calls,
			writes,
		);

		return Effect.runPromise(
			definition.run(input(), host).pipe(
				Effect.map((result) => {
					expect(result.done).toBe(false);
					expect(result.checkpoint).toMatchObject({ after: null, phase: "records" });
					expect(result.updates).toEqual([
						{ eventId: "set-1", patch: { occurredAt: "2026-01-01T08:00:00.000Z" } },
						{ eventId: "set-2", patch: { occurredAt: "2026-01-01T08:30:00.000Z" } },
					]);
					expect(writes).toEqual([]);
					const query = calls[0]?.queries.records;
					assert(query?.output.type === "rows");
					expect(query.output.orderBy[0]?.expr).toMatchObject({ field: "id" });
				}),
			),
		);
	});

	it("stores an empty personal-best result instead of removing the property", () => {
		const checkpoint = {
			after: null,
			phase: "records",
			lastOccurredAt: timestamp,
			maxima: { reps_and_weight: { reps: 10, weight: 25, volume: 250, one_rm: 33.333333 } },
		};
		const host = makeHost([page([workoutRecord({ personalBests: ["volume"] })])]);

		return Effect.runPromise(
			definition.run(input(checkpoint, timestamp), host).pipe(
				Effect.map((result) => {
					expect(result.updates).toEqual([
						{ eventId: "set-1", patch: { properties: { remove: [], set: { personalBests: [] } } } },
					]);
				}),
			),
		);
	});

	it("tracks personal bests separately for each recorded kind", () => {
		const host = makeHost([
			page([
				workoutRecord({ reps: 10, id: "weighted", personalBests: [] }),
				workoutRecord({
					reps: 6,
					oneRm: null,
					weight: null,
					volume: null,
					id: "bodyweight",
					personalBests: [],
					exerciseKind: "reps",
					occurredAt: "2026-01-02T08:00:00.000Z",
				}),
			]),
		]);

		return Effect.runPromise(
			definition
				.run(
					input({ maxima: {}, after: null, phase: "records", lastOccurredAt: null }, timestamp),
					host,
				)
				.pipe(
					Effect.map((result) => {
						expect(result.updates).toEqual([
							{
								eventId: "weighted",
								patch: {
									properties: {
										remove: [],
										set: { personalBests: ["reps", "one_rm", "volume", "weight"] },
									},
								},
							},
							{
								eventId: "bodyweight",
								patch: { properties: { remove: [], set: { personalBests: ["reps"] } } },
							},
						]);
					}),
				),
		);
	});

	it("removes stored statistics that are unavailable for the current set", () => {
		const host = makeHost([
			page([
				workoutRecord({
					pace: 0.5,
					reps: null,
					oneRm: 100,
					volume: 100,
					weight: null,
					personalBests: ["volume"],
				}),
			]),
		]);

		return Effect.runPromise(
			definition
				.run(
					input({ maxima: {}, after: null, phase: "records", lastOccurredAt: null }, timestamp),
					host,
				)
				.pipe(
					Effect.map((result) => {
						expect(result.updates).toEqual([
							{
								eventId: "set-1",
								patch: {
									properties: { set: { personalBests: [] }, remove: ["oneRm", "volume", "pace"] },
								},
							},
						]);
					}),
				),
		);
	});

	it("keeps a full fifty-row normalization page within the event update cap", () => {
		const records = Array.from({ length: 50 }, (_, index) =>
			workoutRecord({ id: `set-${index}`, occurredAt: "2026-01-01T07:59:00.000Z" }),
		);
		const calls: RyotQLDocument[] = [];
		const host = makeHost([page(records, { hasMore: true, nextCursor: "cursor-50" })], calls);

		return Effect.runPromise(
			definition
				.run(input({ maxima: {}, after: null, phase: "normalize", lastOccurredAt: null }), host)
				.pipe(
					Effect.map((result) => {
						expect(result.updates).toHaveLength(50);
						expect(new Set(result.updates.map(({ eventId }) => eventId)).size).toBe(50);
						expect(result.checkpoint).toMatchObject({ phase: "normalize", after: "cursor-50" });
						const query = calls[0]?.queries.records;
						assert(query?.output.type === "rows");
						expect(query.output.pagination.limit).toBe(50);
					}),
				),
		);
	});

	it("scans a prefix in fifty-row pages and allows only newer appends to use its tail checkpoint", () => {
		const prefixTime = Array.from({ length: 50 }, (_, index) =>
			new Date(Date.parse(timestamp) + index * 1000).toISOString(),
		);
		const prefixRows = prefixTime.map((occurredAt, index) =>
			workoutRecord({ occurredAt, id: `prefix-${index}` }),
		);
		const targetTime = new Date(Date.parse(timestamp) + 50_000).toISOString();
		const appendedTime = new Date(Date.parse(targetTime) + 1000).toISOString();
		const calls: RyotQLDocument[] = [];
		const writes: unknown[] = [];
		const host = makeHost(
			[
				page(prefixRows, { hasMore: true, nextCursor: "cursor-50" }),
				page([workoutRecord({ id: "target", occurredAt: targetTime, personalBests: ["volume"] })]),
			],
			calls,
			writes,
		);

		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* definition.run(
					input({ maxima: {}, after: null, phase: "records", lastOccurredAt: null }, targetTime),
					host,
				);
				expect(first.done).toBe(false);
				expect(first.updates).toEqual([]);
				expect(first.checkpoint).toMatchObject({ phase: "records", after: "cursor-50" });
				const checkpointJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
					first.checkpoint,
				);
				expect(new TextEncoder().encode(checkpointJson).byteLength).toBeLessThanOrEqual(16_384);

				const completed = yield* definition.run(input(first.checkpoint, targetTime), host);
				expect(completed.done).toBe(true);
				expect(completed.checkpoint).toMatchObject({
					phase: "complete",
					after: "cursor-50",
					lastOccurredAt: targetTime,
				});
				expect(completed.updates).toEqual([
					{ eventId: "target", patch: { properties: { remove: [], set: { personalBests: [] } } } },
				]);
				expect(writes).toEqual([]);
				const nonAppendCalls: RyotQLDocument[] = [];
				const nonAppendHost = makeHost([page([])], nonAppendCalls);
				const nonAppend = yield* definition.run(
					input(completed.checkpoint, targetTime),
					nonAppendHost,
				);
				expect(nonAppend.done).toBe(false);
				const normalizationQuery = nonAppendCalls[0]?.queries.records;
				assert(normalizationQuery?.output.type === "rows");
				expect(normalizationQuery.output.pagination.limit).toBe(50);
				expect(normalizationQuery.output.orderBy[0]?.expr).toMatchObject({ field: "id" });

				const appendCalls: RyotQLDocument[] = [];
				const appendHost = makeHost(
					[
						page([
							workoutRecord({ id: "target", personalBests: null, occurredAt: targetTime }),
							workoutRecord({
								reps: 11,
								oneRm: null,
								id: "append",
								volume: null,
								personalBests: null,
								occurredAt: appendedTime,
							}),
						]),
					],
					appendCalls,
				);
				const appended = yield* definition.run(
					input(completed.checkpoint, appendedTime),
					appendHost,
				);
				expect(appended.done).toBe(true);
				expect(appended.updates).toEqual([
					{
						eventId: "append",
						patch: {
							properties: {
								remove: [],
								set: { volume: 275, oneRm: 34.166667, personalBests: ["reps", "one_rm", "volume"] },
							},
						},
					},
				]);
				const query = appendCalls[0]?.queries.records;
				assert(query?.output.type === "rows");
				expect(query.output.pagination.after).toBe("cursor-50");
				expect(query.output.orderBy[0]?.expr).toMatchObject({ field: "occurredAt" });
				expect(calls).toHaveLength(2);
			}),
		);
	});
});
