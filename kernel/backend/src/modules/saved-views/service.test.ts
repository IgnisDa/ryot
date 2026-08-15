import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";

import { databaseLayer, type MockOverrides } from "#lib/test-utils/effect";
import { ClientPagesRepository } from "#modules/client-pages/repository";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const entity = table("entity", "entity");
const dataSources = document({
	entities: rows(entity, {
		fields: [field("entityId", column(entity, "id")), field("name", column(entity, "name"))],
	}),
});
const baseView = {
	sortOrder: 0,
	icon: "record",
	slug: "my-view",
	name: "My View",
	settings: {
		pageSize: 20,
		sourceName: "entities",
		rowKeyFields: ["entityId"],
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
		entityLink: { entityIdField: "entityId" },
	},
	isBuiltin: false,
	isDisabled: false,
	pluginSlug: null,
	dataSources,
	pluginInstallationId: null,
	renderer: { kind: "kernel", name: "results-table" },
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	id: SavedViewId.make("sv-id"),
} satisfies ListedSavedView & { readonly pluginInstallationId: string | null };

const registry = makeDefinitionRegistry({
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
	savedViews: [],
});
const repositoryMock = Layer.mock(SavedViewsRepository);
const makeRepository = (overrides: MockOverrides<typeof repositoryMock>) =>
	repositoryMock(overrides);
const makeLayer = (
	repository: Layer.Layer<SavedViewsRepository>,
	installations = Layer.mock(PluginInstallationRepository)({
		listForUser: () => Effect.succeed([]),
		clearHomeSavedViewReferences: () => Effect.void,
	}),
	availablePlugins: ReadonlyArray<
		Effect.Success<
			ReturnType<PluginRuntimeResolver["Service"]["listPluginsAvailableToUser"]>
		>[number]
	> = [],
) =>
	SavedViewsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				repository,
				installations,
				ClientPagesRepository.layer,
				PluginCatalogInvalidator.layer,
				Layer.mock(PluginRuntimeResolver)({
					listPluginsAvailableToUser: () => Effect.succeed(availablePlugins),
					getEffectiveDefinitions: () => Effect.succeed(registry.getSnapshot()),
				}),
			),
		),
	);

it.effect("clones a validated plugin-rendered builtin with its stable runtime reference", () => {
	const created: unknown[] = [];
	const renderer = {
		kind: "plugin" as const,
		pluginId: "fixture-plugin-id",
		exportName: "summary",
	};
	const pluginView = {
		...baseView,
		isBuiltin: true,
		settings: { title: "Fixture" },
		dataSources: null,
		renderer,
	};
	const manifest = {
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
								type: "string" as const,
								label: "Title",
								description: "Summary title",
								validation: { required: true as const },
							},
						},
					},
				},
			},
		},
	};
	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const cloned = yield* service.clone(user, pluginView.slug);
		expect(cloned.renderer).toEqual(renderer);
		expect(created).toMatchObject([{ renderer, settings: { title: "Fixture" } }]);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeRepository({
					findBySlug: (_userId, slug) =>
						Effect.succeed(slug === pluginView.slug ? pluginView : null),
					create: (_userId, input) =>
						Effect.sync(() => {
							created.push(input);
							return { ...pluginView, ...input, id: SavedViewId.make("plugin-copy-id") };
						}),
				}),
				undefined,
				[
					{
						manifest,
						id: "fixture-plugin-id",
						slug: "fixture",
						scope: "system",
						health: "ready",
						config: {},
						compiledHashes: {},
						isDisabled: false,
						sourceHash: "source-hash",
						installationId: "fixture-installation-id",
					},
				],
			),
		),
	);
});

it.effect("clones renderer settings and data sources without copying source code", () => {
	const created: unknown[] = [];
	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const cloned = yield* service.clone(user, baseView.slug);
		expect(cloned).toMatchObject({
			name: "My View (Copy)",
			renderer: baseView.renderer,
			settings: baseView.settings,
			dataSources: baseView.dataSources,
		});
		expect(created).toMatchObject([
			{
				renderer: baseView.renderer,
				settings: baseView.settings,
				dataSources: baseView.dataSources,
			},
		]);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeRepository({
					findBySlug: (_userId, slug) => Effect.succeed(slug === baseView.slug ? baseView : null),
					create: (_userId, input) =>
						Effect.sync(() => {
							created.push(input);
							return { ...baseView, ...input, id: SavedViewId.make("copy-id"), pluginSlug: null };
						}),
				}),
			),
		),
	);
});

it.effect("clears home references when disabling a saved view", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const updated = yield* service.update(user, baseView.slug, {
			icon: baseView.icon,
			name: baseView.name,
			isDisabled: true,
		});
		expect(updated.isDisabled).toBe(true);
		expect(events).toEqual(["update", `clear:${baseView.id}`]);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeRepository({
					lockBySlug: () => Effect.succeed(baseView),
					updateBySlug: (_userId, _slug, data) =>
						Effect.sync(() => {
							events.push("update");
							return { ...baseView, isDisabled: data.isDisabled };
						}),
				}),
				Layer.mock(PluginInstallationRepository)({
					listForUser: () => Effect.succeed([]),
					clearHomeSavedViewReferences: (_userId, id) =>
						Effect.sync(() => events.push(`clear:${id}`)),
				}),
			),
		),
	);
});

it.effect("materializes canonical builtin definitions and preserves repository-owned state", () => {
	const builtin = { ...baseView, slug: "builtin", isBuiltin: true };
	const builtinRegistry = makeDefinitionRegistry({
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		savedViews: [
			{
				pluginId: null,
				sortOrder: 3,
				pluginSlug: null,
				slug: builtin.slug,
				name: builtin.name,
				icon: builtin.icon,
				renderer: builtin.renderer,
				settings: builtin.settings,
				dataSources: builtin.dataSources,
			},
		],
	});
	let definitions: readonly unknown[] = [];
	const layer = SavedViewsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				makeRepository({
					ensureBuiltinViews: (_userId, views) =>
						Effect.sync(() => {
							definitions = views;
						}),
				}),
				ClientPagesRepository.layer,
				PluginCatalogInvalidator.layer,
				Layer.mock(PluginInstallationRepository)({ listForUser: () => Effect.succeed([]) }),
				Layer.mock(PluginRuntimeResolver)({
					getEffectiveDefinitions: () => Effect.succeed(builtinRegistry.getSnapshot()),
				}),
			),
		),
	);
	return Effect.gen(function* () {
		yield* (yield* SavedViewsService).ensureBuiltinViews(user.id);
		expect(definitions).toMatchObject([
			{
				sortOrder: 3,
				renderer: builtin.renderer,
				settings: builtin.settings,
				dataSources: builtin.dataSources,
			},
		]);
	}).pipe(Effect.provide(layer));
});
