import { assert, expect, layer } from "@effect/vitest";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type {
	JsonElementsJoin,
	RowItem,
	RyotQLDocument,
	RyotQLResponse,
} from "@ryot-app/contract/modules/ryotql/language";
import { PluginId, PluginRevisionId, UserId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	castDate,
	column,
	conditional,
	count,
	descending,
	eq,
	field,
	first,
	gte,
	include,
	inArray,
	join,
	isNotNull,
	jsonElementsJoin,
	jsonPath,
	literal,
	pluginId,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { RyotQLService } from "./service";

const owner = UserId.make("owner");
const entity = table("entity", "entity");
const items = jsonPath(column(entity, "properties"), "items");
const element = jsonElementsJoin("inner", "element", items);
const startsAt = (elements: JsonElementsJoin) =>
	castDate(jsonPath(column(elements, "value"), "startsAt"));
const schedule = [
	{ rank: 1, startsAt: "2026-03-03T00:00:00.000Z" },
	{ rank: 2, startsAt: "2026-01-01T00:00:00.000Z" },
	{ rank: 3, startsAt: "2026-02-02T00:00:00.000Z" },
];

const seedEntities = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db.insert(tables.entity).values([
			{
				id: "three",
				name: "Three",
				userId: owner,
				entitySchemaSlug: "item",
				properties: { items: schedule },
			},
			{
				userId: owner,
				id: "null-element",
				name: "Null element",
				entitySchemaSlug: "item",
				properties: { items: [null] },
			},
			{
				id: "null",
				name: "Null",
				userId: owner,
				entitySchemaSlug: "item",
				properties: { items: null },
			},
			{ id: "missing", userId: owner, properties: {}, name: "Missing", entitySchemaSlug: "item" },
			{
				id: "object",
				userId: owner,
				name: "Object",
				entitySchemaSlug: "item",
				properties: { items: { rank: 1 } },
			},
			{
				id: "scalar",
				userId: owner,
				name: "Scalar",
				entitySchemaSlug: "item",
				properties: { items: 5 },
			},
			{
				id: "text",
				name: "Text",
				userId: owner,
				entitySchemaSlug: "item",
				properties: { items: "[1]" },
			},
			{
				id: "empty",
				userId: owner,
				name: "Empty",
				entitySchemaSlug: "item",
				properties: { items: [] },
			},
			{
				id: "two",
				name: "Two",
				userId: owner,
				entitySchemaSlug: "item",
				properties: { items: [{ rank: 1 }, { rank: 2 }] },
			},
			{
				id: "hidden",
				name: "Hidden",
				entitySchemaSlug: "item",
				properties: { items: schedule },
				userId: UserId.make("recipient"),
			},
		]),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seedEntities)).pipe(
	Layer.provideMerge(revisionDatabaseLayer),
);

const ownedElements = (reference: PluginIdentityReference, after?: string) => {
	const elements = jsonElementsJoin(
		"inner",
		"element",
		conditional(isNotNull(pluginId(reference)), items, literal(null)),
	);
	return {
		queries: {
			rows: rows(entity, {
				after,
				limit: 1,
				joins: [elements],
				where: eq(column(entity, "id"), literal("three")),
				fields: [field("ordinal", column(elements, "ordinal"))],
			}),
		},
	};
};

const rowsOf = (response: RyotQLResponse) => {
	const result = response.data["rows"];
	assert(result?.type === "rows");
	return result;
};

const executeRows = (query: RyotQLDocument["queries"][string]) =>
	Effect.gen(function* () {
		const service = yield* RyotQLService;
		return rowsOf(
			yield* service.executeForUser(owner, null, "kernel", { queries: { rows: query } }),
		);
	});

