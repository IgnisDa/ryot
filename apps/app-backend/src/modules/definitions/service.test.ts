import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { NotFound } from "@ryot/contract/errors";
import { PluginSlug, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { fixtureManifest } from "#modules/plugins/test-support";

import { DefinitionsRepository } from "./repository";
import { DefinitionsService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockRepository = Layer.mock(DefinitionsRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "DefinitionsRepository", ...overrides });

const makeLoader = () => {
	const loader = makePluginLoader(
		makeDefinitionRegistry({
			savedViews: [],
			entitySchemas: [],
			signalSchemas: [],
			relationshipSchemas: [],
		}),
	);
	const manifest = fixtureManifest();
	manifest.entitySchemas = [];
	manifest.relationshipSchemas = [];
	manifest.signalSchemas = [];
	manifest.scripts = [];
	manifest.bindings.entityAutomations = [];
	loader.load({ manifest, scripts: [], sourceHash: "fixture" });
	loader.load({
		scripts: [],
		sourceHash: "other",
		manifest: {
			...manifest,
			metadata: { ...manifest.metadata, name: "Other", slug: "other" },
		},
	});
	return loader;
};

const makeServiceLayer = (repository: ReturnType<typeof makeRepository>) =>
	DefinitionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				repository,
				Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...makeLoader() }),
			),
		),
	);

const makeState = (
	overrides: Partial<{
		sortOrder: number;
		pluginSlug: string;
		isDisabled: boolean;
		config: Record<string, unknown>;
	}> = {},
) => ({
	config: {},
	sortOrder: 0,
	id: "state-id",
	userId: user.id,
	isDisabled: false,
	pluginSlug: "fixture",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	...overrides,
});

it.effect("lists plugin workspaces with user state overlaid", () => {
	const layer = makeServiceLayer(
		makeRepository({
			listPluginStates: () =>
				Effect.succeed([
					makeState({ config: { layout: "compact" }, sortOrder: 5 }),
					makeState({ pluginSlug: "other", isDisabled: true, sortOrder: 0 }),
				]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* DefinitionsService;

		const visible = yield* service.listWorkspaces(user, false);
		const all = yield* service.listWorkspaces(user, true);

		expect(visible.map(({ slug }) => slug)).toEqual(["fixture"]);
		expect(visible[0]).toMatchObject({
			sortOrder: 5,
			slug: "fixture",
			name: "Fixture",
			isDisabled: false,
			config: { layout: "compact" },
		});
		expect(all.map(({ slug }) => slug)).toEqual(["other", "fixture"]);
	}).pipe(Effect.provide(layer));
});

it.effect("updates state while preserving omitted overlay values", () => {
	let persisted:
		| Parameters<NonNullable<MockOverrides<typeof mockRepository>["upsertPluginState"]>>[0]
		| undefined;
	const current = makeState({ config: { unit: "minutes" }, sortOrder: 4 });
	const layer = makeServiceLayer(
		makeRepository({
			getPluginState: () => Effect.succeed(current),
			upsertPluginState: (input) =>
				Effect.sync(() => {
					persisted = input;
					return makeState(input);
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* DefinitionsService;
		const workspace = yield* service.updateWorkspaceState(user, PluginSlug.make("fixture"), {
			isDisabled: true,
		});

		expect(persisted).toEqual({
			sortOrder: 4,
			userId: user.id,
			isDisabled: true,
			pluginSlug: "fixture",
			config: { unit: "minutes" },
		});
		expect(workspace).toMatchObject({
			sortOrder: 4,
			slug: "fixture",
			name: "Fixture",
			isDisabled: true,
			config: { unit: "minutes" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when updating an unknown plugin", () => {
	const layer = makeServiceLayer(makeRepository());

	return Effect.gen(function* () {
		const service = yield* DefinitionsService;
		const exit = yield* Effect.exit(
			service.updateWorkspaceState(user, PluginSlug.make("unknown"), { isDisabled: true }),
		);

		assertExitFails(exit, new NotFound({ message: "Plugin not found" }));
	}).pipe(Effect.provide(layer));
});
