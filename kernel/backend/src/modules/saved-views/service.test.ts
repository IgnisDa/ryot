import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { Context, Effect, Layer, Ref } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, disableIntegrations: false },
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
	pluginSlug: null,
	pluginInstallationId: null,
	id: SavedViewId.make("sv-id"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	renderer: { kind: "kernel", name: "results-table" },
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
			const { create, updateBySlug } = options.repository;
			return SavedViewsService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						isolatedDatabaseLayer("saved_views_test"),
						repositoryMock({
							...options.repository,
							...(create && {
								create: (userId, input) =>
									record("create").pipe(
										Effect.andThen(Ref.update(created, (all) => [...all, input])),
										Effect.andThen(create(userId, input)),
									),
							}),
							...(updateBySlug && {
								updateBySlug: (...args) =>
									record("update").pipe(Effect.andThen(updateBySlug(...args))),
							}),
						}),
						Layer.mock(PluginInstallationRepository)({
							listForUser: () => Effect.succeed([]),
							clearHomeSavedViewReferences: (_userId, id) => record(`clear:${id}`),
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
			findBySlug: (_userId, slug) => Effect.succeed(slug === pluginView.slug ? pluginView : null),
		},
		availablePlugins: [
			{
				slug: "fixture",
				scope: "system",
				health: "ready",
				isHidden: false,
				ownerUserId: null,
				compiledHashes: {},
				id: "fixture-plugin-id",
				manifest: pluginManifest,
				sourceHash: "source-hash",
				pluginRevisionId: "fixture-revision",
				pluginConfigRevisionId: "fixture-config",
				installationId: "fixture-installation-id",
			},
		],
	}),
)((test) => {
	test.effect("clones a validated plugin-rendered builtin with its stable runtime reference", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const calls = yield* SavedViewsCalls;
			const cloned = yield* service.clone(user, pluginView.slug);
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
			findBySlug: (_userId, slug) => Effect.succeed(slug === baseView.slug ? baseView : null),
		},
	}),
)((test) => {
	test.effect("clones renderer settings and data sources without copying source code", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const cloned = yield* service.clone(user, baseView.slug);
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
			findBySlug: () => Effect.succeed(baseView),
			lockBySlug: () => Effect.succeed(baseView),
			updateBySlug: () => Effect.succeed({ id: baseView.id }),
		},
	}),
)((test) => {
	test.effect("clears home references when disabling a saved view", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const updated = yield* service.update(user, baseView.slug, {
				isHidden: true,
				icon: baseView.icon,
				name: baseView.name,
			});
			expect(updated).toEqual({ id: baseView.id });
			expect(yield* (yield* SavedViewsCalls).events).toEqual([
				"update",
				`clear:${baseView.slug}`,
				"invalidate",
			]);
		}),
	);
});

const hiddenViewRepository = {
	findBySlug: () => Effect.succeed(hiddenView),
	lockBySlug: () => Effect.succeed(hiddenView),
	updateBySlug: () => Effect.succeed({ id: baseView.id }),
};

layer(makeLayer({ repository: hiddenViewRepository }))((test) => {
	test.effect("reveals a hidden view without building its composition", () =>
		Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const updated = yield* service.update(user, baseView.slug, {
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
			const updated = yield* (yield* SavedViewsService).update(user, baseView.slug, {
				isHidden: true,
				icon: baseView.icon,
				name: "Renamed View",
			});
			expect(updated).toEqual({ id: baseView.id });
			expect(yield* (yield* SavedViewsCalls).events).toEqual(["update", `clear:${baseView.slug}`]);
		}),
	);
});
