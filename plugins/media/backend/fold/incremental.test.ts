import { describe, expect } from "bun:test";

import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldEventChange } from "@ryot-app/plugin-backend-sdk/folds";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import type { FoldEvent, MediaFoldValue } from "./history";
import { applyHistoryChanges } from "./history.test-support";
import { foldMediaHistory, type MediaHistoryReads, normalizedEvent } from "./incremental";

type Subject = { readonly id: string; readonly terminal: boolean; readonly episodic: boolean };

type Store = {
	readonly value: MediaFoldValue;
	readonly history: ReadonlyArray<FoldEvent>;
	readonly contributions: ReadonlyMap<string, unknown>;
};

const empty: Store = { history: [], contributions: new Map(), value: { occurrences: [] } };

const time = (value: string) => Date.parse(value);

/** Answers each read from the current history, the way the subject's RyotQL recipes would. */
const reads = (
	history: ReadonlyArray<FoldEvent>,
	inventory: ReadonlyArray<string>,
	counts: { rows: number },
): MediaHistoryReads<never, never> => {
	const consumption = (event: FoldEvent) =>
		["progress", "complete", "item-complete", "dropped", "on_hold"].includes(event.eventSchemaSlug);
	const counted = (rows: ReadonlyArray<FoldEvent>) =>
		Effect.sync(() => {
			counts.rows += rows.length;
			return rows;
		});
	return {
		history: counted(history),
		inventory: Effect.succeed(inventory),
		since: ({ from, limit, excluded }) =>
			counted(
				history
					.filter(
						(event) =>
							consumption(event) &&
							!excluded.includes(event.id) &&
							time(event.occurredAt) >= time(from),
					)
					.slice(0, limit),
			),
		completions: ({ entityId, until }) =>
			counted(
				history.filter(
					(event) =>
						event.entityId === entityId &&
						event.eventSchemaSlug === "complete" &&
						typeof event.properties["sourceRun"] !== "string" &&
						time(event.occurredAt) <= time(until),
				),
			),
		entity: ({ entityId, from }) =>
			counted(
				history.filter(
					(event) =>
						consumption(event) &&
						event.entityId === entityId &&
						(from === null || time(event.occurredAt) >= time(from)),
				),
			),
		runs: ({ entityId, runs }) =>
			counted(
				history.filter(
					(event) =>
						consumption(event) &&
						event.entityId === entityId &&
						runs.includes(String(event.properties["sourceRun"])),
				),
			),
	};
};

const imagesBetween = (before: ReadonlyArray<FoldEvent>, after: ReadonlyArray<FoldEvent>) => {
	const old = new Map(before.map((event) => [event.id, event]));
	const now = new Map(after.map((event) => [event.id, event]));
	return [...new Set([...old.keys(), ...now.keys()])].sort().flatMap((id) => {
		const previous = old.get(id) ?? null;
		const next = now.get(id) ?? null;
		return JSON.stringify(previous) === JSON.stringify(next)
			? []
			: [Schema.decodeUnknownSync(FoldEventChange)({ before: previous, after: next })];
	});
};

/** One kernel settle: a run, its history changes applied, and the run they cause, which must change nothing. */
const settle = Effect.fnUntraced(function* (
	mode: "full" | "incremental",
	subject: Subject,
	inventory: ReadonlyArray<string>,
	store: Store,
	history: ReadonlyArray<FoldEvent>,
	counts: { rows: number },
) {
	let current = { ...store, history };
	let changes = imagesBetween(store.history, history);
	for (let run = 0; run < 2; run += 1) {
		const output = yield* foldMediaHistory({
			subject,
			previous: current.value,
			changes: mode === "full" ? null : changes,
			reads: reads(current.history, inventory, counts),
		});
		const contributions = new Map(mode === "full" ? [] : current.contributions);
		for (const change of changes) {
			if (mode === "incremental" && change.before && !change.after) {
				contributions.delete(change.before.id);
			}
		}
		for (const { eventId, properties } of output.contributions) {
			contributions.set(eventId, properties);
		}
		const next = applyHistoryChanges(current.history, output.changes);
		changes = imagesBetween(current.history, next);
		current = { contributions, history: next, value: output.value };
		if (output.changes.length === 0) {
			return current;
		}
	}
	return yield* Effect.fail("Fold kept changing its own events");
});

