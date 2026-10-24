import { assert, expect, layer } from "@effect/vitest";
import type {
	NamedQuery,
	Predicate,
	RowItem,
	TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	count,
	countDistinct,
	descending,
	eq,
	exists,
	field,
	isNotNull,
	join,
	jsonArrayExists,
	jsonElement,
	jsonPath,
	literal,
	or,
	rows,
	sum,
	table,
} from "@ryot-app/ryotql";
import { sql } from "drizzle-orm";
import { Effect, Layer, Logger, References } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const root = table("entity", "root");
const source = table("event", "source");
const batch = table("entity", "batch");
const keyed = table("event", "keyed");
const occurredAt = new Date("2026-01-15");
const slot = (reference: TableReference) =>
	castNumber(jsonPath(column(reference, "properties"), "slot"));
const kind = (reference: TableReference) =>
	castText(jsonPath(column(reference, "properties"), "kind"));
const member = (reference: TableReference) =>
	jsonArrayExists(
		jsonPath(column(reference, "properties"), "members"),
		eq(castText(jsonElement()), column(root, "id")),
	);

const eventValues = (
	values: readonly {
		readonly id: string;
		readonly properties: Readonly<Record<string, JsonValue>>;
	}[],
	eventSchemaSlug: string,
) =>
	values.map(({ id, properties }) => ({
		id,
		occurredAt,
		eventSchemaSlug,
		userId: "owner",
		entityId: "subject",
		sessionEntityId: "batch",
		properties: { enabled: true, at: "2026-01-15", ...properties },
	}));

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: "owner", name: "Owner", email: "owner@example.test" },
				{ id: "other", name: "Other", email: "other@example.test" },
			]);
			yield* db
				.insert(tables.entity)
				.values([
					...["a", "b", "c", "d"].map((id) => ({
						id,
						name: id,
						userId: "owner",
						entitySchemaSlug: "root",
					})),
					{ id: "subject", name: "Subject", userId: "owner", entitySchemaSlug: "subject" },
					{
						id: "batch",
						name: "Batch",
						userId: "owner",
						entitySchemaSlug: "batch",
						properties: { slot: 1, kind: "x" },
					},
					{ id: "hidden", name: "Hidden", userId: "other", entitySchemaSlug: "batch" },
				]);
			const occurrences = [
				{ id: "one", properties: { slot: 1, score: 4, kind: "x", members: ["a", "b"] } },
				{ id: "duplicate", properties: { slot: 1, score: 2, kind: "x", members: ["a"] } },
				{ id: "two", properties: { slot: 2, score: 4, kind: "y", members: ["b"] } },
				{ id: "null-score", properties: { slot: 3, kind: "z", score: null, members: ["c"] } },
				{ id: "missing", properties: { score: 100, members: ["c"] } },
				{ id: "wrong-number", properties: { slot: "1", kind: "x", score: 100, members: ["a"] } },
				{ id: "wrong-text", properties: { slot: 1, kind: 1, score: 100, members: ["a"] } },
				{ id: "null-key", properties: { slot: null, kind: null, score: 100, members: ["c"] } },
			];
			const keys = [
				{ id: "key-one", properties: { slot: 1, kind: "x" } },
				{ id: "key-duplicate", properties: { slot: 1, kind: "x" } },
				{ id: "key-two", properties: { slot: 2, kind: "y" } },
				{ id: "key-three", properties: { slot: 3, kind: "z" } },
				{ properties: {}, id: "key-missing" },
				{ id: "key-null", properties: { slot: null, kind: null } },
				{ id: "key-wrong-number", properties: { slot: "1", kind: "x" } },
				{ id: "key-wrong-text", properties: { slot: 3, kind: 5 } },
				{ id: "key-invalid-date", properties: { slot: 1, kind: "x", at: "2026-02-30" } },
				{ id: "key-infinite-date", properties: { slot: 1, kind: "x", at: "infinity" } },
				{ id: "key-wrong-boolean", properties: { slot: 1, kind: "x", enabled: "true" } },
			];
			yield* db
				.insert(tables.event)
				.values([...eventValues(occurrences, "occurrence"), ...eventValues(keys, "key")]);
			yield* db.insert(tables.event).values([
				{
					occurredAt,
					userId: "other",
					id: "foreign-key",
					entityId: "subject",
					eventSchemaSlug: "key",
					sessionEntityId: "batch",
					properties: { slot: 1, kind: "x", enabled: true, at: "2026-01-15" },
				},
				{
					occurredAt,
					userId: "owner",
					id: "hidden-batch",
					entityId: "subject",
					sessionEntityId: "hidden",
					eventSchemaSlug: "occurrence",
					properties: { slot: 1, kind: "x", score: 100, members: ["a"] },
				},
				{
					occurredAt,
					userId: "owner",
					entityId: "subject",
					id: "key-out-of-range",
					eventSchemaSlug: "key",
					sessionEntityId: "batch",
					properties: sql`'{"slot":1e400,"kind":"x","at":"2026-01-15","enabled":true}'::jsonb`,
				},
			]);
		}),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_aggregate_join_keys")),
);

