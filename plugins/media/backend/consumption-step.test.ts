import { assert, describe, expect, it } from "@effect/vitest";
import type { Predicate } from "@ryot-app/contract/modules/ryotql/language";
import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { EventStreamStepInput } from "@ryot-app/plugin-backend-sdk/event-streams";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import { mediaConsumptionLongTitleSources } from "../benchmarks/consumption";
import { ConsumptionContribution } from "../shared/consumption-projection";
import definition, { manifest } from "./consumption-step.sandbox";
import { consumptionPageRecipe } from "./contracts/consumption-recipes";

const instant = "2026-01-01T00:00:00.000Z";
const responseRows = (values: readonly unknown[], hasMore = false) => ({
	type: "rows",
	items: values,
	pageInfo: { hasMore, limit: 50, nextCursor: hasMore ? "unused" : null },
});
const row = (id: string, sourceRun: string, complete = false) => ({
	id,
	orderKey: id,
	boundary: null,
	automatic: null,
	entityId: "book",
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
const harness = (rows: readonly ReturnType<typeof row>[]) => {
	const indexes = new Map(rows.map((value, index) => [value.id, index]));
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: (document) => {
			const after = cursorId(document.queries["rows"]?.where);
			const start = after === undefined ? 0 : (indexes.get(after) ?? -1) + 1;
			const items = rows.slice(start, start + 50);
			return Effect.succeed({ data: { rows: responseRows(items, start + 50 < rows.length) } });
		},
	});
	const run = (checkpoint: Schema.Json = null, eventSchemaSlug = "progress") =>
		Effect.gen(function* () {
			const input = yield* Schema.decodeEffect(EventStreamStepInput)({
				checkpoint,
				eventSchemaSlug,
				dirtyFrom: null,
				entityId: "book",
			});
			return yield* definition.run(input, host);
		});
	return { run };
};

describe("production consumption stream", () => {
	it.effect(
		"restarts the production script across 100,000 observations with UTF-8 bounded checkpoints",
		() =>
			Effect.gen(function* () {
				const sources = Array.from(mediaConsumptionLongTitleSources(), (source, index) => ({
					...row(source.id, source.properties.sourceRun ?? ""),
					properties: {
						progressPages: (index + 1) / 4,
						sourceRun: source.properties.sourceRun ?? "",
						consumptionBasis: { unit: "pages", total: 100_000, property: "pages" },
					},
				}));
				const test = harness(sources);
				let checkpoint: Schema.Json = null;
				let count = 0;
				let amount = 0;
				let done = false;
				for (let step = 0; step < 3000; step += 1) {
					const result = yield* test.run(checkpoint);
					expect(result.updates.length).toBeLessThanOrEqual(100);
					const encoded: string = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
						result.checkpoint,
					);
					expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(16_384);
					checkpoint = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(encoded);
					for (const update of result.updates) {
						const contribution = yield* Schema.decodeUnknownEffect(ConsumptionContribution)(
							update.properties["contribution"],
						);
						amount += contribution.pages?.recorded ?? 0;
						count++;
					}
					if (result.done) {
						done = true;
						break;
					}
				}
				expect(done).toBe(true);
				expect(count).toBe(100_000);
				expect(amount).toBe(25_000);
			}),
	);
	it("uses one bounded rows query per page", () => {
		for (const after of [
			null,
			{
				id: "source",
				orderKey: "source",
				group: "source:run",
				occurredAt: instant,
				orderCreatedAt: instant,
			},
		]) {
			const recipe = consumptionPageRecipe({ after, entityId: "book" });
			expect(
				validateRyotQLDocument(recipe.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
			expect(Object.keys(recipe.document.queries)).toEqual(["rows"]);
		}
	});
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
					const result = yield* test.run(checkpoint, "complete");
					expect(result.updates.length).toBeLessThanOrEqual(100);
					const serialized: string = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
						result.checkpoint,
					);
					expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(16384);
					checkpoint = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(serialized);
					for (const update of result.updates) {
						expect(update.eventId.endsWith(":b")).toBe(true);
						const value = yield* Schema.decodeUnknownEffect(ConsumptionContribution)(
							update.properties["contribution"],
						);
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
				const first = yield* test.run();
				expect(first.done).toBe(false);
				expect(first.updates).toEqual([]);
				let checkpoint = first.checkpoint;
				let amount = 0;
				let done = false;
				for (let step = 0; step < 100; step += 1) {
					const result = yield* test.run(checkpoint);
					checkpoint = result.checkpoint;
					for (const update of result.updates) {
						const value = yield* Schema.decodeUnknownEffect(ConsumptionContribution)(
							update.properties["contribution"],
						);
						amount += value.pages?.recorded ?? 0;
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
				const replay = yield* edited.run(null);
				expect(replay.done).toBe(true);
				expect(replay.updates[0]?.properties).toMatchObject({
					contribution: { pages: { recorded: 25 } },
				});
			}),
	);
});
