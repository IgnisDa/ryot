import { expect } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { encodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import type { ExecutionSource } from "@ryot-app/contract/modules/ryotql/request";
import { EntityId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { collectionArguments, collectionMembersRecipe } from "@ryot-app/ryotql-recipes/collections";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const selection: RyotQLDocument = {
	parameters: {
		fields: {
			prefix: { type: "string", label: "Prefix", defaultValue: "A", description: "Name prefix" },
		},
	},
	queries: {
		items: {
			from: { alias: "item", table: "entity" },
			output: {
				type: "rows",
				pagination: { limit: 1, maxLimit: 10 },
				fields: [{ key: "id", expr: { field: "id", type: "column", tableAlias: "item" } }],
				orderBy: [{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "item" } }],
			},
			where: {
				type: "and",
				predicates: [
					{
						type: "startsWith",
						right: { name: "prefix", type: "parameter" },
						left: { field: "name", type: "column", tableAlias: "item" },
					},
					{
						operator: "gte",
						type: "comparison",
						left: { type: "column", tableAlias: "item", field: "createdAt" },
						right: { amount: -100, unit: "year", type: "dateAdd", expr: { type: "now" } },
					},
				],
			},
		},
	},
};
const entities: RyotQLDocument = {
	parameters: {
		fields: {
			source: {
				type: "string",
				label: "Source",
				validation: { required: true },
				description: "Stored selection",
				reference: { kind: "entity-source" },
			},
		},
	},
	queries: {
		items: {
			from: { alias: "selection", parameter: "source", type: "sourceEntity" },
			output: {
				type: "rows",
				pagination: { limit: 1, maxLimit: 10 },
				fields: [
					{ key: "id", expr: { type: "column", field: "entityId", tableAlias: "selection" } },
				],
				orderBy: [
					{ direction: "asc", expr: { field: "rank", type: "column", tableAlias: "selection" } },
				],
			},
		},
	},
};
const settings = {
	pageSize: 10,
	addAction: null,
	layouts: ["grid"],
	tableColumns: null,
	sourceName: "items",
	defaultLayout: "grid",
	summary: { image: null, subtitle: null },
	subject: { entityAlias: "item", schemas: [{ slug: "root", owner: { kind: "kernel" } }] },
} as const;
const savedReference = { kind: "custom", savedViewId: SavedViewId.make("saved") } as const;
const collection = encodeEntitySourceReference({
	kind: "collection",
	collectionId: EntityId.make("shelf"),
});
const savedSource = encodeEntitySourceReference({ kind: "saved-view", reference: savedReference });

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: "owner", name: "Owner", email: "owner@test.local" },
				{ id: "other", name: "Other", email: "other@test.local" },
			]);
			yield* db.insert(tables.entity).values([
				{ id: "a", name: "Alpha", userId: "owner", entitySchemaSlug: "root" },
				{ id: "b", name: "Another", userId: "owner", entitySchemaSlug: "root" },
				{ id: "c", name: "Beta", userId: "owner", entitySchemaSlug: "root" },
				{ id: "shelf", name: "Shelf", userId: "owner", entitySchemaSlug: "collection" },
			]);
			yield* db.insert(tables.relationship).values([
				{
					userId: "owner",
					id: "membership-a",
					sourceEntityId: "a",
					targetEntityId: "shelf",
					properties: { rank: 1 },
					relationshipSchemaSlug: "member-of",
				},
				{
					userId: "owner",
					id: "membership-b",
					sourceEntityId: "b",
					targetEntityId: "shelf",
					properties: { rank: 2 },
					relationshipSchemaSlug: "member-of",
				},
			]);
			yield* db
				.insert(tables.savedView)
				.values({
					settings,
					id: "saved",
					icon: "box",
					slug: "saved",
					name: "Saved",
					dataSources: selection,
					arguments: { prefix: "A" },
					userId: UserId.make("owner"),
					renderer: { kind: "kernel", name: "entity-browser" },
				});
			yield* db
				.insert(tables.definitionEntitySchema)
				.values({
					icon: "box",
					position: 0,
					slug: "unsafe",
					name: "Unsafe",
					mergeIdentityProperties: [],
					propertiesSchema: { fields: {} },
					browse: {
						fields: [
							{
								key: "owner",
								type: "text",
								kind: "value",
								label: "Owner",
								expression: { type: "column", field: "userId", tableAlias: "subject" },
							},
						],
					},
				});
		}),
	);
});
const database = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_execution_reference")),
	Layer.provide(makeAppConfigLayer()),
);

