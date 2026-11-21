import { describe, expect } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput, FoldOutput } from "@ryot-app/plugin-backend-sdk/folds";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EventId } from "@ryot-app/plugin-kit/schema";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import type { ExerciseKind } from "../shared/exercise-kinds";
import { recordCandidates } from "../shared/workout-records";
import {
	type ExerciseRecordsValue,
	type LaterSetsRequest,
	type RecordSet,
	replayExerciseRecords,
	updateExerciseRecords,
} from "./exercise-records";
import definition, { manifest } from "./exercise-records.sandbox";

const workoutRecord = (id: string, weight: number, occurredAt: string) => ({
	id,
	weight,
	reps: 10,
	occurredAt,
	setOrder: 0,
	duration: null,
	distance: null,
	exerciseOrder: 0,
	startedAt: occurredAt,
	exerciseKind: "reps_and_weight",
	sessionEntityId: `workout-${id}`,
});

const page = (
	items: ReadonlyArray<ReturnType<typeof workoutRecord>>,
	nextCursor: null | string,
) => ({
	items,
	type: "rows" as const,
	pageInfo: { nextCursor, limit: 100, hasMore: nextCursor !== null },
});

it.effect(
	"replays every page of an exercise's sets when the kernel asks for a full replay",
	() =>
		Effect.gen(function* () {
			const calls: RyotQLDocument[] = [];
			const pages = [
				page(
					[
						workoutRecord("set-1", 25, "2026-01-01T00:00:00.000Z"),
						workoutRecord("set-2", 20, "2026-01-02T00:00:00.000Z"),
					],
					"next",
				),
				page([workoutRecord("set-3", 30, "2026-01-03T00:00:00.000Z")], null),
			];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: (document) =>
					Effect.sync(() => {
						const records = pages[calls.length];
						calls.push(bindTestRequest(document));
						return { data: { records } };
					}),
			});
			const input = yield* Schema.decodeEffect(FoldInput)({
				subjects: [{ value: null, absorbed: [], changes: null, subjectEntityId: "exercise-1" }],
			});
			const output = yield* Schema.decodeEffect(FoldOutput)(yield* definition.run(input, host));
			expect(output.subjects.map(({ subjectEntityId }) => subjectEntityId)).toEqual<unknown>([
				"exercise-1",
			]);
			expect(output.subjects[0]?.events).toEqual<unknown>([
				{
					eventId: "set-1",
					properties: {
						volume: 250,
						oneRm: 33.333333,
						personalBests: ["reps", "one_rm", "volume", "weight"],
					},
				},
				{ eventId: "set-2", properties: { volume: 200, oneRm: 26.666667, personalBests: [] } },
				{
					eventId: "set-3",
					properties: { oneRm: 40, volume: 300, personalBests: ["one_rm", "volume", "weight"] },
				},
			]);
			expect(calls.map((document) => document.queries["records"]?.output)).toMatchObject([
				{ pagination: { limit: 100 } },
				{ pagination: { limit: 100, after: "next" } },
			]);
		}),
	testTimeout,
);

type Stored = { value: ExerciseRecordsValue; outputs: Map<string, unknown> };
type HistorySet = RecordSet & { readonly exerciseId: (typeof exercises)[number] };

const exercises = ["bench", "run"] as const;
const kindOf: Record<(typeof exercises)[number], ExerciseKind> = {
	bench: "reps_and_weight",
	run: "distance_and_duration",
};

/** Mirrors the later-sets query: the SQL range is widened by a tolerance and rechecked exactly. */
const laterSets = (
	history: ReadonlyArray<HistorySet>,
	exerciseId: string,
	request: LaterSetsRequest,
) =>
	Effect.succeed(
		history.filter((set) => {
			if (
				set.exerciseId !== exerciseId ||
				Date.parse(set.occurredAt) < Date.parse(request.from) ||
				request.excluded.includes(set.id)
			) {
				return false;
			}
			const candidates = recordCandidates(set.exerciseKind, {
				reps: set.reps ?? undefined,
				weight: set.weight ?? undefined,
				duration: set.duration ?? undefined,
				distance: set.distance ?? undefined,
			});
			return request.bounds.some(({ kind, type, above, atMost }) => {
				const candidate = candidates[type];
				return (
					kind === set.exerciseKind &&
					candidate !== undefined &&
					candidate > above - 0.001 &&
					candidate <= atMost + 0.001
				);
			});
		}),
	);

const replayed = (history: ReadonlyArray<HistorySet>, exerciseId: string): Stored => {
	const result = replayExerciseRecords(history.filter((set) => set.exerciseId === exerciseId));
	return {
		value: result.value,
		outputs: new Map(result.events.map(({ eventId, properties }) => [eventId, properties])),
	};
};

const random = (seed: number) => {
	let state = seed;
	return (limit: number) => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state % limit;
	};
};

