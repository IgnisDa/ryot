import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import {
	absorbFoldValues,
	deriveHistory,
	type FoldEvent,
	type HistoryChange,
	type MediaFoldValue,
} from "./history";

const basis = { total: 120, unit: "minutes", property: "runtime" };

const event = (
	id: string,
	overrides: Partial<FoldEvent> & Pick<FoldEvent, "eventSchemaSlug">,
): FoldEvent => ({
	id,
	revision: 0,
	orderKey: id,
	entityId: "movie",
	sessionEntityId: null,
	entitySchemaSlug: "movie",
	occurredAt: "2026-01-01T12:00:00.000Z",
	properties: { consumptionBasis: basis },
	orderCreatedAt: "2026-01-01T12:00:00.000Z",
	...overrides,
});

const apply = (events: ReadonlyArray<FoldEvent>, changes: ReadonlyArray<HistoryChange>) => {
	let next = [...events];
	const byId = (id: string) => {
		const found = next.find((value) => value.id === id);
		assert(found);
		return found;
	};
	for (const change of changes) {
		if (change.kind === "delete") {
			next = next.filter(({ id }) => id !== change.eventId);
		} else if (change.kind === "create") {
			const anchor = byId(change.item.orderAfter.eventId);
			next.push({
				revision: 0,
				eventSchemaSlug: "complete",
				id: `derived-${next.length}`,
				entityId: change.item.entityId,
				occurredAt: change.item.occurredAt,
				properties: change.item.properties,
				orderCreatedAt: anchor.orderCreatedAt,
				sessionEntityId: change.item.sessionEntityId ?? null,
				orderKey: `${anchor.orderKey}~${change.item.orderAfter.suffix}`,
				entitySchemaSlug:
					change.item.entityId === anchor.entityId ? anchor.entitySchemaSlug : "show",
			});
		} else {
			const current = byId(change.item.eventId);
			const { patch } = change.item;
			const anchor = patch.orderAfter === null ? null : byId(patch.orderAfter.eventId);
			const properties = Object.fromEntries(
				Object.entries({ ...current.properties, ...patch.properties.set }).filter(
					([key]) => !patch.properties.remove.includes(key),
				),
			);
			next = next.map((value) =>
				value.id === current.id
					? {
							...current,
							properties,
							revision: current.revision + 1,
							occurredAt: patch.occurredAt ?? current.occurredAt,
							orderCreatedAt: anchor?.orderCreatedAt ?? current.orderCreatedAt,
							orderKey:
								anchor === null ? current.id : `${anchor.orderKey}~${patch.orderAfter?.suffix}`,
						}
					: value,
			);
		}
	}
	return next;
};

type Subject = { readonly id: string; readonly terminal: boolean; readonly episodic: boolean };

const movie: Subject = { id: "movie", terminal: false, episodic: false };

const fold = (
	events: ReadonlyArray<FoldEvent>,
	previous: MediaFoldValue = { occurrences: [] },
	subject: Subject = movie,
	inventory: ReadonlyArray<string> = [],
	renamedKeys?: ReadonlyMap<string, string>,
) =>
	Effect.gen(function* () {
		const input = { subject, inventory: Effect.succeed(inventory) };
		const first = yield* deriveHistory({
			...input,
			events,
			previous,
			...(renamedKeys ? { renamedKeys } : {}),
		});
		const settled = apply(events, first.changes);
		const second = yield* deriveHistory({ ...input, events: settled, previous: first.value });
		expect(second.changes).toEqual([]);
		return { events: settled, value: second.value, changes: first.changes };
	});

const completions = (events: ReadonlyArray<FoldEvent>) =>
	events.filter(({ eventSchemaSlug }) => eventSchemaSlug === "complete");

const show: Subject = { id: "show", terminal: true, episodic: true };
const episode = (
	id: string,
	slug: "complete" | "progress",
	occurredAt: string,
	consumedOn?: ReadonlyArray<string>,
) =>
	event(`${slug}-${id}`, {
		occurredAt,
		entityId: id,
		eventSchemaSlug: slug,
		sessionEntityId: "show",
		orderCreatedAt: occurredAt,
		entitySchemaSlug: "show-episode",
		properties: {
			consumptionBasis: { unit: "minutes", property: "runtime" },
			...(slug === "progress" ? { progressPercent: 100 } : {}),
			...(consumedOn === undefined ? {} : { consumedOn }),
		},
	});

