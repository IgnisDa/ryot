import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { databaseLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { fixtureManifest, fixturePluginIdentity } from "#modules/plugins/test-support";

import { DefinitionsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockRepository = Layer.mock(PluginInstallationRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ ...overrides });

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
	loader.load({ manifest, scripts: [], sourceHash: "fixture", ...fixturePluginIdentity() });
	loader.load({
		scripts: [],
		sourceHash: "other",
		...fixturePluginIdentity("other"),
		manifest: {
			...manifest,
			metadata: { ...manifest.metadata, name: "Other", slug: "other" },
		},
	});
	return loader;
};

const makeServiceLayer = (repository: ReturnType<typeof makeRepository>) =>
	DefinitionsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(databaseLayer, repository, Layer.succeed(PluginLoader, { ...makeLoader() })),
		),
	);

const makeState = (
	overrides: Partial<{
		pluginId: string;
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
	healthReason: null,
	pluginSlug: "fixture",
	health: "ready" as const,
	pluginId: "fixture-plugin-id",
	pluginScope: "system" as const,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	...overrides,
});

it.effect("lists plugins with user state overlaid", () => {
	const layer = makeServiceLayer(
		makeRepository({
			listForUser: () =>
				Effect.succeed([
					makeState({ sortOrder: 5 }),
					makeState({ pluginSlug: "other", isDisabled: true, sortOrder: 0 }),
				]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* DefinitionsService;

		const visible = yield* service.listPlugins(user, false);
		const all = yield* service.listPlugins(user, true);

		expect(visible.map(({ slug }) => slug)).toEqual(["fixture"]);
		expect(visible[0]).toMatchObject({
			sortOrder: 5,
			slug: "fixture",
			name: "Fixture",
			isDisabled: false,
		});
		expect(visible[0]).not.toHaveProperty("config");
		expect(all.map(({ slug }) => slug)).toEqual(["other", "fixture"]);
	}).pipe(Effect.provide(layer));
});
