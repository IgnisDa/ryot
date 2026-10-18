import { assert, expect, it } from "@effect/vitest";
import type { ScriptHost, UserCommandInput } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { stableStringify } from "@ryot-app/ts-utils/json";

import type { CompletionOccurrence } from "../../shared/history-correction";
import { HistoryCorrection } from "../../shared/history-correction";
import { advanceHistoryCorrection } from "./history-correction";

const timestamp = "2026-01-01T00:00:00.000Z";
const request = {
	force: false,
	workKey: "work",
	conflictAttempt: 0,
	entityId: "subject",
	conflictBase: "work",
	requestKey: "request",
	liveSourceIds: ["source"],
};
const checkpoint = (patch: Partial<HistoryCorrection> = {}): HistoryCorrection => ({
	step: 5,
	cycle: 0,
	runKey: "run",
	workKey: "work",
	phase: "progress",
	sourceRevision: 4,
	requestKey: "request",
	liveSourceIds: ["source"],
	subjectEntityId: "subject",
	...patch,
});
const occurrence = (patch: Partial<CompletionOccurrence> = {}): CompletionOccurrence => ({
	total: 0,
	frozen: false,
	silent: false,
	rule: "progress",
	runKey: "old-run",
	status: "inactive",
	entityId: "subject",
	sourceEventId: "source",
	subjectEntityId: "subject",
	...patch,
});
const record = (properties: JsonValue, id = "occurrence") => ({
	id,
	properties,
	revision: 0,
	occurredAt: timestamp,
});
const source = (patch: Readonly<Record<string, JsonValue>> = {}) => ({
	revision: 0,
	id: "source",
	orderKey: "source",
	entityId: "subject",
	createdAt: timestamp,
	occurredAt: timestamp,
	sessionEntityId: null,
	entitySchemaSlug: "movie",
	orderCreatedAt: timestamp,
	eventSchemaSlug: "progress",
	properties: { progressPercent: 100 },
	...patch,
});
const rows = (items: readonly JsonValue[], nextCursor: null | string = null) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});
const reply = (name: string, items: readonly JsonValue[], nextCursor: null | string = null) => ({
	data: { [name]: rows(items, nextCursor) },
});

const inventoryRow = {
	total: 60,
	required: 58,
	latestSeason: timestamp,
	latestEpisode: timestamp,
	subjectUpdatedAt: timestamp,
	latestLink: "2026-01-02T00:00:00.000Z",
};
const inventoryFingerprint = JSON.stringify([
	inventoryRow.required,
	inventoryRow.total,
	inventoryRow.latestEpisode,
	inventoryRow.latestSeason,
	inventoryRow.latestLink,
	inventoryRow.subjectUpdatedAt,
]);

const harness = (
	input: {
		schemaSlug?: string;
		sourceRevision?: number;
		state?: HistoryCorrection;
		inventory?: typeof inventoryRow;
		responses?: readonly ReturnType<typeof reply>[];
		properties?: Readonly<Record<string, JsonValue>>;
	} = {},
) => {
	const commands: UserCommandInput[] = [];
	const queries: Parameters<ScriptHost["executeRyotql"]>[0][] = [];
	const responses = [...(input.responses ?? [])];
	const state = input.state ?? checkpoint();
	const host: Pick<ScriptHost, "executeRyotql" | "commitUserChanges"> = {
		commitUserChanges: (command) => {
			commands.push(command);
			return Effect.succeed({ events: [], entityId: EntityId.make("library") });
		},
		executeRyotql: (document) => {
			queries.push(document);
			if ("scope" in document.queries) {
				return Effect.succeed({
					data: {
						work: rows([record(state, "checkpoint")]),
						scope: rows([{ revision: input.sourceRevision ?? 4 }]),
						library: rows([{ properties: {}, name: "Library", updatedAt: timestamp }]),
						target: rows([
							{ properties: input.properties ?? {}, schemaSlug: input.schemaSlug ?? "movie" },
						]),
					},
				});
			}
			if ("fingerprint" in document.queries) {
				return Effect.succeed(reply("fingerprint", [input.inventory ?? inventoryRow]));
			}
			const response = responses.shift();
			assert(response, "Unexpected worker query");
			return Effect.succeed(response);
		},
	};
	const run = (overrides: Partial<typeof request> = {}) =>
		advanceHistoryCorrection(host, { ...request, ...overrides }, "library");
	const saved = () => {
		const command = commands.at(-1);
		assert(command);
		const change = command.events.changes.find(
			(item) => item.itemIdentity === "replace:checkpoint",
		);
		assert(change?.kind === "update");
		return Schema.decodeUnknownSync(HistoryCorrection)(change.item.patch.properties?.set);
	};
	return { run, host, saved, queries, commands, responses };
};