const execute = Effect.fn(function* (
	query: NamedQuery,
	userId = "owner",
	language: null | string = null,
) {
	const service = yield* RyotQLService;
	let statement = "";
	const logger = Logger.make((entry) => {
		const value = entry.fiber.getRef(References.CurrentLogAnnotations)["sql"];
		if (typeof value === "string") {
			statement = value;
		}
	});
	const result = (yield* service
		.executeForUser(userId, language, "plugin", { queries: { rows: query } })
		.pipe(
			Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
			Effect.provideService(References.MinimumLogLevel, "Trace"),
		)).data["rows"];
	assert(result?.type === "rows");
	assert(statement.length > 0);
	return { result, statement };
});

const ranking = (
	options: {
		readonly extra?: Predicate;
		readonly baseline?: boolean;
		readonly defaults?: boolean;
		readonly mode?: "left" | "inner";
		readonly after?: string | undefined;
	} = {},
) => {
	const on = and(
		eq(column(keyed, "userId"), column(source, "userId")),
		eq(column(keyed, "entityId"), column(source, "entityId")),
		eq(column(keyed, "sessionEntityId"), column(source, "sessionEntityId")),
		eq(column(keyed, "eventSchemaSlug"), literal("key")),
		eq(options.defaults ? coalesce(slot(keyed), literal(3)) : slot(keyed), slot(source)),
		eq(options.defaults ? coalesce(kind(keyed), literal("z")) : kind(keyed), kind(source)),
		eq(
			castDate(jsonPath(column(keyed, "properties"), "at")),
			castDate(jsonPath(column(source, "properties"), "at")),
		),
		eq(
			castBoolean(jsonPath(column(keyed, "properties"), "enabled")),
			castBoolean(jsonPath(column(source, "properties"), "enabled")),
		),
	);
	const query = {
		where: and(
			eq(column(source, "eventSchemaSlug"), literal("occurrence")),
			member(source),
			...(options.extra ? [options.extra] : []),
		),
		joins: [
			join("inner", batch, eq(column(source, "sessionEntityId"), column(batch, "id"))),
			join(options.mode ?? "inner", keyed, options.baseline ? or(on) : on),
		],
	};
	const total = sum(source, castNumber(jsonPath(column(source, "properties"), "score")), query);
	return rows(root, {
		limit: 1,
		after: options.after,
		orderBy: [descending(total)],
		where: eq(column(root, "entitySchemaSlug"), literal("root")),
		fields: [
			field("id", column(root, "id")),
			field("total", total),
			field("count", count(source, query)),
			field("keys", countDistinct(source, column(keyed, "id"), query)),
			field("sources", countDistinct(source, column(source, "id"), query)),
			field("batches", countDistinct(source, column(batch, "id"), query)),
		],
	});
};

const nestedRanking = (baseline: boolean) => {
	const parent = table("entity", "parent");
	const keyJoin = and(
		eq(slot(keyed), slot(source)),
		eq(kind(keyed), kind(source)),
		eq(column(keyed, "eventSchemaSlug"), literal("key")),
	);
	const nestedCount = (id: string) =>
		count(source, {
			joins: [join("inner", keyed, baseline ? or(keyJoin) : keyJoin)],
			where: and(member(source), eq(column(source, "id"), literal(id))),
		});
	return rows(root, {
		where: eq(column(root, "id"), literal("a")),
		fields: [
			field("one", nestedCount("one")),
			field("two", nestedCount("two")),
			field(
				"nested",
				sum(parent, nestedCount("duplicate"), {
					where: eq(column(parent, "id"), literal("batch")),
				}),
			),
		],
	});
};

const localizedRanking = (baseline: boolean) => {
	const on = and(eq(slot(batch), slot(source)), eq(kind(batch), kind(source)));
	const query = {
		joins: [join("inner", batch, baseline ? or(on) : on)],
		where: and(member(source), eq(column(source, "eventSchemaSlug"), literal("occurrence"))),
	};
	return rows(root, {
		where: eq(column(root, "id"), literal("b")),
		fields: [
			field("count", count(source, query)),
			field("total", sum(source, slot(source), query)),
		],
	});
};