const setOf = (
	next: (limit: number) => number,
	id: string,
	exerciseId: (typeof exercises)[number],
) => {
	const day = next(40);
	const occurredAt = new Date(Date.UTC(2026, 0, 1 + day, next(2) * 6)).toISOString();
	const run = exerciseId === "run";
	return {
		exerciseId,
		occurredAt,
		id: EventId.make(id),
		reps: run ? null : 1 + next(12),
		exerciseKind: kindOf[exerciseId],
		distance: run ? 1 + next(6) : null,
		weight: run ? null : 20 + 5 * next(8),
		duration: run ? 10 + 5 * next(6) : null,
		setOrder: next(4) === 0 ? null : next(3),
		startedAt: next(5) === 0 ? null : occurredAt,
		sessionEntityId: `workout-${day}-${next(2)}`,
		exerciseOrder: next(4) === 0 ? null : next(2),
	} satisfies HistorySet;
};

/** Applies a change to the history, then folds each touched exercise incrementally and from scratch. */
const step = Effect.fnUntraced(function* (
	history: Array<HistorySet>,
	stores: Map<string, Stored>,
	change: { readonly after: null | HistorySet; readonly before: null | HistorySet },
) {
	const index = history.findIndex(({ id }) => id === (change.before ?? change.after)?.id);
	if (change.before && index >= 0) {
		history.splice(index, 1);
	}
	if (change.after) {
		history.push(change.after);
	}
	for (const exerciseId of exercises) {
		const before = change.before?.exerciseId === exerciseId ? change.before : null;
		const after = change.after?.exerciseId === exerciseId ? change.after : null;
		if (before === null && after === null) {
			continue;
		}
		const stored = stores.get(exerciseId) ?? replayed([], exerciseId);
		const updated = yield* updateExerciseRecords({
			value: stored.value,
			added: after ? [after] : [],
			retracted: before ? [before] : [],
			later: (request) => laterSets(history, exerciseId, request),
		});
		const outputs = new Map(stored.outputs);
		if (before && !after) {
			outputs.delete(before.id);
		}
		for (const { eventId, properties } of updated.events) {
			outputs.set(eventId, properties);
		}
		const next = { outputs, value: updated.value };
		stores.set(exerciseId, next);
		expect(next).toEqual(replayed(history, exerciseId));
	}
});

const benchSet = (id: string, day: number, weight: number) => ({
	...setOf(() => 1, id, "bench"),
	weight,
	reps: 5,
	setOrder: 0,
	exerciseOrder: 0,
	sessionEntityId: `workout-${day}`,
	startedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
	occurredAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
});

describe("incremental exercise records", () => {
	it.effect(
		"replaces a deleted historical best with the later set that now beats every earlier one",
		() =>
			Effect.gen(function* () {
				const history: Array<HistorySet> = [];
				const stores = new Map<string, Stored>();
				for (const [id, day, weight] of [
					["first", 1, 60],
					["peak", 2, 100],
					["middle", 3, 80],
					["later", 4, 90],
				] as const) {
					yield* step(history, stores, { before: null, after: benchSet(id, day, weight) });
				}
				yield* step(history, stores, { after: null, before: benchSet("peak", 2, 100) });
				expect(stores.get("bench")?.outputs.get("later")).toMatchObject({
					personalBests: ["one_rm", "volume", "weight"],
				});
			}),
		testTimeout,
	);

	it.effect(
		"moves a set's bests to the exercise it moved to",
		() =>
			Effect.gen(function* () {
				const history: Array<HistorySet> = [];
				const stores = new Map<string, Stored>();
				const moved = { ...setOf(random(3), "moved", "bench"), weight: 200 };
				yield* step(history, stores, { before: null, after: setOf(random(1), "kept", "bench") });
				yield* step(history, stores, { before: null, after: moved });
				yield* step(history, stores, {
					before: moved,
					after: { ...moved, exerciseId: "run", exerciseKind: "distance_and_duration" },
				});
				expect(stores.get("bench")?.outputs.has("moved")).toBe(false);
				expect(stores.get("run")?.outputs.has("moved")).toBe(true);
			}),
		testTimeout,
	);

	it.effect(
		"matches a full replay over random appends, edits, deletes and moves",
		() =>
			Effect.gen(function* () {
				for (const seed of [1, 7, 42, 99, 1234, 2026]) {
					const next = random(seed);
					const history: Array<HistorySet> = [];
					const stores = new Map<string, Stored>();
					for (let index = 0; index < 120; index += 1) {
						const existing = history[next(Math.max(history.length, 1))];
						const operation = existing === undefined ? 0 : next(5);
						const exerciseId = exercises[next(2)] ?? "bench";
						if (operation <= 1 || existing === undefined) {
							yield* step(history, stores, {
								before: null,
								after: setOf(next, `set-${seed}-${index}`, exerciseId),
							});
						} else if (operation === 2) {
							yield* step(history, stores, { after: null, before: existing });
						} else if (operation === 3) {
							yield* step(history, stores, {
								before: existing,
								after: { ...setOf(next, existing.id, existing.exerciseId) },
							});
						} else {
							yield* step(history, stores, {
								before: existing,
								after: setOf(next, existing.id, exerciseId),
							});
						}
					}
				}
			}),
		testTimeout,
	);
});