it.effect("restarts from audit on source drift without publishing stale work", () =>
	Effect.gen(function* () {
		const test = harness({
			sourceRevision: 5,
			state: checkpoint({ phase: "publish", basisId: "basis" }),
		});
		yield* test.run();
		expect(test.saved()).toMatchObject({ step: 1, phase: "audit", sourceRevision: 5 });
		expect(test.commands[0]?.events.creates).toEqual([]);
		expect(test.queries).toHaveLength(1);
	}),
);

it.effect("records a deleted active output as durable suppression", () =>
	Effect.gen(function* () {
		const test = harness({
			state: checkpoint({ phase: "audit" }),
			responses: [
				reply("records", [record(occurrence({ frozen: true, status: "active" }))]),
				reply("event", []),
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.changes).toMatchObject([
			{
				itemIdentity: "replace:occurrence",
				item: { patch: { properties: { set: { status: "suppressed" } } } },
			},
			{ itemIdentity: "replace:checkpoint" },
		]);
		expect(test.commands[0]?.events.creates).toEqual([]);
	}),
);

it.effect.each([
	{ changes: "override", phase: "audit" as const },
	{ phase: "prune" as const, changes: "remove-output" },
	{ phase: "sweep" as const, changes: "remove-output" },
])(
	"$phase handles a page of 25 records in one step and predicts the source revision",
	({ phase, changes }) =>
		Effect.gen(function* () {
			const ids = Array.from({ length: 25 }, (_, index) => `occurrence-${index}`);
			const test = harness({
				state: checkpoint({ phase }),
				responses: [
					reply(
						"records",
						ids.map((id) => record(occurrence({ frozen: true, status: "active" }), id)),
					),
					...ids.map((id) =>
						reply("event", [
							source({
								id: `output-${id}`,
								eventSchemaSlug: "complete",
								properties: { timeSpent: 1, completionKey: id },
							}),
						]),
					),
				],
			});
			yield* test.run();
			const applied = test.commands[0]?.events.changes ?? [];
			expect(
				applied.filter((change) => change.itemIdentity.startsWith(`${changes}:`)),
			).toHaveLength(25);
			expect(
				applied.filter((change) => change.itemIdentity.startsWith("replace:occurrence-")),
			).toHaveLength(25);
			expect(test.commands[0]?.events.baselines).toEqual([
				{ revision: 4, entityId: EntityId.make("subject") },
			]);
			expect(test.saved().sourceRevision).toBe(4 + 25);
		}),
);

it.effect("restarts pending work for a new explicit correction request", () =>
	Effect.gen(function* () {
		const test = harness({ state: checkpoint({ phase: "sweep", requestKey: "older-request" }) });
		yield* test.run({ force: true });
		expect(test.saved()).toMatchObject({ step: 1, phase: "audit", requestKey: "request" });
		expect(test.queries).toHaveLength(1);
	}),
);

it.effect("lets an older continuation help the current run without forcing another restart", () =>
	Effect.gen(function* () {
		const test = harness({
			responses: [reply("records", [])],
			state: checkpoint({ phase: "audit", runKey: "newer-run", requestKey: "newer-request" }),
		});
		yield* test.run();
		expect(test.saved()).toMatchObject({
			step: 6,
			phase: "progress",
			runKey: "newer-run",
			requestKey: "newer-request",
		});
	}),
);

it.effect("turns an edited automatic record into an independent explicit record", () =>
	Effect.gen(function* () {
		const test = harness({
			state: checkpoint({ phase: "audit" }),
			responses: [
				reply("records", [record(occurrence({ frozen: true, status: "active" }))]),
				reply("event", [
					source({
						id: "output",
						eventSchemaSlug: "complete",
						properties: { timeSpent: 123, completionKey: "occurrence" },
					}),
				]),
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.changes).toMatchObject([
			{
				itemIdentity: "override:output",
				item: {
					patch: {
						orderAfter: null,
						properties: { set: {}, remove: ["completionKey", "completionSilent"] },
					},
				},
			},
			{
				itemIdentity: "replace:occurrence",
				item: { patch: { properties: { set: { status: "overridden" } } } },
			},
			{ itemIdentity: "replace:checkpoint" },
		]);
		expect(test.saved().sourceRevision).toBe(5);
	}),
);

it.effect.each(["suppressed", "overridden"] as const)(
	"preserves %s decisions when a full source is replayed",
	(status) =>
		Effect.gen(function* () {
			const test = harness({
				responses: [
					reply("events", [source()]),
					reply("records", [record(occurrence({ status, frozen: true }))]),
					reply("blockers", [{ explicit: false, sameTime: false }]),
					reply("event", []),
				],
			});
			yield* test.run();
			expect(test.commands[0]?.events.creates).toEqual([]);
			expect(test.commands[0]?.events.changes[0]).toMatchObject({
				item: { patch: { properties: { set: { status } } } },
			});
		}),
);

it.effect("uses the retained positional total instead of current provider metadata", () =>
	Effect.gen(function* () {
		const test = harness({
			schemaSlug: "anime",
			properties: { episodes: 20 },
			responses: [
				reply("events", [source({ entitySchemaSlug: "anime", properties: { animeEpisode: 12 } })]),
				reply("records", [record(occurrence({ total: 12, frozen: true }))]),
				reply("blockers", [{ explicit: false, sameTime: false }]),
				reply("event", []),
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.creates).toMatchObject([
			{
				eventSchemaSlug: "complete",
				properties: { completionSilent: true },
				orderAfter: { eventId: "source", suffix: "complete" },
			},
		]);
		expect(test.commands[0]?.events.changes[0]).toMatchObject({
			item: { patch: { properties: { set: { total: 12, frozen: true } } } },
		});
	}),
);

it.effect("does not publish when an explicit completion blocks the source", () =>
	Effect.gen(function* () {
		const test = harness({
			schemaSlug: "anime",
			properties: { episodes: 12 },
			responses: [
				reply("events", [source({ entitySchemaSlug: "anime", properties: { animeEpisode: 12 } })]),
				reply("records", [record(occurrence({ total: 12 }))]),
				reply("blockers", [{ explicit: true, sameTime: false }]),
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.creates).toEqual([]);
		expect(test.commands[0]?.events.changes).toHaveLength(1);
	}),
);

it.effect.each([
	{ name: "an added link", change: { total: 61, latestLink: "2026-02-01T00:00:00.000Z" } },
	{ name: "a removed link", change: { total: 59, required: 57 } },
	{ name: "an updated episode", change: { latestEpisode: "2026-02-01T00:00:00.000Z" } },
	{ name: "an updated season", change: { latestSeason: "2026-02-01T00:00:00.000Z" } },
	{ name: "a changed production status", change: { subjectUpdatedAt: "2026-02-01T00:00:00.000Z" } },
])("recaptures inventory after $name between pages", ({ change }) =>
	Effect.gen(function* () {
		const test = harness({
			schemaSlug: "show",
			inventory: { ...inventoryRow, ...change },
			responses: [
				reply("records", [record(occurrence({ rule: "coverage", status: "building" }), "basis")]),
			],
			state: checkpoint({
				basisId: "basis",
				phase: "snapshot",
				evidenceAfter: "page-1",
				inventory: inventoryFingerprint,
			}),
		});
		yield* test.run();
		expect(test.saved()).toMatchObject({ phase: "reset-snapshot" });
		expect(test.saved()).not.toHaveProperty("evidenceAfter");
		expect(test.commands[0]?.events.creates).toEqual([]);
	}),
);

it.effect("recaptures an unfrozen snapshot whose checkpoint has no inventory", () =>
	Effect.gen(function* () {
		const test = harness({
			schemaSlug: "show",
			state: checkpoint({ phase: "publish", basisId: "basis" }),
			responses: [
				reply("records", [record(occurrence({ rule: "coverage", status: "building" }), "basis")]),
			],
		});
		yield* test.run();
		expect(test.saved().phase).toBe("reset-snapshot");
		expect(test.commands[0]?.events.creates).toEqual([]);
	}),
);

it.effect("records the inventory when a reset removes stale evidence", () =>
	Effect.gen(function* () {
		const test = harness({
			schemaSlug: "show",
			state: checkpoint({ basisId: "basis", inventory: "stale", phase: "reset-snapshot" }),
			responses: [
				reply("records", [record(occurrence({ rule: "coverage", status: "building" }), "basis")]),
				reply("records", []),
			],
		});
		yield* test.run();
		expect(test.saved()).toMatchObject({ phase: "snapshot", inventory: inventoryFingerprint });
	}),
);

it.effect("resumes a large inventory with bounded evidence writes and an atomic checkpoint", () =>
	Effect.gen(function* () {
		const episodes = Array.from({ length: 50 }, (_, index) => ({
			id: `episode-${index}`,
			episodeId: `episode-${index}`,
			sourceEventId: `activity-${index}`,
		}));
		const test = harness({
			schemaSlug: "show",
			state: checkpoint({
				basisId: "basis",
				phase: "snapshot",
				evidenceAfter: "page-58",
				inventory: inventoryFingerprint,
			}),
			responses: [
				reply("records", [record(occurrence({ rule: "coverage", status: "building" }), "basis")]),
				reply("episodes", episodes, "page-59"),
			],
		});
		yield* test.run();
		expect(test.commands).toHaveLength(1);
		expect(test.commands[0]?.events.creates).toHaveLength(50);
		expect(test.saved()).toMatchObject({
			phase: "snapshot",
			evidenceAfter: "page-59",
			inventory: inventoryFingerprint,
		});
		expect(test.commands[0]?.events.baselines).toEqual([
			{ revision: 4, entityId: EntityId.make("subject") },
		]);
		expect(stableStringify(test.commands[0]).length).toBeLessThan(30_000);
	}),
);

it.effect("continues a large history from its persisted source cursor", () =>
	Effect.gen(function* () {
		const test = harness({
			state: checkpoint({ after: "source-page-2999" }),
			responses: [
				reply("events", [source({ properties: { progressPercent: 50 } })], "source-page-3000"),
				reply("records", [record(occurrence())]),
				reply("blockers", [{ explicit: false, sameTime: false }]),
			],
		});
		yield* test.run();
		expect(test.saved()).toMatchObject({ phase: "progress", after: "source-page-3000" });
		expect(test.commands[0]?.events.changes).toHaveLength(1);
		expect(stableStringify(test.queries[1])).toContain("source-page-2999");
	}),
);

it.effect("replaces older episode support before testing coverage", () =>
	Effect.gen(function* () {
		const test = harness({
			schemaSlug: "show",
			state: checkpoint({ phase: "coverage" }),
			responses: [
				reply("events", [
					source({
						id: "later",
						properties: {},
						entityId: "episode",
						sessionEntityId: "subject",
						eventSchemaSlug: "complete",
					}),
				]),
				reply("records", [
					record(
						{
							cycle: 0,
							runKey: "run",
							episodeId: "episode",
							sourceEventId: "earlier",
							subjectEntityId: "subject",
						},
						"scratch",
					),
				]),
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.changes[0]).toMatchObject({
			itemIdentity: "replace:scratch",
			item: { patch: { properties: { set: { sourceEventId: "later" } } } },
		});
		expect(test.saved().phase).toBe("coverage");
		expect(test.queries).toHaveLength(3);
	}),
);

it.effect(
	"pages 3,000 history sources through separate atomic steps",
	() =>
		Effect.gen(function* () {
			let state = checkpoint();
			let largestCommand = 0;
			let writes = 0;
			for (let index = 0; index < 3_000; index += 1) {
				const id = `source-${index}`;
				const next = index === 2_999 ? null : `cursor-${index + 1}`;
				const item = source({ id, properties: { progressPercent: 50 } });
				const create = harness({
					state,
					responses: [
						reply("events", [item], next),
						reply("records", []),
						reply("blockers", [{ explicit: false, sameTime: false }]),
					],
				});
				yield* create.run();
				expect(create.commands[0]?.events.creates).toHaveLength(1);
				state = create.saved();
				const advance = harness({
					state,
					responses: [
						reply("events", [item], next),
						reply("records", [
							record(occurrence({ silent: true, sourceEventId: id, runKey: state.runKey })),
						]),
						reply("blockers", [{ explicit: false, sameTime: false }]),
					],
				});
				yield* advance.run();
				expect(advance.commands[0]?.events.creates).toHaveLength(0);
				state = advance.saved();
				for (const command of [...create.commands, ...advance.commands]) {
					largestCommand = Math.max(largestCommand, stableStringify(command).length);
					writes += 1;
				}
			}
			expect(writes).toBe(6_000);
			expect(state).toMatchObject({ step: 6_005, phase: "prune" });
			expect(state).not.toHaveProperty("after");
			expect(largestCommand).toBeLessThan(4_000);
		}),
	30_000,
);

it.effect("captures 3,000 required episodes across resumable bounded pages", () =>
	Effect.gen(function* () {
		let state = checkpoint({
			basisId: "basis",
			phase: "snapshot",
			inventory: inventoryFingerprint,
		});
		let captured = 0;
		let largestCommand = 0;
		for (let page = 0; page < 60; page += 1) {
			const items = Array.from({ length: 50 }, (_, offset) => {
				const index = page * 50 + offset;
				return {
					id: `episode-${index}`,
					episodeId: `episode-${index}`,
					sourceEventId: `activity-${index}`,
				};
			});
			const test = harness({
				state,
				schemaSlug: "show",
				responses: [
					reply("records", [record(occurrence({ rule: "coverage", status: "building" }), "basis")]),
					reply("episodes", items, page === 59 ? null : `page-${page + 1}`),
				],
			});
			yield* test.run();
			state = test.saved();
			expect(test.commands).toHaveLength(1);
			expect(test.commands[0]?.events.creates).toHaveLength(50);
			captured += test.commands[0]?.events.creates.length ?? 0;
			largestCommand = Math.max(largestCommand, stableStringify(test.commands[0]).length);
		}
		expect(captured).toBe(3_000);
		expect(state).toMatchObject({ step: 65, phase: "publish", inventory: inventoryFingerprint });
		expect(state).not.toHaveProperty("evidenceAfter");
		expect(largestCommand).toBeLessThan(30_000);
	}),
);

it.effect("lets an independent repeat start a new occurrence after old support is replaced", () =>
	Effect.gen(function* () {
		const coverage = {
			live: 0,
			covered: 2,
			sourced: 0,
			unknown: 0,
			required: 2,
			sourceCount: 0,
			supportCount: 0,
			consumedOn: null,
		};
		const test = harness({
			schemaSlug: "show",
			properties: { productionStatus: "Ended" },
			state: checkpoint({ phase: "coverage", basisId: "suppressed-old-cycle" }),
			responses: [
				reply("events", [
					source({
						properties: {},
						id: "new-watch",
						entityId: "episode",
						sessionEntityId: "subject",
						eventSchemaSlug: "complete",
					}),
				]),
				reply("records", [
					record(
						{
							cycle: 0,
							runKey: "run",
							episodeId: "episode",
							sourceEventId: "new-watch",
							subjectEntityId: "subject",
						},
						"scratch",
					),
				]),
				reply("coverage", [coverage]),
				reply("coverage", [coverage]),
				reply("records", []),
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.creates).toMatchObject([
			{
				eventSchemaSlug: "completion-occurrence",
				properties: { rule: "coverage", status: "building", sourceEventId: "new-watch" },
			},
		]);
		expect(test.saved()).not.toHaveProperty("basisId");
	}),
);
