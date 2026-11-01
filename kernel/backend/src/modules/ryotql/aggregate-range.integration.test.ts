import { assert, expect, layer } from "@effect/vitest";
import type { NamedQuery, Predicate, RowItem } from "@ryot-app/contract/modules/ryotql/language";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	count,
	countDistinct,
	descending,
	divide,
	eq,
	field,
	gte,
	join,
	jsonPath,
	literal,
	lt,
	or,
	rows,
	sum,
	table,
} from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const start = castDate(literal("2026-01-01"));
const end = castDate(literal("2026-02-01"));
const root = table("entity", "root");
const source = table("event", "source");
const batch = table("entity", "batch");
const at = castDate(jsonPath(column(batch, "properties"), "at"));

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
					{
						name: "In",
						id: "batch-in",
						userId: "owner",
						entitySchemaSlug: "batch",
						properties: { at: "2026-01-15" },
					},
					{
						name: "Out",
						id: "batch-out",
						userId: "owner",
						entitySchemaSlug: "batch",
						properties: { at: "2026-02-01" },
					},
					{
						name: "Foreign",
						userId: "other",
						id: "batch-foreign",
						entitySchemaSlug: "batch",
						properties: { at: "2026-01-15" },
					},
				]);
			yield* db.insert(tables.event).values(
				[
					{ id: "a-1", entityId: "a", properties: { score: 1 } },
					{ id: "a-2", entityId: "a", properties: { score: 2 } },
					{ id: "b-1", entityId: "b", properties: { score: 3 } },
					{ id: "d-1", entityId: "d", properties: { score: null } },
				].map(({ id, entityId, properties }) => ({
					id,
					entityId,
					properties,
					userId: "owner",
					eventSchemaSlug: "value",
					sessionEntityId: "batch-in",
					occurredAt: new Date("2026-01-15"),
				})),
			);
			yield* db.insert(tables.event).values(
				[
					{ id: "c-out", entityId: "c", userId: "owner", sessionEntityId: "batch-out" },
					{
						entityId: "c",
						userId: "owner",
						id: "c-foreign-source",
						sessionEntityId: "batch-foreign",
					},
					{ entityId: "c", userId: "other", id: "c-foreign-event", sessionEntityId: "batch-in" },
				].map(({ id, userId, entityId, sessionEntityId }) => ({
					id,
					userId,
					entityId,
					sessionEntityId,
					eventSchemaSlug: "value",
					properties: { score: 100 },
					occurredAt: new Date("2026-01-15"),
				})),
			);
		}),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_aggregate_range")),
);

const execute = Effect.fn(function* (
	query: NamedQuery,
	userId?: string,
	language: null | string = null,
) {
	const service = yield* RyotQLService;
	const result = (yield* service.executeForUser(userId ?? "owner", language, "plugin", {
		queries: { rows: query },
	})).data["rows"];
	assert(result?.type === "rows");
	return result;
});

const ranking = (baseline: boolean, after?: string, local?: Predicate) => {
	const range = and(gte(at, start), lt(at, end));
	const query = {
		joins: [
			join(
				"inner",
				batch,
				and(
					eq(column(source, "sessionEntityId"), column(batch, "id")),
					eq(column(batch, "entitySchemaSlug"), literal("batch")),
				),
			),
		],
		where: and(
			baseline ? or(range) : range,
			eq(column(source, "entityId"), column(root, "id")),
			or(eq(column(root, "id"), literal("a")), eq(column(batch, "id"), literal("batch-in"))),
			...(local ? [local] : []),
		),
	};
	const total = sum(source, castNumber(jsonPath(column(source, "properties"), "score")), query);
	return rows(root, {
		after,
		limit: 1,
		orderBy: [descending(total)],
		where: eq(column(root, "entitySchemaSlug"), literal("root")),
		fields: [
			field("id", column(root, "id")),
			field("total", total),
			field("count", count(source, query)),
			field("distinct", countDistinct(source, column(source, "id"), query)),
		],
	});
};