const random = (seed: number) => {
	let state = seed;
	return (limit: number) => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return Math.floor(state / 65536) % limit;
	};
};

type Generator = (next: (limit: number) => number, id: string, at: string) => FoldEvent;

const at = (next: (limit: number) => number, latest: null | string, append: boolean) => {
	const base = latest === null ? Date.UTC(2026, 0, 1) : time(latest);
	return new Date(
		append ? base + (1 + next(3)) * 3_600_000 : Date.UTC(2026, 0, 1) + next(40) * 3_600_000,
	).toISOString();
};

const base = (id: string, occurredAt: string, entity: Pick<FoldEvent, "entityId" | "entitySchemaSlug" | "sessionEntityId">) => ({
	...entity,
	id,
	occurredAt,
	revision: 0,
	orderKey: id,
	orderCreatedAt: occurredAt,
});

const movie: Generator = (next, id, occurredAt) => {
	const slug = (["progress", "progress", "progress", "complete", "dropped", "on_hold"] as const)[next(6)] ?? "progress";
	const run: Record<string, string> = next(4) === 0 ? { sourceRun: `run-${next(2)}` } : {};
	return {
		...base(id, occurredAt, { entityId: "movie", entitySchemaSlug: "movie", sessionEntityId: null }),
		eventSchemaSlug: slug,
		properties: {
			...run,
			consumptionBasis: { unit: "minutes", property: "runtime", total: 120 },
			...(slug === "progress" ? { progressPercent: [30, 60, 100, 100][next(4)] ?? 100 } : {}),
			...(next(3) === 0 ? { timeSpent: 10 * (1 + next(6)) } : {}),
		},
	};
};

const anime: Generator = (next, id, occurredAt) => {
	const slug = (["progress", "progress", "complete"] as const)[next(3)] ?? "progress";
	return {
		...base(id, occurredAt, { entityId: "anime", entitySchemaSlug: "anime", sessionEntityId: null }),
		eventSchemaSlug: slug,
		properties: {
			...(next(5) === 0 ? { sourceRun: "import" } : {}),
			consumptionBasis: { unit: "episodes", property: "episodes", total: 12 },
			...(slug === "progress" ? { position: { unit: "episodes", position: [4, 8, 12][next(3)] ?? 12 } } : {}),
		},
	};
};

const episodes = ["e1", "e2", "e3"];

const show: Generator = (next, id, occurredAt) => {
	const own = next(6) === 0;
	const slug = own ? "complete" : ((["complete", "complete", "progress"] as const)[next(3)] ?? "complete");
	return {
		...base(
			id,
			occurredAt,
			own
				? { entityId: "show", entitySchemaSlug: "show", sessionEntityId: null }
				: { entityId: episodes[next(3)] ?? "e1", entitySchemaSlug: "show-episode", sessionEntityId: "show" },
		),
		eventSchemaSlug: slug,
		properties: {
			consumptionBasis: { unit: "minutes", property: "runtime" },
			...(slug === "progress" ? { progressPercent: [50, 100][next(2)] ?? 100 } : {}),
		},
	};
};