layer(databaseLayer)((test) => {
	test.effect("emits one row per visible array element and none for non-array values", () =>
		Effect.gen(function* () {
			const result = yield* executeRows(
				rows(entity, {
					limit: 100,
					joins: [element],
					fields: [
						field("id", column(entity, "id")),
						{ type: "wildcard", tableAlias: "element" },
						field("rank", jsonPath(column(element, "value"), "rank")),
					],
				}),
			);

			expect(result.items).toEqual([
				{ ordinal: 1, rank: null, value: null, id: "null-element" },
				{ rank: 1, ordinal: 1, id: "three", value: schedule[0] },
				{ rank: 2, ordinal: 2, id: "three", value: schedule[1] },
				{ rank: 3, ordinal: 3, id: "three", value: schedule[2] },
				{ rank: 1, id: "two", ordinal: 1, value: { rank: 1 } },
				{ rank: 2, id: "two", ordinal: 2, value: { rank: 2 } },
			]);
			expect(result.pageInfo).toEqual({ limit: 100, hasMore: false, nextCursor: null });

			const service = yield* RyotQLService;
			const recipient = yield* service.executeForUser("recipient", null, "kernel", {
				queries: {
					rows: rows(entity, {
						joins: [element],
						fields: [
							field("id", column(entity, "id")),
							field("ordinal", column(element, "ordinal")),
						],
					}),
				},
			});
			expect(rowsOf(recipient).items).toEqual([
				{ ordinal: 1, id: "hidden" },
				{ ordinal: 2, id: "hidden" },
				{ ordinal: 3, id: "hidden" },
			]);
		}),
	);

	test.effect("filters and orders by date values read from elements", () =>
		Effect.gen(function* () {
			const result = yield* executeRows(
				rows(entity, {
					joins: [element],
					orderBy: [descending(startsAt(element))],
					where: gte(startsAt(element), castDate(literal("2026-02-01T00:00:00.000Z"))),
					fields: [
						field("startsAt", startsAt(element)),
						field("ordinal", column(element, "ordinal")),
					],
				}),
			);

			expect(result.items).toEqual([
				{ ordinal: 1, startsAt: "2026-03-03T00:00:00.000Z" },
				{ ordinal: 3, startsAt: "2026-02-02T00:00:00.000Z" },
			]);
		}),
	);

	test.effect("pages through the elements of one parent exactly once with cursors", () =>
		Effect.gen(function* () {
			const pages = (orderBy: Parameters<typeof rows>[1]["orderBy"]) =>
				Effect.gen(function* () {
					const seen: RowItem[] = [];
					let after: string | undefined;
					do {
						const page = yield* executeRows(
							rows(entity, {
								after,
								orderBy,
								limit: 1,
								joins: [element],
								where: eq(column(entity, "id"), literal("three")),
								fields: [field("ordinal", column(element, "ordinal"))],
							}),
						);
						seen.push(...page.items);
						after = page.pageInfo.nextCursor ?? undefined;
					} while (after);
					return seen;
				});

			expect(yield* pages(undefined)).toEqual([{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }]);
			expect(yield* pages([ascending(startsAt(element))])).toEqual([
				{ ordinal: 2 },
				{ ordinal: 3 },
				{ ordinal: 1 },
			]);
		}),
	);

	test.effect("orders elements deterministically inside includes and first", () =>
		Effect.gen(function* () {
			const child = table("entity", "child");
			const childElement = jsonElementsJoin(
				"inner",
				"childElement",
				jsonPath(column(child, "properties"), "items"),
			);
			const peer = table("entity", "peer");
			const peerElement = jsonElementsJoin(
				"inner",
				"peerElement",
				jsonPath(column(peer, "properties"), "items"),
			);
			const result = yield* executeRows(
				rows(entity, {
					where: eq(column(entity, "id"), literal("three")),
					include: [
						include(child, {
							limit: 2,
							key: "elements",
							joins: [childElement],
							orderBy: [ascending(column(child, "id"))],
							where: eq(column(child, "id"), column(entity, "id")),
							fields: [field("ordinal", column(childElement, "ordinal"))],
						}),
					],
					fields: [
						field(
							"firstRank",
							first(peer, {
								joins: [peerElement],
								orderBy: [ascending(column(peer, "id"))],
								where: eq(column(peer, "id"), column(entity, "id")),
								select: jsonPath(column(peerElement, "value"), "rank"),
							}),
						),
						field(
							"elementCount",
							count(peer, {
								joins: [peerElement],
								where: eq(column(peer, "id"), column(entity, "id")),
							}),
						),
					],
				}),
			);

			expect(result.items).toEqual([
				{
					firstRank: 1,
					elementCount: 3,
					elements: {
						pageInfo: { limit: 2, hasMore: true },
						items: [{ ordinal: 1 }, { ordinal: 2 }],
					},
				},
			]);
		}),
	);

	test.effect("keeps caller aliases out of SQL", () =>
		Effect.gen(function* () {
			const hostile = jsonElementsJoin("inner", 'element"; DROP TABLE entity; --)', items);
			const result = yield* executeRows(
				rows(entity, {
					joins: [hostile],
					where: inArray(column(entity, "id"), [literal("three"), literal("null-element")]),
					fields: [
						field("id", column(entity, "id")),
						field("ordinal", column(hostile, "ordinal")),
						field("present", isNotNull(column(hostile, "value"))),
					],
				}),
			);

			expect(result.items).toEqual([
				{ ordinal: 1, present: false, id: "null-element" },
				{ ordinal: 1, id: "three", present: true },
				{ ordinal: 2, id: "three", present: true },
				{ ordinal: 3, id: "three", present: true },
			]);
			const remaining = yield* executeRows(
				rows(entity, { limit: 100, fields: [field("id", column(entity, "id"))] }),
			);
			expect(remaining.items).toHaveLength(9);
		}),
	);

	test.effect("binds plugin identities in element expressions into the cursor owner", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const alpha = yield* installRevisionPackage(revisionPackage("alpha"), owner);
			const beta = yield* installRevisionPackage(revisionPackage("beta"), owner);
			const alphaReference = { kind: "local", pluginId: PluginId.make(alpha.pluginId) } as const;
			const betaReference = { kind: "local", pluginId: PluginId.make(beta.pluginId) } as const;
			const firstPage = rowsOf(
				yield* service.executeForUser(owner, null, "plugin", ownedElements(alphaReference)),
			);
			const cursor = firstPage.pageInfo.nextCursor;
			assert(cursor !== null);

			expect(
				rowsOf(
					yield* service.executeForUser(
						owner,
						null,
						"plugin",
						ownedElements(alphaReference, cursor),
					),
				).items,
			).toEqual([{ ordinal: 2 }]);
			expect(
				yield* Effect.flip(
					service.executeForUser(owner, null, "plugin", ownedElements(betaReference, cursor)),
				),
			).toMatchObject({ reason: { code: "invalid-cursor" } });

			const self = { kind: "self" } as const;
			const definitionContext = {
				pluginId: PluginId.make(alpha.pluginId),
				pluginRevisionId: PluginRevisionId.make(alpha.revisionId),
			};
			expect(
				rowsOf(
					yield* service.executeForUser(
						owner,
						null,
						"plugin",
						ownedElements(self),
						"standard",
						undefined,
						definitionContext,
					),
				).items,
			).toEqual([{ ordinal: 1 }]);
			expect(
				yield* Effect.flip(service.executeForUser(owner, null, "plugin", ownedElements(self))),
			).toMatchObject({
				reason: { reference: self, issue: "self-unbound", code: "unresolved-query-owner" },
			});
		}),
	);

	test.effect("keeps parents without elements once in left mode", () =>
		Effect.gen(function* () {
			const left = jsonElementsJoin("left", "element", items);
			const ids = ["empty", "null", "missing", "object", "scalar", "text", "two"];
			const result = yield* executeRows(
				rows(entity, {
					limit: 100,
					joins: [left],
					where: inArray(
						column(entity, "id"),
						ids.map((id) => literal(id)),
					),
					fields: [
						field("id", column(entity, "id")),
						field("ordinal", column(left, "ordinal")),
						field("value", column(left, "value")),
					],
				}),
			);

			expect(result.items).toEqual([
				{ value: null, id: "empty", ordinal: null },
				{ value: null, id: "missing", ordinal: null },
				{ id: "null", value: null, ordinal: null },
				{ value: null, id: "object", ordinal: null },
				{ value: null, id: "scalar", ordinal: null },
				{ id: "text", value: null, ordinal: null },
				{ id: "two", ordinal: 1, value: { rank: 1 } },
				{ id: "two", ordinal: 2, value: { rank: 2 } },
			]);
		}),
	);

	test.effect("keeps or drops the parent of an unmatched left-joined table by element mode", () =>
		Effect.gen(function* () {
			const partner = table("entity", "partner");
			const partnerItems = jsonPath(column(partner, "properties"), "items");
			const query = (mode: "inner" | "left") => {
				const partnerElement = jsonElementsJoin(mode, "partnerElement", partnerItems);
				return rows(entity, {
					where: eq(column(entity, "id"), literal("three")),
					joins: [
						join("left", partner, eq(column(partner, "id"), literal("unmatched"))),
						partnerElement,
					],
					fields: [
						field("id", column(entity, "id")),
						field("ordinal", column(partnerElement, "ordinal")),
						field("value", column(partnerElement, "value")),
					],
				});
			};

			expect((yield* executeRows(query("left"))).items).toEqual([
				{ value: null, id: "three", ordinal: null },
			]);
			expect((yield* executeRows(query("inner"))).items).toEqual([]);
		}),
	);

	test.effect("pages exactly across left-mode parents with and without elements", () =>
		Effect.gen(function* () {
			const left = jsonElementsJoin("left", "element", items);
			const pages = (orderBy: Parameters<typeof rows>[1]["orderBy"]) =>
				Effect.gen(function* () {
					const seen: RowItem[] = [];
					let after: string | undefined;
					do {
						const page = yield* executeRows(
							rows(entity, {
								after,
								orderBy,
								limit: 1,
								joins: [left],
								where: inArray(column(entity, "id"), [literal("empty"), literal("two")]),
								fields: [
									field("id", column(entity, "id")),
									field("ordinal", column(left, "ordinal")),
								],
							}),
						);
						seen.push(...page.items);
						after = page.pageInfo.nextCursor ?? undefined;
					} while (after);
					return seen;
				});

			expect(yield* pages(undefined)).toEqual([
				{ id: "empty", ordinal: null },
				{ id: "two", ordinal: 1 },
				{ id: "two", ordinal: 2 },
			]);
			expect(yield* pages([descending(column(entity, "id"))])).toEqual([
				{ id: "two", ordinal: 1 },
				{ id: "two", ordinal: 2 },
				{ id: "empty", ordinal: null },
			]);
			expect(yield* pages([descending(column(left, "ordinal"))])).toEqual([
				{ id: "two", ordinal: 2 },
				{ id: "two", ordinal: 1 },
				{ id: "empty", ordinal: null },
			]);
		}),
	);
});
