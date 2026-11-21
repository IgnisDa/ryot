import { describe, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldEventChange, FoldResult } from "@ryot-app/plugin-backend-sdk/folds";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import type { FoldEvent, MediaFoldValue } from "./history";
import { applyHistoryChanges } from "./history.test-support";
import { foldMediaHistory, type MediaHistoryReads, normalizedEvent } from "./incremental";

type Subject = {
	readonly id: string;
	readonly terminal: boolean;
	readonly episodic: boolean;
	readonly entitySchemaSlug: string;
};

type Store = {
	readonly value: MediaFoldValue;
	readonly history: ReadonlyArray<FoldEvent>;
	readonly contributions: ReadonlyMap<string, unknown>;
};

const empty: Store = { history: [], contributions: new Map(), value: { occurrences: [] } };

const time = (value: string) => Date.parse(value);

const consumption = (event: FoldEvent) =>
	["dropped", "on_hold", "progress", "complete", "item-complete"].includes(event.eventSchemaSlug);

/** Answers each read from the current history, the way the subject's RyotQL recipes would. */
const reads = (
	history: ReadonlyArray<FoldEvent>,
	inventory: ReadonlyArray<string>,
	counts: { rows: number },
): MediaHistoryReads<never, never> => {
	const counted = (rows: ReadonlyArray<FoldEvent>) =>
		Effect.sync(() => {
			counts.rows += rows.length;
			return rows;
		});
	return {
		history: counted(history),
		inventory: Effect.succeed(inventory),
		runs: ({ runs, entityId }) =>
			counted(
				history.filter(
					(event) =>
						consumption(event) &&
						event.entityId === entityId &&
						runs.some((run) => run === event.properties["sourceRun"]),
				),
			),
		entity: ({ from, entityId }) =>
			counted(
				history.filter(
					(event) =>
						consumption(event) &&
						event.entityId === entityId &&
						(from === null || time(event.occurredAt) >= time(from)),
				),
			),
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
		completions: ({ until, entityId }) =>
			counted(
				history.filter(
					(event) =>
						event.entityId === entityId &&
						event.eventSchemaSlug === "complete" &&
						typeof event.properties["sourceRun"] !== "string" &&
						time(event.occurredAt) <= time(until),
				),
			),
	};
};

