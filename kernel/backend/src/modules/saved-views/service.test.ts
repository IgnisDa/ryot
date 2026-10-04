import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { MockOverrides } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const encodeSavedViewReferenceJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-id"), token: "test-account-generation" },
} satisfies CurrentUserValue;

const entity = table("entity", "entity");
const dataSources = document({
	entities: rows(entity, {
		fields: [field("entityId", column(entity, "id")), field("name", column(entity, "name"))],
	}),
});
const baseView = {
	dataSources,
	sortOrder: 0,
	icon: "record",
	pluginId: null,
	slug: "my-view",
	name: "My View",
	isHidden: false,
	isBuiltin: false,
	pluginInstallationId: null,
	id: SavedViewId.make("sv-id"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	renderer: { kind: "kernel", name: "results-table" },
	reference: { kind: "custom", savedViewId: SavedViewId.make("sv-id") },
	settings: {
		pageSize: 20,
		sourceName: "entities",
		rowKeyFields: ["entityId"],
		entityLink: { entityIdField: "entityId" },
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} satisfies ListedSavedView & {
	readonly pluginInstallationId: string | null;
	readonly pluginId: string | null;
};

const pluginRenderer = {
	exportName: "summary",
	kind: "plugin" as const,
	pluginId: "fixture-plugin-id",
};
const pluginView = {
	...baseView,
	createdAt: null,
	updatedAt: null,
	dataSources: null,
	isBuiltin: true as const,
	renderer: pluginRenderer,
	settings: { title: "Fixture" },
	reference: {
		slug: baseView.slug,
		kind: "plugin" as const,
		pluginId: PluginId.make("fixture-plugin-id"),
	},
};
const pluginManifest = {
	...fixtureManifest(),
	client: {
		homeView: null,
		apiVersion: 1 as const,
		exports: {
			summary: {
				kind: "page" as const,
				entry: "client/summary.tsx",
				automaticEntityPresentations: false,
				settingsSchema: {
					unknownKeys: "strict" as const,
					fields: {
						title: {
							label: "Title",
							type: "string" as const,
							description: "Summary title",
							validation: { required: true as const },
						},
					},
				},
			},
		},
	},
};
const hiddenView = { ...baseView, isHidden: true };

class SavedViewsCalls extends Context.Service<
	SavedViewsCalls,
	{
		readonly created: Effect.Effect<ReadonlyArray<unknown>>;
		readonly events: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/SavedViewsCalls") {}

const repositoryMock = Layer.mock(SavedViewsRepository);
const makeLayer = (options: {
	readonly repository: MockOverrides<typeof repositoryMock>;
	readonly availablePlugins?: ReadonlyArray<
		Effect.Success<
			ReturnType<PluginRuntimeResolver["Service"]["listPluginsAvailableToUser"]>
		>[number]
	>;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const created = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (event: string) => Ref.update(events, (all) => [...all, event]);
			const { create, updateCustom } = options.repository;
			return SavedViewsService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						isolatedDatabaseLayer("saved_views_test"),
						repositoryMock({
							customSlugExists: () => Effect.succeed(false),
							...options.repository,
							...(create && {
								create: (userId, input) =>
									record("create").pipe(
										Effect.andThen(Ref.update(created, (all) => [...all, input])),
										Effect.andThen(create(userId, input)),
									),
							}),
							...(updateCustom && {
								updateCustom: (...args) =>
									record("update").pipe(Effect.andThen(updateCustom(...args))),
							}),
						}),
						Layer.mock(PluginInstallationRepository)({
							listForUser: () => Effect.succeed([]),
							clearHomeSavedViewReferences: (_userId, reference) =>
								record(`clear:${encodeSavedViewReferenceJson(reference)}`),
						}),
						Layer.succeed(PluginCatalogInvalidator, {
							all: Effect.void,
							recordAll: Effect.void,
							recordUser: () => Effect.void,
							user: () => record("invalidate"),
							deliverPending: () => Effect.void,
						}),
						Layer.mock(DefinitionRepository)({ listUserSavedViews: () => Effect.succeed([]) }),
						Layer.mock(PluginRepository)({ lockIngestionShared: () => Effect.void }),
						Layer.mock(PluginRuntimeResolver)({
							listPluginsAvailableToUser: () =>
								Effect.succeed([...(options.availablePlugins ?? [])]),
						}),
						Layer.succeed(SavedViewsCalls, { events: Ref.get(events), created: Ref.get(created) }),
					),
				),
			);
		}),
	);