describe("media history fold", () => {
	it.effect(
		"completes a manga when a volume position reaches its volume total, never by chapters",
		() =>
			Effect.gen(function* () {
				const manga = { id: "manga", terminal: false, episodic: false };
				const progress = (id: string, unit: "volumes" | "chapters", position: number) =>
					event(id, {
						entityId: "manga",
						entitySchemaSlug: "manga",
						eventSchemaSlug: "progress",
						properties: {
							position: { unit, position },
							consumptionBasis: { unit, property: unit, total: unit === "volumes" ? 12 : 120 },
						},
					});
				const partial = yield* fold([progress("vol-11", "volumes", 11)], undefined, manga);
				expect(completions(partial.events)).toEqual([]);
				const done = yield* fold([progress("vol-12", "volumes", 12)], undefined, manga);
				expect(completions(done.events)).toMatchObject([
					{ properties: { consumptionBasis: { total: 12, unit: "volumes" } } },
				]);
				const mismatched = yield* fold(
					[
						event("vol-as-chapters", {
							entityId: "manga",
							entitySchemaSlug: "manga",
							eventSchemaSlug: "progress",
							properties: {
								position: { position: 130, unit: "volumes" },
								consumptionBasis: { total: 120, unit: "chapters", property: "chapters" },
							},
						}),
					],
					undefined,
					manga,
				);
				expect(completions(mismatched.events)).toEqual([]);
			}),
		testTimeout,
	);
	it.effect(
		"completes progress that reaches its total and repairs it when the source moves",
		() =>
			Effect.gen(function* () {
				const progress = event("progress-1", {
					eventSchemaSlug: "progress",
					properties: {
						progressPercent: 100,
						consumptionBasis: basis,
						consumedOn: ["Netflix", "Plex"],
					},
				});
				const first = yield* fold([progress]);
				expect(completions(first.events)).toMatchObject([
					{
						entityId: "movie",
						orderKey: "progress-1~complete",
						occurredAt: progress.occurredAt,
						properties: {
							consumptionBasis: basis,
							completionSilent: false,
							consumedOn: ["Netflix", "Plex"],
							completionKey: "progress:progress-1",
						},
					},
				]);
				const moved = first.events.map((value) =>
					value.id === progress.id
						? { ...value, revision: 1, occurredAt: "2026-01-02T12:00:00.000Z" }
						: value,
				);
				const second = yield* fold(moved, first.value);
				expect(second.changes.map(({ kind }) => kind)).toEqual(["update"]);
				expect(completions(second.events)).toMatchObject([
					{ occurredAt: "2026-01-02T12:00:00.000Z" },
				]);
			}),
		testTimeout,
	);

	it.effect(
		"keeps a deleted automatic completion suppressed and an edited one explicit",
		() =>
			Effect.gen(function* () {
				const progress = event("progress-1", {
					eventSchemaSlug: "progress",
					properties: { progressPercent: 100, consumptionBasis: basis },
				});
				const completed = yield* fold([progress]);
				const [derived] = completions(completed.events);
				assert(derived);

				const deleted = yield* fold(
					completed.events.filter(({ id }) => id !== derived.id),
					completed.value,
				);
				expect(deleted.changes).toEqual([]);
				const moved = yield* fold(
					deleted.events.map((value) =>
						value.id === progress.id ? { ...value, occurredAt: "2026-01-03T12:00:00.000Z" } : value,
					),
					deleted.value,
				);
				expect(completions(moved.events)).toEqual([]);

				const edited = yield* fold(
					completed.events.map((value) =>
						value.id === derived.id
							? { ...value, properties: { ...value.properties, timeSpent: 123 } }
							: value,
					),
					completed.value,
				);
				expect(edited.changes).toMatchObject([
					{
						kind: "update",
						item: {
							eventId: derived.id,
							patch: { properties: { remove: ["completionKey", "completionSilent"] } },
						},
					},
				]);
				const reopened = yield* fold(
					edited.events.map((value) =>
						value.id === progress.id
							? { ...value, properties: { progressPercent: 50, consumptionBasis: basis } }
							: value,
					),
					edited.value,
				);
				expect(completions(reopened.events)).toMatchObject([
					{ id: derived.id, properties: { timeSpent: 123 } },
				]);
				expect(completions(reopened.events)[0]?.properties).not.toHaveProperty("completionKey");
			}),
		testTimeout,
	);

	it.effect(
		"does not complete progress already followed by an explicit completion at the same time",
		() =>
			Effect.gen(function* () {
				const settled = yield* fold([
					event("progress-1", {
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100, consumptionBasis: basis },
					}),
					event("complete-1", { eventSchemaSlug: "complete" }),
				]);
				expect(settled.changes).toEqual([]);
			}),
		testTimeout,
	);

	it.effect(
		"completes an ended show once its aired episodes are covered and keeps the frozen inventory",
		() =>
			Effect.gen(function* () {
				const covered = yield* fold(
					[
						episode("episode-1", "complete", "2026-01-01T12:00:00.000Z"),
						episode("episode-2", "progress", "2026-01-02T12:00:00.000Z"),
					],
					undefined,
					show,
					["episode-1", "episode-2"],
				);
				expect(completions(covered.events)).toMatchObject([
					{ entityId: "episode-1" },
					{ entityId: "episode-2", orderKey: "progress-episode-2~complete" },
					{
						entityId: "show",
						sessionEntityId: "show",
						orderKey: "progress-episode-2~parent",
						occurredAt: "2026-01-02T12:00:00.000Z",
						properties: { consumptionBasis: { unit: "episodes" } },
					},
				]);

				const grown = yield* fold(covered.events, covered.value, show, [
					"episode-1",
					"episode-2",
					"episode-3",
				]);
				expect(grown.changes).toEqual([]);

				const moved = yield* fold(
					covered.events.map((value) =>
						value.id === "complete-episode-1"
							? { ...value, occurredAt: "2026-01-03T12:00:00.000Z" }
							: value,
					),
					covered.value,
					show,
					["episode-1", "episode-2", "episode-3"],
				);
				expect(completions(moved.events).find(({ entityId }) => entityId === "show")).toMatchObject(
					{ occurredAt: "2026-01-03T12:00:00.000Z" },
				);

				const removed = yield* fold(
					moved.events.filter(({ id }) => id !== "complete-episode-1"),
					moved.value,
					show,
					["episode-1", "episode-2", "episode-3"],
				);
				expect(completions(removed.events).map(({ entityId }) => entityId)).toEqual(["episode-2"]);
			}),
		testTimeout,
	);

	it.effect(
		"copies the ordered case-insensitive union of covered sources onto the parent completion",
		() =>
			Effect.gen(function* () {
				const covered = yield* fold(
					[
						episode("episode-1", "complete", "2026-01-01T12:00:00.000Z", ["Plex", "Netflix"]),
						episode("episode-2", "complete", "2026-01-02T12:00:00.000Z", ["netflix", "Kindle"]),
						episode("episode-3", "complete", "2026-01-03T12:00:00.000Z"),
					],
					undefined,
					show,
					["episode-1", "episode-2", "episode-3"],
				);
				expect(
					completions(covered.events).find(({ entityId }) => entityId === "show")?.properties[
						"consumedOn"
					],
				).toEqual(["Plex", "Netflix", "Kindle"]);
				const unsourced = yield* fold(
					[episode("episode-1", "complete", "2026-01-01T12:00:00.000Z")],
					undefined,
					show,
					["episode-1"],
				);
				expect(
					completions(unsourced.events).find(({ entityId }) => entityId === "show")?.properties,
				).not.toHaveProperty("consumedOn");
			}),
		testTimeout,
	);

	it.effect(
		"keeps an automatic completion merged in from another title",
		() =>
			Effect.gen(function* () {
				const settled = yield* fold([
					event("merged-completion", {
						eventSchemaSlug: "complete",
						properties: { consumptionBasis: basis, completionKey: "coverage:elsewhere" },
					}),
				]);
				expect(settled.changes).toEqual([]);
				expect(completions(settled.events)).toMatchObject([{ id: "merged-completion" }]);
			}),
		testTimeout,
	);

	it.effect(
		"completes a show only for a new completion or when it becomes terminal, not a smaller inventory",
		() =>
			Effect.gen(function* () {
				const first = episode("episode-1", "complete", "2026-01-01T12:00:00.000Z");
				const partial = yield* fold([first], undefined, show, ["episode-1", "episode-2"]);
				expect(partial.changes).toEqual([]);

				const shrunk = yield* fold(partial.events, partial.value, show, ["episode-1"]);
				expect(shrunk.changes).toEqual([]);

				const next = episode("episode-3", "complete", "2026-01-02T12:00:00.000Z");
				const logged = yield* fold([...shrunk.events, next], shrunk.value, show, [
					"episode-1",
					"episode-3",
				]);
				expect(completions(logged.events).map(({ entityId }) => entityId)).toContain("show");

				const airing = { ...show, terminal: false };
				const caughtUp = yield* fold([first], undefined, airing, ["episode-1"]);
				expect(caughtUp.changes).toEqual([]);
				const ended = yield* fold(caughtUp.events, caughtUp.value, show, ["episode-1"]);
				expect(completions(ended.events).map(({ entityId }) => entityId)).toContain("show");
			}),
		testTimeout,
	);

	it.effect(
		"does not complete a show that is still airing",
		() =>
			Effect.gen(function* () {
				const settled = yield* fold(
					[episode("episode-1", "complete", "2026-01-01T12:00:00.000Z")],
					undefined,
					{ ...show, terminal: false },
					["episode-1"],
				);
				expect(settled.changes).toEqual([]);
			}),
		testTimeout,
	);
});