const imagesBetween = (before: ReadonlyArray<FoldEvent>, after: ReadonlyArray<FoldEvent>) => {
	const old = new Map(before.map((event) => [event.id, event]));
	const now = new Map(after.map((event) => [event.id, event]));
	const ids = [...new Set([...old.keys(), ...now.keys()])].sort();
	return Effect.forEach(
		ids.filter((id) => !Bun.deepEquals(old.get(id) ?? null, now.get(id) ?? null)),
		(id) =>
			Schema.decodeEffect(FoldEventChange)({
				after: now.get(id) ?? null,
				before: old.get(id) ?? null,
			}),
	);
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
	let changes: ReadonlyArray<FoldEventChange> = yield* imagesBetween(store.history, history);
	for (let run = 0; run < 2; run += 1) {
		const output = yield* foldMediaHistory({
			subject,
			previous: current.value,
			changes: mode === "full" ? null : changes,
			reads: reads(current.history, inventory, counts),
		});
		yield* Schema.decodeUnknownEffect(FoldResult)({
			value: null,
			relationships: [],
			changes: output.changes,
			events: output.contributions,
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
		const next = applyHistoryChanges(current.history, output.changes, subject.entitySchemaSlug);
		changes = yield* imagesBetween(current.history, next);
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

const base = (
	id: string,
	occurredAt: string,
	entity: Pick<FoldEvent, "entityId" | "sessionEntityId" | "entitySchemaSlug">,
) => ({ ...entity, id, occurredAt, revision: 0, orderKey: id, orderCreatedAt: occurredAt });

const movie: Generator = (next, id, occurredAt) => {
	const slug =
		(["progress", "progress", "progress", "complete", "dropped", "on_hold"] as const)[next(6)] ??
		"progress";
	const run: Record<string, string> = next(4) === 0 ? { sourceRun: `run-${next(2)}` } : {};
	return {
		...base(id, occurredAt, {
			entityId: "movie",
			sessionEntityId: null,
			entitySchemaSlug: "movie",
		}),
		eventSchemaSlug: slug,
		properties: {
			...run,
			consumptionBasis: { total: 120, unit: "minutes", property: "runtime" },
			...(slug === "progress" ? { progressPercent: [30, 60, 100, 100][next(4)] ?? 100 } : {}),
			...(next(3) === 0 ? { timeSpent: 10 * (1 + next(6)) } : {}),
		},
	};
};

const anime: Generator = (next, id, occurredAt) => {
	const slug = (["progress", "progress", "complete"] as const)[next(3)] ?? "progress";
	return {
		...base(id, occurredAt, {
			entityId: "anime",
			sessionEntityId: null,
			entitySchemaSlug: "anime",
		}),
		eventSchemaSlug: slug,
		properties: {
			...(next(5) === 0 ? { sourceRun: "import" } : {}),
			consumptionBasis: { total: 12, unit: "episodes", property: "episodes" },
			...(slug === "progress"
				? { position: { unit: "episodes", position: [4, 8, 12][next(3)] ?? 12 } }
				: {}),
		},
	};
};

const episodic =
	(parent: string, episodes: ReadonlyArray<string>): Generator =>
	(next, id, occurredAt) => {
		const own = next(6) === 0;
		const slug = own
			? "complete"
			: ((["complete", "complete", "progress"] as const)[next(3)] ?? "complete");
		return {
			...base(
				id,
				occurredAt,
				own
					? { entityId: parent, sessionEntityId: null, entitySchemaSlug: parent }
					: {
							sessionEntityId: parent,
							entitySchemaSlug: `${parent}-episode`,
							entityId: episodes[next(episodes.length)] ?? parent,
						},
			),
			eventSchemaSlug: slug,
			properties: {
				consumptionBasis: { unit: "minutes", property: "runtime" },
				...(slug === "progress" ? { progressPercent: [50, 100][next(2)] ?? 100 } : {}),
				...(next(4) === 0 ? { consumedOn: [["Netflix"], ["Plex"]][next(2)] ?? [] } : {}),
			},
		};
	};

const showEpisodes = ["e1", "e2", "e3"];

const podcastEpisodes = ["p1", "p2", "p3", "p4"];

const movieProgress = (id: string, hour: number, progressPercent: number) =>
	normalizedEvent({
		...base(id, new Date(Date.UTC(2026, 0, 1, hour)).toISOString(), {
			entityId: "movie",
			sessionEntityId: null,
			entitySchemaSlug: "movie",
		}),
		eventSchemaSlug: "progress",
		properties: {
			progressPercent,
			consumptionBasis: { total: 120, unit: "minutes", property: "runtime" },
		},
	});

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
	let full = yield* settle("full", input.subject, inventory, empty, [], { rows: 0 });
	let incremental = full;
	for (let index = 0; index < input.steps; index += 1) {
		const history = full.history;
		const latest = history.reduce<null | string>(
			(last, event) =>
				last === null || time(event.occurredAt) > time(last) ? event.occurredAt : last,
			null,
		);
		const target = history[next(Math.max(history.length, 1))];
		const operation = target === undefined ? 0 : next(6);
		const id = `event-${input.seed}-${String(index).padStart(3, "0")}`;
		let changed: ReadonlyArray<FoldEvent>;
		if (operation <= 1 || target === undefined) {
			changed = [
				...history,
				normalizedEvent(input.generate(next, id, at(next, latest, operation === 0))),
			];
		} else if (operation === 2) {
			changed = history.filter((event) => event.id !== target.id);
		} else if (operation === 3 && typeof target.properties["completionKey"] === "string") {
			changed = history.map((event) =>
				event.id === target.id
					? {
							...event,
							revision: event.revision + 1,
							properties: { ...event.properties, dateUnknown: true },
						}
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
		const replayed = yield* foldMediaHistory({
			changes: null,
			previous: full.value,
			subject: input.subject,
			reads: reads(full.history, inventory, { rows: 0 }),
		});
		expect(replayed.changes).toEqual([]);
		expect(replayed.value).toEqual(full.value);
		full = yield* settle("full", input.subject, inventory, full, changed, { rows: 0 });
		incremental = yield* settle("incremental", input.subject, inventory, incremental, changed, {
			rows: 0,
		});
		expect(incremental.history).toEqual(full.history);
		expect(incremental.value).toEqual(full.value);
		expect(incremental.contributions).toEqual(full.contributions);
	}
});

const seeds = Array.from({ length: 40 }, (_, index) => index + 1);

describe("incremental media history", () => {
	it.effect.each([
		{
			kind: "a movie",
			generate: movie,
			subject: { id: "movie", terminal: false, episodic: false, entitySchemaSlug: "movie" },
		},
		{
			generate: anime,
			kind: "a positional title whose explicit completions block earlier progress",
			subject: { id: "anime", terminal: false, episodic: false, entitySchemaSlug: "anime" },
		},
		{
			inventory: showEpisodes,
			kind: "a show's episodes and coverage",
			generate: episodic("show", showEpisodes),
			subject: { id: "show", terminal: true, episodic: true, entitySchemaSlug: "show" },
		},
		{
			inventory: podcastEpisodes,
			kind: "a podcast's episodes and coverage",
			generate: episodic("podcast", podcastEpisodes),
			subject: { id: "podcast", terminal: true, episodic: true, entitySchemaSlug: "podcast" },
		},
	])(
		"settles and matches a full replay of $kind over random appends, past edits, deletes and overrides",
		(input) =>
			Effect.forEach(seeds, (seed) => compare({ ...input, seed, steps: 60 }), { discard: true }),
		testTimeout,
	);

	it.effect(
		"continues an append from the stored run without reading history",
		() =>
			Effect.gen(function* () {
				const subject = {
					id: "movie",
					terminal: false,
					episodic: false,
					entitySchemaSlug: "movie",
				};
				let store = empty;
				for (const [id, hour, percent] of [
					["first", 1, 20],
					["second", 2, 50],
				] as const) {
					store = yield* settle(
						"incremental",
						subject,
						[],
						store,
						[...store.history, movieProgress(id, hour, percent)],
						{ rows: 0 },
					);
				}
				expect(store.value.tails?.["movie"]?.run.map(({ id }) => id)).toEqual(["first", "second"]);
				const counts = { rows: 0 };
				store = yield* settle(
					"incremental",
					subject,
					[],
					store,
					[...store.history, movieProgress("third", 3, 70)],
					counts,
				);
				expect(counts.rows).toBe(0);
				expect([...store.contributions.keys()]).toEqual(["first", "second", "third"]);
			}),
		testTimeout,
	);
});