layer(databaseLayer)((test) => {
	test.effect("preserves tied cursor pages, null sums, empty groups and account isolation", () =>
		Effect.gen(function* () {
			const items: RowItem[] = [];
			let after: string | undefined;
			do {
				const result = yield* execute(ranking(false, after));
				expect(result).toEqual(yield* execute(ranking(true, after)));
				items.push(...result.items);
				after = result.pageInfo.nextCursor ?? undefined;
			} while (after);
			expect(items).toEqual([
				{ id: "a", total: 3, count: 2, distinct: 2 },
				{ id: "b", total: 3, count: 1, distinct: 1 },
				{ id: "c", count: 0, total: null, distinct: 0 },
				{ id: "d", count: 1, total: null, distinct: 1 },
			]);
			expect(yield* execute(ranking(false), "other")).toEqual(
				yield* execute(ranking(true), "other"),
			);
			expect((yield* execute(ranking(false), "other")).items).toEqual([]);
		}),
	);

	test.effect("retains roots when no local source qualifies", () =>
		Effect.gen(function* () {
			const missing = eq(column(batch, "id"), literal("missing"));
			const result = yield* execute(ranking(false, undefined, missing));
			expect(result).toEqual(yield* execute(ranking(true, undefined, missing)));
			expect(result.items).toEqual([{ id: "a", count: 0, total: null, distinct: 0 }]);
			expect(result.pageInfo.hasMore).toBe(true);
		}),
	);

	test.effect("preserves duplicate guards and weighted sums through multiplied inner joins", () =>
		Effect.gen(function* () {
			const matched = table("event", "matched");
			const results: RowItem[][] = [];
			for (const baseline of [false, true]) {
				const range = and(gte(at, start), lt(at, end));
				const query = {
					where: and(
						baseline ? or(range) : range,
						eq(column(source, "entityId"), column(root, "id")),
					),
					joins: [
						join("inner", batch, eq(column(source, "sessionEntityId"), column(batch, "id"))),
						join("inner", matched, eq(column(source, "entityId"), column(matched, "entityId"))),
					],
				};
				results.push([
					...(yield* execute(
						rows(root, {
							where: eq(column(root, "id"), literal("a")),
							fields: [
								field("count", count(source, query)),
								field("distinct", countDistinct(source, column(source, "id"), query)),
								field(
									"weighted",
									sum(
										source,
										divide(castNumber(jsonPath(column(source, "properties"), "score")), literal(2)),
										query,
									),
								),
							],
						}),
					)).items,
				]);
			}
			expect(results[0]).toEqual(results[1]);
			expect(results[0]).toEqual([{ count: 4, distinct: 2, weighted: 3 }]);
		}),
	);

	test.effect("keeps left-join ON and WHERE filters distinct", () =>
		Effect.gen(function* () {
			const range = and(gte(at, start), lt(at, end));
			const correlation = eq(column(source, "entityId"), column(root, "id"));
			for (const onRange of [true, false]) {
				const query = rows(root, {
					orderBy: [ascending(column(root, "id"))],
					where: eq(column(root, "entitySchemaSlug"), literal("root")),
					fields: [
						field("id", column(root, "id")),
						field(
							"count",
							count(source, {
								where: onRange ? correlation : and(correlation, range),
								joins: [
									join(
										"left",
										batch,
										and(
											eq(column(source, "sessionEntityId"), column(batch, "id")),
											...(onRange ? [range] : []),
										),
									),
								],
							}),
						),
					],
				});
				const result = yield* execute(query);
				expect(result.items).toEqual([
					{ id: "a", count: 2 },
					{ id: "b", count: 1 },
					{ id: "c", count: onRange ? 2 : 0 },
					{ id: "d", count: 1 },
				]);
			}
		}),
	);

	test.effect("keeps identical nested aliases in separate lexical aggregate groups", () =>
		Effect.gen(function* () {
			const nested = table("event", "source");
			const parent = table("entity", "batch");
			const makeQuery = (baseline: boolean) => {
				const range = and(
					gte(column(nested, "occurredAt"), start),
					lt(column(nested, "occurredAt"), end),
				);
				const nestedCount = count(nested, {
					where: and(
						baseline ? or(range) : range,
						eq(column(nested, "sessionEntityId"), column(parent, "id")),
					),
				});
				return rows(root, {
					where: eq(column(root, "id"), literal("a")),
					fields: [
						field(
							"nested",
							sum(parent, nestedCount, { where: eq(column(parent, "id"), literal("batch-in")) }),
						),
						field(
							"other",
							sum(parent, nestedCount, { where: eq(column(parent, "id"), literal("batch-out")) }),
						),
					],
				});
			};
			const result = yield* execute(makeQuery(false));
			expect(result).toEqual(yield* execute(makeQuery(true)));
			expect(result.items).toEqual([{ other: 1, nested: 4 }]);
		}),
	);

	test.effect("retains physical dependencies of localized source properties", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db.insert(tables.entityTranslation).values([
					{
						language: "es",
						entityId: "batch-in",
						populatedAt: new Date(),
						sourceContentGeneration: 1,
						properties: { at: "2026-02-01" },
					},
					{
						language: "es",
						entityId: "batch-out",
						populatedAt: new Date(),
						sourceContentGeneration: 1,
						properties: { at: "2026-01-15" },
					},
				]),
			);
			const results: RowItem[][] = [];
			for (const baseline of [false, true]) {
				const range = and(gte(at, start), lt(at, end));
				const query = rows(root, {
					where: eq(column(root, "id"), literal("c")),
					fields: [
						field(
							"count",
							count(source, {
								joins: [
									join("inner", batch, eq(column(source, "sessionEntityId"), column(batch, "id"))),
								],
								where: and(
									baseline ? or(range) : range,
									eq(column(source, "entityId"), column(root, "id")),
								),
							}),
						),
					],
				});
				results.push([...(yield* execute(query, "owner", "es")).items]);
			}
			expect(results[0]).toEqual(results[1]);
			expect(results[0]).toEqual([{ count: 1 }]);
		}),
	);
});