layer(databaseLayer)((test) => {
	test.effect(
		"shares narrow typed keys without changing duplicate measures or tied cursor pages",
		() =>
			Effect.gen(function* () {
				const items: RowItem[] = [];
				let after: string | undefined;
				do {
					const actual = yield* execute(ranking({ after }));
					const baseline = yield* execute(ranking({ after, baseline: true }));
					expect(actual.result).toEqual(baseline.result);
					expect(actual.statement.match(/AS MATERIALIZED \(/g)).toHaveLength(1);
					expect(actual.statement.match(/AS "joinKey\d+"/g)).toHaveLength(4);
					expect(actual.statement).toMatch(/INNER JOIN "aggregateSource\d+"/);
					expect(
						actual.statement.match(
							/CROSS JOIN LATERAL \(SELECT COUNT|CROSS JOIN LATERAL \(SELECT SUM/g,
						),
					).toHaveLength(1);
					expect(baseline.statement).not.toContain('"joinKey0"');
					items.push(...actual.result.items);
					after = actual.result.pageInfo.nextCursor ?? undefined;
				} while (after);
				expect(items).toEqual([
					{ id: "a", keys: 2, count: 4, total: 12, sources: 2, batches: 1 },
					{ id: "b", keys: 3, count: 3, total: 12, sources: 2, batches: 1 },
					{ id: "c", keys: 1, count: 1, sources: 1, batches: 1, total: null },
					{ id: "d", keys: 0, count: 0, sources: 0, batches: 0, total: null },
				]);
				expect((yield* execute(ranking(), "other")).result.items).toEqual([]);
				const extra = eq(column(keyed, "id"), literal("missing"));
				const empty = yield* execute(ranking({ extra }));
				expect(empty.result).toEqual((yield* execute(ranking({ extra, baseline: true }))).result);
				expect(empty.result.items).toEqual([
					{ id: "a", keys: 0, count: 0, sources: 0, batches: 0, total: null },
				]);
				expect(empty.result.pageInfo.hasMore).toBe(true);
			}),
	);

	test.effect("keeps missing, malformed and null keys under their original default coalesces", () =>
		Effect.gen(function* () {
			const query = ranking({ defaults: true });
			const actual = yield* execute({
				...query,
				output: { ...query.output, pagination: { limit: 100 } },
			});
			const baseline = ranking({ defaults: true, baseline: true });
			expect(actual.result).toEqual(
				(yield* execute({
					...baseline,
					output: { ...baseline.output, pagination: { limit: 100 } },
				})).result,
			);
			expect(actual.statement).toContain('AS "joinKey0"');
			expect(actual.result.items[2]).toEqual({
				id: "c",
				keys: 4,
				count: 4,
				sources: 1,
				batches: 1,
				total: null,
			});
		}),
	);

	test.effect(
		"leaves nullable joins and physical ancestor connections on their original source path",
		() =>
			Effect.gen(function* () {
				for (const options of [
					{ mode: "left" as const },
					{ extra: eq(column(batch, "id"), column(root, "id")) },
				]) {
					const actual = yield* execute(ranking(options));
					expect(actual.result).toEqual(
						(yield* execute(ranking({ ...options, baseline: true }))).result,
					);
					expect(actual.statement).not.toContain('"joinKey0"');
				}
			}),
	);

	test.effect(
		"does not drop JSON needed outside the exact keys or move keys across subqueries",
		() =>
			Effect.gen(function* () {
				const nested = table("event", "nested");
				for (const extra of [
					isNotNull(jsonPath(column(keyed, "properties"), "kind")),
					exists(nested, { where: eq(column(nested, "id"), column(keyed, "id")) }),
				]) {
					const actual = yield* execute(ranking({ extra }));
					expect(actual.result).toEqual(
						(yield* execute(ranking({ extra, baseline: true }))).result,
					);
					expect(actual.result.items[0]?.["count"]).toBe(4);
					expect(actual.statement).not.toContain('"joinKey0"');
				}
			}),
	);

	test.effect("isolates identical key ASTs in sibling and nested lexical aggregate scopes", () =>
		Effect.gen(function* () {
			const actual = yield* execute(nestedRanking(false));
			expect(actual.result).toEqual((yield* execute(nestedRanking(true))).result);
			expect(actual.result.items).toEqual([{ one: 5, two: 0, nested: 5 }]);
			expect(actual.statement.match(/AS MATERIALIZED \(/g)).toHaveLength(3);
		}),
	);

	test.effect("does not replace localized entity properties with canonical raw payloads", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.entityTranslation)
					.values({
						language: "es",
						entityId: "batch",
						populatedAt: occurredAt,
						sourceContentGeneration: 1,
						properties: { slot: 2, kind: "y" },
					}),
			);
			const actual = yield* execute(localizedRanking(false), "owner", "es");
			expect(actual.result).toEqual((yield* execute(localizedRanking(true), "owner", "es")).result);
			expect(actual.result.items).toEqual([{ count: 1, total: 2 }]);
			expect(actual.statement).not.toContain('"joinKey0"');
			expect((yield* execute(localizedRanking(false))).result.items).toEqual([
				{ count: 1, total: 1 },
			]);
		}),
	);
});
