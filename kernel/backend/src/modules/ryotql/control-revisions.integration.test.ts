import { expect } from "bun:test";

import type { QueryOwnerReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { PluginId, PluginRevisionId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { and, entitySchemaPredicate, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { RyotQLService } from "./service";

const owner = UserId.make("owner");
const selection = (definitionOwner: QueryOwnerReference): RyotQLDocument => ({
	controls: {
		sort: { alias: "item", kind: "browse", schemas: [{ slug: "item", owner: definitionOwner }] },
		filter: { alias: "item", kind: "browse", schemas: [{ slug: "item", owner: definitionOwner }] },
	},
	queries: {
		items: {
			from: { alias: "item", table: "entity" },
			output: {
				type: "rows",
				pagination: { limit: 1, maxLimit: 10 },
				orderBy: { type: "sort", otherwise: [] },
				fields: [{ key: "id", expr: { field: "id", type: "column", tableAlias: "item" } }],
			},
			where: and(
				{ type: "filter" },
				entitySchemaPredicate(table("entity", "item"), "item", definitionOwner),
				{
					operator: "gte",
					type: "comparison",
					left: { type: "column", tableAlias: "item", field: "createdAt" },
					right: { amount: -100, unit: "year", type: "dateAdd", expr: { type: "now" } },
				},
			),
		},
	},
});
const makePackage = (
	packageId: ReturnType<typeof testPluginPackageId>,
	revision: string,
	field: "id" | "name" | undefined,
	document = selection({ kind: "self" }),
) => {
	const value = revisionPackage("controls", revision, "item", packageId);
	return {
		...value,
		manifest: {
			...value.manifest,
			queries: { items: { document, description: "Browse items" } },
			entitySchemas: value.manifest.entitySchemas.map((schema) =>
				Object.assign(
					{},
					schema,
					field === undefined
						? {}
						: {
								browse: {
									fields: [
										{
											key: "value",
											label: "Value",
											type: "text" as const,
											kind: "value" as const,
											expression: { field, tableAlias: "subject", type: "column" as const },
											sort: {
												label: "Value",
												ascending: "Ascending",
												descending: "Descending",
												defaultDirection: "asc" as const,
											},
										},
									],
								},
							},
				),
			),
		},
	};
};
const seedEntities = Effect.fn(function* (pluginId: string, prefix = "") {
	yield* (yield* DatabaseSession).run((db) =>
		db.insert(tables.entity).values([
			{ name: "Zulu", id: `${prefix}a`, entitySchemaSlug: "item", entitySchemaPluginId: pluginId },
			{ name: "Alpha", id: `${prefix}b`, entitySchemaSlug: "item", entitySchemaPluginId: pluginId },
		]),
	);
});

layer(
	RyotQLService.layer.pipe(
		Layer.provideMerge(revisionDatabaseLayer),
		Layer.provide(makeAppConfigLayer()),
	),
)((test) => {
	test.effect(
		"fences browse expression changes without fencing unchanged definitions or the clock",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const packageId = testPluginPackageId();
				const installed = yield* installRevisionPackage(makePackage(packageId, "initial", "id"));
				yield* seedEntities(installed.pluginId);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(tables.user)
						.set({
							preferences: {
								language: null,
								ratingScale: "hundred",
								disableIntegrations: false,
								reportingTimeZone: TimeZone.make("Asia/Kolkata"),
							},
						})
						.where(eq(tables.user.id, owner)),
				);
				const request = {
					sort: "value-asc",
					source: {
						kind: "inline" as const,
						document: selection({ kind: "local", pluginId: PluginId.make(installed.pluginId) }),
					},
				};
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.savedView)
						.values({
							icon: "box",
							userId: owner,
							id: "control-view",
							sort: request.sort,
							slug: "control-view",
							name: "Control view",
							dataSources: request.source.document,
							renderer: { kind: "kernel", name: "results-table" },
							settings: {
								pageSize: 10,
								entityLink: null,
								sourceName: "items",
								rowKeyFields: ["id"],
								columns: [{ label: "ID", field: "id", displayKind: "text" }],
							},
						}),
				);
				const savedRequest = {
					source: {
						query: "items",
						kind: "savedView" as const,
						reference: { kind: "custom" as const, savedViewId: SavedViewId.make("control-view") },
					},
				};
				const savedFirst = (yield* service.executeForUser(owner, null, "plugin", savedRequest))
					.data["items"];
				assert(savedFirst?.type === "rows" && savedFirst.pageInfo.nextCursor);
				const savedContinuation = {
					...savedRequest,
					pages: { items: { after: savedFirst.pageInfo.nextCursor } },
				};
				const firstResponse = yield* service.executeForUser(owner, null, "plugin", request);
				expect(firstResponse.execution.timeZone).toBe(TimeZone.make("Asia/Kolkata"));
				const first = firstResponse.data["items"];
				assert(first?.type === "rows" && first.pageInfo.nextCursor);
				expect(first.items).toEqual([{ id: "a" }]);
				const continuation = { ...request, pages: { items: { after: first.pageInfo.nextCursor } } };
				yield* TestClock.adjust("1 day");
				yield* installRevisionPackage(makePackage(packageId, "unchanged", "id"));
				yield* installRevisionPackage(makePackage(testPluginPackageId(), "unrelated", "name"));
				const nextResponse = yield* service.executeForUser(owner, null, "plugin", continuation);
				expect(nextResponse.data["items"]?.items).toEqual([{ id: "b" }]);
				expect(
					(yield* service.executeForUser(owner, null, "plugin", savedContinuation)).data["items"]
						?.items,
				).toEqual([{ id: "b" }]);
				expect(nextResponse.execution).toEqual({
					timeZone: firstResponse.execution.timeZone,
					now: firstResponse.execution.now + 86400000,
				});
				const empty = yield* service.executeForUser(owner, null, "plugin", {
					...request,
					filter: { field: "value", operator: "is", value: "missing" },
				});
				expect(empty.data["items"]?.items).toEqual([]);
				expect(empty.execution).toEqual(nextResponse.execution);
				yield* installRevisionPackage(makePackage(packageId, "changed", "name"));
				for (const continued of [continuation, savedContinuation]) {
					assertExitFails(
						yield* Effect.exit(service.executeForUser(owner, null, "plugin", continued)),
						new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
					);
				}
				expect(
					(yield* service.executeForUser(owner, null, "plugin", request)).data["items"]?.items,
				).toEqual([{ id: "b" }]);
			}),
		testTimeout,
	);

	test.effect(
		"retained declared queries use pinned own browse and current accessible foreign controls",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const packageId = testPluginPackageId();
				const foreignPackageId = testPluginPackageId();
				const foreign = yield* installRevisionPackage(
					makePackage(foreignPackageId, "foreign-initial", "id"),
				);
				const foreignDocument = selection({
					kind: "package",
					scope: "system",
					packageId: foreignPackageId,
				});
				const ownPackage = makePackage(packageId, "own-initial", "id");
				const own = yield* installRevisionPackage({
					...ownPackage,
					manifest: {
						...ownPackage.manifest,
						dependencies: { foreign: { scope: "system", packageId: foreignPackageId } },
						queries: {
							...ownPackage.manifest.queries,
							foreign: { document: foreignDocument, description: "Foreign items" },
						},
					},
				});
				yield* seedEntities(own.pluginId, "retained-");
				const definitionContext = {
					pluginId: PluginId.make(own.pluginId),
					pluginRevisionId: PluginRevisionId.make(own.revisionId),
				};
				const run = (query: string) =>
					service.executeForUser(
						owner,
						null,
						"plugin",
						{ sort: "value-asc", source: { query, packageId, kind: "plugin", scope: "system" } },
						"standard",
						undefined,
						definitionContext,
					);
				for (const field of ["name", undefined] as const) {
					yield* installRevisionPackage(makePackage(packageId, `own-${field ?? "removed"}`, field));
					expect((yield* run("items")).data["items"]?.items).toEqual([{ id: "retained-a" }]);
				}
				yield* installRevisionPackage(makePackage(foreignPackageId, "foreign-current", "name"));
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(tables.entity)
						.set({ entitySchemaPluginId: foreign.pluginId })
						.where(eq(tables.entity.entitySchemaPluginId, own.pluginId)),
				);
				expect((yield* run("foreign")).data["items"]?.items).toEqual([{ id: "retained-b" }]);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ uninstalledAt: new Date() })
						.where(eq(tables.pluginInstallation.pluginId, foreign.pluginId)),
				);
				assertExitFails(
					yield* Effect.exit(run("foreign")),
					new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
				);
			}),
		testTimeout,
	);
});