layer(database)((test) => {
	test.effect("selects count alone while resolving its filter from the full rows projection", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const items = selection.queries["items"];
			assert(items);
			const document: RyotQLDocument = {
				...selection,
				controls: {
					filter: {
						query: "items",
						kind: "outputs",
						fields: [{ key: "id", field: "id", label: "ID", type: "text", kind: "value" }],
					},
				},
				queries: {
					items,
					count: {
						...items,
						where: {
							type: "and",
							predicates: [...(items.where === undefined ? [] : [items.where]), { type: "filter" }],
						},
						output: {
							limit: 1,
							maxLimit: 1,
							type: "aggregate",
							measures: [{ key: "count", aggregation: { function: "count" } }],
						},
					},
				},
			};
			const result = yield* service.executeForUser("owner", null, "plugin", {
				source: { document, kind: "inline", query: "count" },
				filter: {
					type: "or",
					filters: [
						{ value: "a", field: "id", operator: "is" },
						{ value: "b", field: "id", operator: "is" },
					],
				},
			});
			expect(Object.keys(result.data)).toEqual(["count"]);
			expect(result.data["count"]?.items).toEqual([{ count: 2 }]);
		}),
	);

	test.effect(
		"defaults arguments, binds date arithmetic and fences cursors without fencing the moving clock",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const first = yield* service.executeForUser("owner", null, "plugin", {
					source: { kind: "inline", document: selection },
				});
				const page = first.data["items"];
				assert(page?.type === "rows" && page.pageInfo.nextCursor);
				expect(page.items).toEqual([{ id: "a" }]);
				yield* TestClock.adjust("1 day");
				const request = {
					source: { kind: "inline", document: selection },
					pages: { items: { after: page.pageInfo.nextCursor } },
				} as const;
				const second = yield* service.executeForUser("owner", null, "plugin", request);
				expect(second.data["items"]?.items).toEqual([{ id: "b" }]);
				assertExitFails(
					yield* Effect.exit(
						service.executeForUser("owner", null, "plugin", {
							...request,
							arguments: { prefix: "B" },
						}),
					),
					new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						service.executeForUser("owner", null, "plugin", {
							source: request.source,
							arguments: { unexpected: true },
						}),
					),
					new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
				);
			}),
	);

	test.effect(
		"loads saved selections with their saved arguments and refuses another owner's reference",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const request = {
					arguments: { source: savedSource },
					source: { kind: "inline", document: entities },
				} as const;
				const result = yield* service.executeForUser("owner", null, "plugin", request);
				expect(result.data["items"]?.items).toEqual([{ id: "a" }]);
				assertExitFails(
					yield* Effect.exit(service.executeForUser("other", null, "plugin", request)),
					new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
				);
			}),
	);

	test.effect("fences collection cursors after a server-observed reorder", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const request = {
				arguments: { source: collection },
				source: { kind: "inline", document: entities },
			} as const;
			const first = (yield* service.executeForUser("owner", null, "plugin", request)).data["items"];
			assert(first?.type === "rows" && first.pageInfo.nextCursor);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.update(tables.relationship)
					.set({ properties: { rank: 3 } })
					.where(eq(tables.relationship.id, "membership-a")),
			);
			const stale = (yield* service.executeForUser("owner", null, "plugin", {
				...request,
				pages: { items: { after: first.pageInfo.nextCursor } },
			})).data["items"];
			expect(stale).toMatchObject({
				items: [],
				type: "rows",
				pageInfo: { stale: true, hasMore: false, nextCursor: null },
			});
			assert(stale?.type === "rows");
			expect(Object.values(stale.pageInfo.sourceRevisions ?? {})).toEqual(
				Object.values(first.pageInfo.sourceRevisions ?? {}).map((revision) => revision + 1),
			);
			for (const after of [
				first.pageInfo.nextCursor + "tampered",
				first.pageInfo.nextCursor.split(".")[0] ?? "",
			]) {
				assertExitFails(
					yield* Effect.exit(
						service.executeForUser("owner", null, "plugin", {
							...request,
							pages: { items: { after } },
						}),
					),
					new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
				);
			}
			assertExitFails(
				yield* Effect.exit(
					service.executeForUser("owner", null, "plugin", {
						...request,
						arguments: { source: savedSource },
						pages: { items: { after: first.pageInfo.nextCursor } },
					}),
				),
				new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
			);
		}),
	);

	test.effect("decodes an empty stale collection page with its current order revision", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const recipe = collectionMembersRecipe();
			const request = {
				arguments: collectionArguments("shelf"),
				source: { kind: "inline", query: recipe.query, document: recipe.document },
			} as const;
			const firstResponse = yield* service.executeForUser("owner", null, "kernel", {
				...request,
				pages: { members: { limit: 1 } },
			});
			const first = yield* Effect.fromResult(recipe.decode(firstResponse)).pipe(Effect.orDie);
			assert(first.pageInfo.nextCursor);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.update(tables.relationship)
					.set({ properties: { rank: 4 } })
					.where(eq(tables.relationship.id, "membership-a")),
			);
			const staleResponse = yield* service.executeForUser("owner", null, "kernel", {
				...request,
				pages: { members: { limit: 1, after: first.pageInfo.nextCursor } },
			});
			const stale = yield* Effect.fromResult(recipe.decode(staleResponse)).pipe(Effect.orDie);
			expect(stale).toMatchObject({
				items: [],
				stale: true,
				orderRevision: first.orderRevision + 1,
			});
		}),
	);

	test.effect("rejects source cycles before executing a materialized selection", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.savedView)
					.values({
						id: "cycle",
						icon: "box",
						slug: "cycle",
						name: "Cycle",
						userId: "owner",
						dataSources: entities,
						renderer: { kind: "kernel", name: "entity-browser" },
						settings: { ...settings, subject: { ...settings.subject, entityAlias: "selection" } },
						arguments: {
							source: encodeEntitySourceReference({
								kind: "saved-view",
								reference: { kind: "custom", savedViewId: SavedViewId.make("cycle") },
							}),
						},
					}),
			);
			const service = yield* RyotQLService;
			assertExitFails(
				yield* Effect.exit(
					service.executeForUser("owner", null, "plugin", {
						source: {
							query: "items",
							kind: "savedView",
							reference: { kind: "custom", savedViewId: SavedViewId.make("cycle") },
						},
					}),
				),
				new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
			);
		}),
	);

	test.effect("refuses stored visitor sources and hides owner-only browse metadata", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const publication = {
				language: null,
				subjectLimit: 100,
				ownerUserId: "owner",
				source: { kind: "collection" as const, collectionId: EntityId.make("shelf") },
			};
			const sources: readonly ExecutionSource[] = [
				{ query: "items", kind: "savedView", reference: savedReference },
				{ kind: "page", pageId: "page", query: "items" },
			];
			for (const source of sources) {
				assertExitFails(
					yield* Effect.exit(service.executeForPublication(publication, { source }, 1024)),
					new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
				);
			}
			const document: RyotQLDocument = {
				...selection,
				controls: {
					filter: {
						alias: "item",
						kind: "browse",
						schemas: [{ slug: "unsafe", owner: { kind: "kernel" } }],
					},
				},
			};
			assertExitFails(
				yield* Effect.exit(
					service.describeForPublication(publication, { document, kind: "inline" }),
				),
				new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
			);
		}),
	);
});