/** Drives the same random appends, past inserts, edits, deletes and completion overrides through both folds. */
const compare = Effect.fnUntraced(function* (input: {
	readonly seed: number;
	readonly steps: number;
	readonly subject: Subject;
	readonly generate: Generator;
	readonly inventory?: ReadonlyArray<string>;
}) {
	const next = random(input.seed);
	const inventory = input.inventory ?? [];
	let full = empty;
	let incremental = empty;
	const counts = { unstable: 0, unsettled: 0, full: { rows: 0 }, incremental: { rows: 0 } };
	for (let index = 0; index < input.steps; index += 1) {
		const history = full.history;
		const latest = history.reduce<null | string>(
			(last, event) => (last === null || time(event.occurredAt) > time(last) ? event.occurredAt : last),
			null,
		);
		const target = history[next(Math.max(history.length, 1))];
		const operation = target === undefined ? 0 : next(6);
		const id = `event-${input.seed}-${index}`;
		let changed: ReadonlyArray<FoldEvent>;
		if (operation <= 1 || target === undefined) {
			changed = [...history, normalizedEvent(input.generate(next, id, at(next, latest, operation === 0)))];
		} else if (operation === 2) {
			changed = history.filter((event) => event.id !== target.id);
		} else if (operation === 3 && typeof target.properties["completionKey"] === "string") {
			changed = history.map((event) =>
				event.id === target.id
					? { ...event, revision: event.revision + 1, properties: { ...event.properties, dateUnknown: true } }
					: event,
			);
		} else {
			const replaced = input.generate(next, target.id, at(next, latest, false));
			changed = history.map((event) =>
				event.id === target.id
					? normalizedEvent({ ...replaced, revision: target.revision + 1 })
					: event,
			);
		}
		const replayed = yield* Effect.result(
			foldMediaHistory({
				changes: null,
				subject: input.subject,
				previous: full.value,
				reads: reads(full.history, inventory, { rows: 0 }),
			}),
		);
		const fixed =
			Result.isSuccess(replayed) &&
			replayed.success.changes.length === 0 &&
			Bun.deepEquals(replayed.success.value, full.value);
		const fullResult = yield* Effect.result(
			settle("full", input.subject, inventory, full, changed, counts.full),
		);
		const incrementalResult = yield* Effect.result(
			settle("incremental", input.subject, inventory, incremental, changed, counts.incremental),
		);
		if (Result.isFailure(fullResult)) {
			counts.unsettled += 1;
			continue;
		}
		if (!fixed) {
			counts.unstable += 1;
			full = fullResult.success;
			incremental = full;
			continue;
		}
		expect(Result.isFailure(incrementalResult)).toBe(false);
		if (Result.isFailure(incrementalResult)) {
			continue;
		}
		full = fullResult.success;
		incremental = incrementalResult.success;
		expect(incremental.history).toEqual(full.history);
		expect(incremental.value).toEqual(full.value);
		expect(incremental.contributions).toEqual(full.contributions);
	}
	return counts;
});

describe("incremental media history", () => {
	it.effect(
		"matches a full replay of a movie over random appends, past edits, deletes and overrides",
		() =>
			Effect.gen(function* () {
				for (const seed of [1, 5, 17, 23, 42, 77, 101, 2026]) {
					const counts = yield* compare({
						seed,
						steps: 60,
						generate: movie,
						subject: { id: "movie", terminal: false, episodic: false },
					});
					expect(counts.unstable + counts.unsettled).toBe(0);
				}
			}),
		testTimeout,
	);

	it.effect(
		"matches a full replay of a positional title whose explicit completions block earlier progress",
		() =>
			Effect.gen(function* () {
				for (const seed of [2, 8, 9, 31, 64, 128, 512]) {
					const counts = yield* compare({
						seed,
						steps: 60,
						generate: anime,
						subject: { id: "anime", terminal: false, episodic: false },
					});
					expect(counts.unstable + counts.unsettled).toBe(0);
				}
			}),
		testTimeout,
	);

	it.effect(
		"matches a full replay of an episodic title's episodes and coverage",
		() =>
			Effect.gen(function* () {
				for (const seed of [3, 11, 28, 47, 89, 300, 4096]) {
					yield* compare({
						seed,
						steps: 50,
						generate: show,
						inventory: episodes,
						subject: { id: "show", terminal: true, episodic: true },
					});
				}
			}),
		testTimeout,
	);

	it.effect(
		"continues an append from the stored run without reading history",
		() =>
			Effect.gen(function* () {
				const subject = { id: "movie", terminal: false, episodic: false };
				const progress = (id: string, hour: number, progressPercent: number) =>
					normalizedEvent({
						...base(id, new Date(Date.UTC(2026, 0, 1, hour)).toISOString(), {
							entityId: "movie",
							entitySchemaSlug: "movie",
							sessionEntityId: null,
						}),
						eventSchemaSlug: "progress",
						properties: {
							progressPercent,
							consumptionBasis: { unit: "minutes", property: "runtime", total: 120 },
						},
					});
				let store = empty;
				for (const [id, hour, percent] of [
					["first", 1, 20],
					["second", 2, 50],
				] as const) {
					store = yield* settle("incremental", subject, [], store, [...store.history, progress(id, hour, percent)], { rows: 0 });
				}
				expect(store.value.tails?.["movie"]?.run.map(({ id }) => id)).toEqual(["first", "second"]);
				const counts = { rows: 0 };
				store = yield* settle("incremental", subject, [], store, [...store.history, progress("third", 3, 70)], counts);
				expect(counts.rows).toBe(0);
				expect([...store.contributions.keys()]).toEqual(["first", "second", "third"]);
			}),
		testTimeout,
	);
});