describe("absorbFoldValues", () => {
	const suppressed: MediaFoldValue = {
		coverageSources: ["old-event"],
		occurrences: [
			{
				total: 120,
				written: null,
				silent: false,
				rule: "progress",
				status: "suppressed",
				key: "progress:old-event",
				sourceEventId: "old-event",
			},
			{
				written: null,
				silent: false,
				status: "active",
				rule: "coverage",
				key: "coverage:old-event",
				sourceEventId: "old-event",
				sources: ["old-event", "kept-event"],
				inventory: ["old-episode", "kept-episode"],
			},
		],
	};
	const ids = { "old-event": "new-event", "old-episode": "new-episode" };

	it("rewrites the IDs an absorbed value holds and clears what it wrote", () => {
		const { renamedKeys, value: absorbed } = absorbFoldValues({ occurrences: [] }, [
			{ ids, value: suppressed },
		]);
		expect(renamedKeys.get("progress:old-event")).toBe("progress:new-event");
		expect(absorbed.coverageSources).toEqual(["new-event"]);
		expect(absorbed.occurrences).toEqual([
			{
				total: 120,
				written: null,
				silent: false,
				rule: "progress",
				status: "suppressed",
				key: "progress:new-event",
				sourceEventId: "new-event",
			},
			{
				written: null,
				silent: false,
				status: "active",
				rule: "coverage",
				key: "coverage:new-event",
				sourceEventId: "new-event",
				sources: ["new-event", "kept-event"],
				inventory: ["new-episode", "kept-episode"],
			},
		]);
	});

	it("keeps the destination's own occurrence when both hold a key", () => {
		const own: MediaFoldValue = {
			occurrences: [
				{
					silent: true,
					written: null,
					rule: "progress",
					status: "inactive",
					key: "progress:new-event",
					sourceEventId: "new-event",
				},
			],
		};
		const { value: absorbed } = absorbFoldValues(own, [{ ids, value: suppressed }]);
		expect(absorbed.occurrences.find(({ key }) => key === "progress:new-event")?.status).toBe(
			"inactive",
		);
	});

	it.effect("does not complete a suppressed occurrence again after its source was restored", () =>
		Effect.gen(function* () {
			const restored = event("new-event", {
				eventSchemaSlug: "progress",
				properties: { progressPercent: 100, consumptionBasis: basis },
			});
			const { events, changes } = yield* fold(
				[restored],
				absorbFoldValues({ occurrences: [] }, [{ ids, value: suppressed }]).value,
			);
			expect(changes).toEqual([]);
			expect(completions(events)).toEqual([]);
		}),
	);

	it.effect("repairs a restored completion that still names its source's old key", () =>
		Effect.gen(function* () {
			const restored = event("new-event", {
				eventSchemaSlug: "progress",
				properties: { progressPercent: 100, consumptionBasis: basis },
			});
			const completion = event("completion", {
				eventSchemaSlug: "complete",
				properties: { consumptionBasis: basis, completionKey: "progress:old-event" },
			});
			const active: MediaFoldValue = {
				occurrences: [
					{
						total: 120,
						silent: false,
						written: null,
						rule: "progress",
						status: "active",
						key: "progress:old-event",
						sourceEventId: "old-event",
					},
				],
			};
			const { value, renamedKeys } = absorbFoldValues({ occurrences: [] }, [
				{ ids, value: active },
			]);
			const { events } = yield* fold([restored, completion], value, movie, [], renamedKeys);
			expect(
				completions(events).map(({ id, properties }) => [id, properties["completionKey"]]),
			).toEqual([["completion", "progress:new-event"]]);
		}),
	);
});
