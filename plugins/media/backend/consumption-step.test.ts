import { assert, describe, expect, it } from "@effect/vitest";
import type { Predicate } from "@ryot-app/contract/modules/ryotql/language";
import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { EventStreamBatchInput } from "@ryot-app/plugin-backend-sdk/event-streams";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { sortBy } from "@ryot-app/ts-utils/lodash";

import { ConsumptionContribution } from "../shared/consumption-projection";
import definition, { manifest } from "./consumption-step.sandbox";
import { consumptionBatchRecipe, consumptionRoundSize } from "./contracts/consumption-recipes";

const instant = "2026-01-01T00:00:00.000Z";
const row = (id: string, sourceRun: string, complete = false, entityId = "book") => ({
	id,
	entityId,
	orderKey: id,
	boundary: null,
	automatic: null,
	occurredAt: instant,
	orderCreatedAt: instant,
	entitySchemaSlug: "book",
	group: `source:${sourceRun}`,
	eventSchemaSlug: complete ? "complete" : "progress",
	properties: {
		sourceRun,
		consumptionBasis: { total: 100, unit: "pages", property: "pages" },
		...(complete ? {} : { progressPages: 40 }),
	},
});
type Row = ReturnType<typeof row>;

const cursorId = (predicate: undefined | Predicate): string | undefined => {
	if (predicate?.type === "and" || predicate?.type === "or") {
		return predicate.predicates.map(cursorId).find((value) => value !== undefined);
	}
	if (
		predicate?.type === "comparison" &&
		predicate.operator === "gt" &&
		predicate.left.type === "column" &&
		predicate.left.field === "id" &&
		predicate.right.type === "literal" &&
		typeof predicate.right.value === "string"
	) {
		return predicate.right.value;
	}
	return undefined;
};

const requestedStreams = (
	predicate: undefined | Predicate,
): ReadonlyArray<{ entityId: string; after: string | undefined }> => {
	if (predicate?.type !== "and" && predicate?.type !== "or") {
		return [];
	}
	const [first, ...rest] = predicate.predicates;
	if (
		predicate.type === "and" &&
		first?.type === "comparison" &&
		first.operator === "eq" &&
		first.left.type === "column" &&
		first.left.field === "entityId" &&
		first.right.type === "literal" &&
		typeof first.right.value === "string"
	) {
		return [{ entityId: first.right.value, after: cursorId({ type: "and", predicates: rest }) }];
	}
	return predicate.predicates.flatMap(requestedStreams);
};

const harness = (rows: ReadonlyArray<Row>) => {
	let calls = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: (document) => {
			calls += 1;
			const matched = sortBy(requestedStreams(document.queries["rows"]?.where), "entityId").flatMap(
				({ after, entityId }) => {
					const own = rows.filter((value) => value.entityId === entityId);
					return own.slice(after === undefined ? 0 : own.findIndex(({ id }) => id === after) + 1);
				},
			);
			const hasMore = matched.length > consumptionRoundSize;
			return Effect.succeed({
				data: {
					rows: {
						type: "rows",
						items: matched.slice(0, consumptionRoundSize),
						pageInfo: {
							hasMore,
							limit: consumptionRoundSize,
							nextCursor: hasMore ? "unused" : null,
						},
					},
				},
			});
		},
	});
	const run = (
		streams: ReadonlyArray<{ entityId: string; checkpoint: Schema.Json }>,
		eventSchemaSlug = "progress",
	) =>
		Effect.gen(function* () {
			const input = yield* Schema.decodeEffect(EventStreamBatchInput)({
				eventSchemaSlug,
				streams: streams.map((stream) => ({ ...stream, dirtyFrom: null })),
			});
			return yield* definition.run(input, host);
		});
	const single = (checkpoint: Schema.Json = null, eventSchemaSlug = "progress") =>
		run([{ checkpoint, entityId: "book" }], eventSchemaSlug).pipe(
			Effect.map(({ streams: [result] }) => {
				assert(result);
				return result;
			}),
		);
	return { run, single, calls: () => calls };
};

const contributionOf = (properties: Readonly<Record<string, unknown>>) =>
	Schema.decodeUnknownEffect(ConsumptionContribution)(properties["contribution"]);

