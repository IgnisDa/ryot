import { expect } from "bun:test";

import { PluginId, PluginPackageId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { type CatalogSavedView, DefinitionCatalog } from "#modules/definitions/catalog";
import { savedView } from "#schema/tables/views";
import { fakeDatabaseSession } from "#testing/effect";

import { SavedViewsRepository } from "./repository";

type Condition = Parameters<PgDialect["sqlToQuery"]>[0];

const customRow = (id: string, settings: Record<string, unknown>) => ({
	id,
	settings,
	name: id,
	slug: id,
	icon: "box",
	revision: 1,
	sortOrder: 0,
	packageId: null,
	isHidden: false,
	userId: "user-1",
	dataSources: null,
	pluginInstallationId: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	renderer: { kind: "kernel", name: "entity-browser" },
});

const builtinView = (pluginId: null | string): CatalogSavedView => ({
	pluginId,
	position: 0,
	icon: "box",
	slug: "same",
	sortOrder: 0,
	settings: {},
	dataSources: null,
	isEffective: true,
	name: pluginId ?? "Kernel",
	id: `definition-${pluginId ?? "kernel"}`,
	pluginRevisionId: pluginId && "revision-1",
	pluginScope: pluginId === null ? null : "system",
	renderer: { kind: "kernel", name: "entity-browser" },
	packageId: pluginId === null ? null : PluginPackageId.make("test/owner"),
});

const catalogLayer = (savedViews: ReadonlyArray<CatalogSavedView>) =>
	Layer.mock(DefinitionCatalog)({
		forUser: (userId) =>
			Effect.succeed({
				userId,
				savedViews,
				plugins: [],
				eventSchemas: [],
				entitySchemas: [],
				signalSchemas: [],
				importSources: [],
				calendarSources: [],
				revisions: new Map(),
				relationshipSchemas: [],
				integrationProviders: [],
			}),
	});

const fakeDatabase = (customRows: ReadonlyArray<object>, conditions: Array<Condition> = []) => {
	const query = (rows: ReadonlyArray<object>) => {
		const statement: object = Object.assign(Effect.succeed(rows), {
			limit: () => statement,
			orderBy: () => statement,
			leftJoin: () => statement,
			where: (condition: Condition) => {
				conditions.push(condition);
				return statement;
			},
		});
		return statement;
	};
	return {
		select: () => ({ from: (table: unknown) => query(table === savedView ? customRows : []) }),
	};
};

const repositoryLayer = (
	customRows: ReadonlyArray<object>,
	savedViews: ReadonlyArray<CatalogSavedView>,
	conditions?: Array<Condition>,
) =>
	Layer.effect(SavedViewsRepository, SavedViewsRepository.make).pipe(
		Layer.provide(catalogLayer(savedViews)),
		Layer.provide(fakeDatabaseSession(fakeDatabase(customRows, conditions))),
	);

layer(repositoryLayer([customRow("same", {})], [builtinView(null), builtinView("owner-1")]))(
	(test) => {
		test.effect(
			"finds custom IDs separately from exact kernel and plugin definition owners",
			() =>
				Effect.gen(function* () {
					const repository = yield* SavedViewsRepository;
					const userId = UserId.make("user-1");
					const custom = yield* repository.findByReference(userId, {
						kind: "custom",
						savedViewId: SavedViewId.make("same"),
					});
					const kernel = yield* repository.findByReference(userId, {
						slug: "same",
						kind: "kernel",
					});
					const plugin = yield* repository.findByReference(userId, {
						slug: "same",
						kind: "plugin",
						pluginId: PluginId.make("owner-1"),
					});
					expect([custom?.isBuiltin, custom?.id]).toEqual([false, SavedViewId.make("same")]);
					expect([kernel?.isBuiltin, kernel?.pluginId, kernel?.name]).toEqual([
						true,
						null,
						"Kernel",
					]);
					expect([plugin?.isBuiltin, plugin?.pluginId]).toEqual([true, "owner-1"]);
				}),
			testTimeout,
		);
	},
);

const conditions: Array<Condition> = [];

layer(repositoryLayer([customRow("custom-view", {})], [], conditions))((test) => {
	test.effect(
		"checks custom view references for the exact installation and user",
		() => {
			const userId = UserId.make("user-1");
			return Effect.gen(function* () {
				const repository = yield* SavedViewsRepository;
				expect(yield* repository.hasCustomInstallationReferences(userId, "installation-id")).toBe(
					true,
				);
				const condition = conditions.at(-1);
				assert(condition);
				const rendered = new PgDialect().sqlToQuery(condition);
				expect(rendered.sql).toContain('"saved_view"."user_id" = $1');
				expect(rendered.sql).toContain('"saved_view"."plugin_installation_id" = $2');
				expect(rendered.params).toEqual([userId, "installation-id"]);
			});
		},
		testTimeout,
	);
});

layer(repositoryLayer([customRow("valid", { pageSize: 20 }), customRow("legacy", {})], []))(
	(test) => {
		test.effect(
			"lists views whose settings the renderer schema rejects without decoding them",
			() =>
				Effect.gen(function* () {
					const repository = yield* SavedViewsRepository;
					const views = yield* repository.listByUser(UserId.make("user-1"), {
						includeHidden: true,
					});
					expect(views.map(({ slug, settings }) => [slug, settings])).toEqual([
						["legacy", {}],
						["valid", { pageSize: 20 }],
					]);
				}),
			testTimeout,
		);
	},
);