layer(
	makeLayer({
		repository: {
			create: () => Effect.succeed({ id: SavedViewId.make("plugin-copy-id") }),
			findByReference: (_userId, reference) =>
				Effect.succeed(Bun.deepEquals(reference, pluginView.reference) ? pluginView : null),
		},
		availablePlugins: [
			{
				scope: "system",
				health: "ready",
				isHidden: false,
				clientImports: [],
				ownerUserId: null,
				compiledHashes: {},
				id: "fixture-plugin-id",
				manifest: pluginManifest,
				contentHash: "source-hash",
				pluginRevisionId: "fixture-revision",
				pluginConfigRevisionId: "fixture-config",
				installationId: "fixture-installation-id",
				packageId: pluginManifest.metadata.packageId,
			},
		],
	}),
)((test) => {
	test.effect("clones a validated plugin-rendered builtin with its stable runtime reference", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const calls = yield* SavedViewsCalls;
			const cloned = yield* service.clone(user, pluginView.reference);
			expect(cloned).toEqual({ id: SavedViewId.make("plugin-copy-id") });
			expect(yield* calls.created).toMatchObject([
				{ renderer: pluginRenderer, settings: { title: "Fixture" } },
			]);
			expect(yield* calls.events).toEqual(["create", "invalidate"]);
		}),
	);
});

layer(
	makeLayer({
		repository: {
			create: () => Effect.succeed({ id: SavedViewId.make("copy-id") }),
			findByReference: (_userId, reference) =>
				Effect.succeed(Bun.deepEquals(reference, baseView.reference) ? baseView : null),
		},
	}),
)((test) => {
	test.effect("clones renderer settings and data sources without copying source code", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const cloned = yield* service.clone(user, baseView.reference);
			expect(cloned).toEqual({ id: SavedViewId.make("copy-id") });
			expect(yield* (yield* SavedViewsCalls).created).toMatchObject([
				{
					name: "My View (Copy)",
					renderer: baseView.renderer,
					settings: baseView.settings,
					dataSources: baseView.dataSources,
				},
			]);
		}),
	);
});

layer(
	makeLayer({
		repository: {
			lockCustom: () => Effect.succeed(baseView),
			findByReference: () => Effect.succeed(baseView),
			updateCustom: () => Effect.succeed({ id: baseView.id }),
		},
	}),
)((test) => {
	test.effect("clears home references when disabling a saved view", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const updated = yield* service.update(user, baseView.reference, {
				isHidden: true,
				icon: baseView.icon,
				name: baseView.name,
			});
			expect(updated).toEqual({ id: baseView.id });
			expect(yield* (yield* SavedViewsCalls).events).toEqual([
				"update",
				`clear:${encodeSavedViewReferenceJson(baseView.reference)}`,
				"invalidate",
			]);
		}),
	);
});

const hiddenViewRepository = {
	lockCustom: () => Effect.succeed(hiddenView),
	findByReference: () => Effect.succeed(hiddenView),
	updateCustom: () => Effect.succeed({ id: baseView.id }),
};

layer(makeLayer({ repository: hiddenViewRepository }))((test) => {
	test.effect("reveals a hidden view without building its composition", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const updated = yield* service.update(user, baseView.reference, {
				isHidden: false,
				icon: baseView.icon,
				name: baseView.name,
			});
			expect(updated).toEqual({ id: baseView.id });
			expect(yield* (yield* SavedViewsCalls).events).toEqual(["update", "invalidate"]);
		}),
	);
});

layer(makeLayer({ repository: hiddenViewRepository }))((test) => {
	test.effect("updates a hidden view without preparing its renderer", () =>
		Effect.gen(function* () {
			const updated = yield* (yield* SavedViewsService).update(user, baseView.reference, {
				isHidden: true,
				icon: baseView.icon,
				name: "Renamed View",
			});
			expect(updated).toEqual({ id: baseView.id });
			expect(yield* (yield* SavedViewsCalls).events).toEqual([
				"update",
				`clear:${encodeSavedViewReferenceJson(baseView.reference)}`,
				"invalidate",
			]);
		}),
	);
});