describe("production consumption stream", () => {
	it.effect("resumes from its encoded checkpoint and caps each stream at 100 updates", () =>
		Effect.gen(function* () {
			const rows = Array.from({ length: 450 }, (_, index) => ({
				...row(String(index).padStart(4, "0"), "one"),
				properties: {
					sourceRun: "one",
					progressPages: (index + 1) / 4,
					consumptionBasis: { total: 1000, unit: "pages", property: "pages" },
				},
			}));
			const test = harness(rows);
			const steps: number[] = [];
			let checkpoint: Schema.Json = null;
			let amount = 0;
			let done = false;
			while (!done && steps.length < 20) {
				const result = yield* test.single(checkpoint);
				steps.push(result.updates.length);
				const encoded: string = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
					result.checkpoint,
				);
				checkpoint = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(encoded);
				for (const update of result.updates) {
					amount += (yield* contributionOf(update.properties)).pages?.recorded ?? 0;
				}
				done = result.done;
			}
			expect(done).toBe(true);
			expect(checkpoint).toBeNull();
			expect(Math.max(...steps)).toBe(100);
			expect(steps.reduce((total, count) => total + count, 0)).toBe(450);
			expect(amount).toBe(112.5);
		}),
	);

	it("reads every stream of a batch with one bounded rows query", () => {
		const after = {
			id: "source",
			orderKey: "source",
			group: "source:run",
			occurredAt: instant,
			orderCreatedAt: instant,
		};
		const recipe = consumptionBatchRecipe({
			streams: [
				{ after: null, entityId: "book" },
				{ after, entityId: "movie" },
			],
		});
		expect(
			validateRyotQLDocument(recipe.document, {
				type: "user",
				audience: "plugin",
				accessClass: "standard",
			}).error,
		).toBeNull();
		expect(Object.keys(recipe.document.queries)).toEqual(["rows"]);
		expect(requestedStreams(recipe.document.queries["rows"]?.where)).toEqual([
			{ entityId: "book", after: undefined },
			{ after: "source", entityId: "movie" },
		]);
	});

	it.effect("completes several short titles in one execution with one query per round", () =>
		Effect.gen(function* () {
			const titles = ["a", "b", "c"];
			const test = harness(
				titles.flatMap((entityId) => [
					row(`${entityId}:1`, entityId, false, entityId),
					row(`${entityId}:2`, entityId, true, entityId),
				]),
			);
			const result = yield* test.run(
				titles.map((entityId) => ({ entityId, checkpoint: null })),
				"complete",
			);
			expect(test.calls()).toBe(1);
			expect(
				result.streams.map(({ done, entityId, checkpoint }) => ({ done, entityId, checkpoint })),
			).toEqual(titles.map((entityId) => ({ entityId, done: true, checkpoint: null })));
			expect(result.streams.map(({ updates }) => updates.map(({ eventId }) => eventId))).toEqual(
				titles.map((entityId) => [`${entityId}:2`]),
			);
		}),
	);

	it.effect(
		"computes more than one thousand independent runs on one title using bounded resumable checkpoints",
		() =>
			Effect.gen(function* () {
				const rows = Array.from({ length: 1100 }, (_, index) => {
					const key = String(index).padStart(4, "0");
					return [row(`${key}:a`, key), row(`${key}:b`, key, true)];
				}).flat();
				const test = harness(rows);
				let checkpoint: Schema.Json = null;
				let total = 0;
				let count = 0;
				let finished = false;
				for (let step = 0; step < 2000; step += 1) {
					const result = yield* test.single(checkpoint, "complete");
					expect(result.updates.length).toBeLessThanOrEqual(100);
					const serialized: string = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
						result.checkpoint,
					);
					expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(16384);
					checkpoint = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(serialized);
					for (const update of result.updates) {
						expect(update.eventId.endsWith(":b")).toBe(true);
						const value = yield* contributionOf(update.properties);
						total += value.pages?.estimated ?? 0;
						count += value.titleCompletions;
					}
					if (result.done) {
						finished = true;
						break;
					}
				}
				expect(finished).toBe(true);
				expect(total).toBe(66000);
				expect(count).toBe(1100);
			}),
	);

	it.effect(
		"plans a long unfinished run before replay and restarts an edited run from an empty checkpoint",
		() =>
			Effect.gen(function* () {
				const rows = Array.from({ length: 1200 }, (_, index) => ({
					...row(String(index).padStart(4, "0"), "one"),
					properties: {
						sourceRun: "one",
						progressPages: index + 1,
						consumptionBasis: { total: 2000, unit: "pages", property: "pages" },
					},
				}));
				const test = harness(rows);
				let checkpoint: Schema.Json = null;
				let amount = 0;
				let done = false;
				for (let step = 0; step < 100; step += 1) {
					const result: Effect.Success<ReturnType<typeof test.single>> =
						yield* test.single(checkpoint);
					checkpoint = result.checkpoint;
					for (const update of result.updates) {
						amount += (yield* contributionOf(update.properties)).pages?.recorded ?? 0;
					}
					if (result.done) {
						done = true;
						break;
					}
				}
				expect(done).toBe(true);
				expect(amount).toBe(1200);
				const source = rows[0];
				assert(source);
				const edited = harness([
					{ ...source, properties: { ...source.properties, progressPages: 25 } },
				]);
				const replay = yield* edited.single(null);
				expect(replay.done).toBe(true);
				expect(replay.updates[0]?.properties).toMatchObject({
					contribution: { pages: { recorded: 25 } },
				});
			}),
	);
});
