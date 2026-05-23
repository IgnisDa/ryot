import { assert, expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { PluginConflictError, PluginRequestError } from "@ryot/contract/modules/plugins/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import {
	PluginInstallationRepository,
	type PluginInstallationState,
} from "./installation-repository";
import { PluginInstallationService } from "./installation-service";
import { PluginLoader, type PluginRegistryEntry } from "./loader";
import { PluginRepository } from "./repository";
import { fixtureManifest } from "./test-support";
import type { StoredPlugin } from "./types";
import { PLUGIN_PACKAGE_LIMITS } from "./validation";

const userId = UserId.make("user-1");

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
	assert(Exit.isFailure(exit));
	return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

const privateManifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
	...fixtureManifest(),
	scripts: [],
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
	metadata: { ...fixtureManifest().metadata, name: "Private", slug: "private-fixture" },
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
	...overrides,
});

const storedPrivatePlugin = (manifest: PluginManifest): StoredPlugin => ({
	manifest,
	scripts: [],
	scope: "user",
	ownerId: userId,
	sourceFiles: {},
	status: "active",
	slug: manifest.metadata.slug,
	id: `${manifest.metadata.slug}-plugin-id`,
	sourceHash: `hash-${manifest.metadata.slug}`,
});

const installationRow = (
	overrides: Partial<PluginInstallationState> & { pluginId: string },
): PluginInstallationState => ({
	userId,
	config: {},
	sortOrder: 0,
	health: "ready",
	isDisabled: false,
	healthReason: null,
	pluginScope: "user",
	createdAt: new Date(),
	updatedAt: new Date(),
	pluginSlug: "private-fixture",
	id: `${overrides.pluginId}-installation`,
	...overrides,
});

const makeLayer = (input?: {
	readonly deactivated?: Array<string>;
	readonly hasEntityReferences?: boolean;
	readonly hasWorkflowReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly privatePlugins?: Array<StoredPlugin>;
	readonly created?: Array<Record<string, unknown>>;
	readonly systemPlugins?: Array<PluginRegistryEntry>;
	readonly installations?: Array<PluginInstallationState>;
}) => {
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(DefinitionRegistry, registry);
	const loaderLayer = PluginLoader.layer.pipe(Layer.provide(registryLayer));
	const repositoryLayer = Layer.mock(PluginRepository)({
		lockIngestion: () => Effect.void,
		listPrivateForUser: () => Effect.succeed(input?.privatePlugins ?? []),
		persist: (_plugin, identity) => Effect.succeed(`${identity.slug}-plugin-id`),
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		hasIntegrationReferences: () => Effect.succeed(input?.hasIntegrationReferences ?? false),
		deactivate: (pluginId) => Effect.sync(() => void input?.deactivated?.push(pluginId)),
		listActiveManifests: () =>
			Effect.succeed((input?.systemPlugins ?? []).map(({ manifest }) => manifest)),
	});
	const installationLayer = Layer.mock(PluginInstallationRepository)({
		listForUser: () => Effect.succeed(input?.installations ?? []),
		findByUserAndPlugin: (_user, pluginId) =>
			Effect.succeed((input?.installations ?? []).find((row) => row.pluginId === pluginId) ?? null),
		create: (values) =>
			Effect.sync(() => {
				input?.created?.push(values);
				return installationRow({ ...values, pluginId: values.pluginId });
			}),
	});
	const workflowReferenceLayer = Layer.mock(SandboxWorkflowReferenceRepository)({
		hasReferences: () => Effect.succeed(input?.hasWorkflowReferences ?? false),
	});
	const serviceLayer = PluginInstallationService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				loaderLayer,
				databaseLayer,
				repositoryLayer,
				installationLayer,
				workflowReferenceLayer,
			),
		),
	);
	return Layer.mergeAll(loaderLayer, serviceLayer, databaseLayer);
};

const systemEntry = (manifest: PluginManifest): PluginRegistryEntry => ({
	manifest,
	scripts: [],
	ownerId: null,
	sourceFiles: {},
	scope: "system",
	slug: manifest.metadata.slug,
	id: `${manifest.metadata.slug}-plugin-id`,
	sourceHash: `hash-${manifest.metadata.slug}`,
});

it.effect("rejects an oversized package before compiling it", () => {
	const files = Object.fromEntries(
		Array.from({ length: PLUGIN_PACKAGE_LIMITS.fileCount + 1 }, (_unused, index) => [
			`scripts/file-${index}.ts`,
			"this is not valid typescript {{{",
		]),
	);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ files, userId, config: {}, manifest: privateManifest() }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "package-limit-exceeded", limit: "file-count" });
	}).pipe(Effect.provide(makeLayer()));
});

it.effect("rejects every unsupported private manifest surface at once", () =>
	Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const fixture = fixtureManifest();
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				files: {},
				config: {},
				manifest: privateManifest({
					crons: fixture.crons,
					scripts: fixture.scripts,
					bindings: fixture.bindings,
					entitySchemas: fixture.entitySchemas,
					signalSchemas: fixture.signalSchemas,
					relationshipSchemas: fixture.relationshipSchemas,
				}),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		assert(failure.reason.code === "unsupported-manifest-surface");
		expect([...failure.reason.surfaces].sort()).toEqual([
			"bindings.entityAutomations",
			"entitySchemas",
			"relationshipSchemas",
			"scripts",
			"signalSchemas",
		]);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("reserves slugs owned by active system plugins", () =>
	Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				files: {},
				config: {},
				manifest: privateManifest({
					metadata: { ...privateManifest().metadata, slug: "media" },
				}),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "slug-reserved", pluginSlug: "media" });
	}).pipe(
		Effect.provide(
			makeLayer({
				systemPlugins: [
					systemEntry(
						privateManifest({ metadata: { ...privateManifest().metadata, slug: "media" } }),
					),
				],
			}),
		),
	),
);

const configuredManifest = privateManifest({
	configSchema: {
		unknownKeys: "strict",
		fields: {
			region: { type: "string", label: "Region", defaultValue: "eu", description: "Region" },
			token: {
				secret: true,
				type: "string",
				label: "Token",
				description: "Token",
				validation: { required: true },
			},
		},
	},
});

it.effect("applies config defaults and persists validated config", () => {
	const created: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			files: {},
			manifest: configuredManifest,
			config: { token: "secret-value" },
		});
		expect(created[0]).toMatchObject({
			health: "ready",
			isDisabled: false,
			config: { region: "eu", token: "secret-value" },
		});
		expect(installed.config).toEqual({ region: "eu" });
		expect(installed.configuredSecrets).toEqual(["token"]);
		expect(installed.scope).toBe("user");
	}).pipe(Effect.provide(makeLayer({ created })));
});

it.effect("rejects config missing a required value before persisting", () => {
	const created: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ userId, files: {}, config: {}, manifest: configuredManifest }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason.code).toBe("validation-failed");
		expect(created).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ created })));
});

it.effect("refuses a second private plugin with the same slug", () => {
	const privatePlugin = storedPrivatePlugin(privateManifest());
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ userId, files: {}, config: {}, manifest: privateManifest() }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginConflictError);
		expect(failure.reason).toEqual({ code: "already-installed", pluginSlug: privatePlugin.slug });
	}).pipe(Effect.provide(makeLayer({ privatePlugins: [privatePlugin] })));
});

it.effect("lists system and private installations without secret values", () => {
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	const systemPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "media" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);
		const listed = yield* service.listInstallations(userId);
		expect(listed.map(({ slug }) => slug)).toEqual(["media", "private-fixture"]);
		expect(listed[0]).toMatchObject({ config: {}, scope: "system", configuredSecrets: [] });
		expect(listed[1]).toMatchObject({
			sortOrder: 3,
			scope: "user",
			isDisabled: true,
			config: { region: "us" },
			configuredSecrets: ["token"],
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				privatePlugins: [privatePlugin],
				installations: [
					installationRow({
						sortOrder: 3,
						isDisabled: true,
						pluginId: privatePlugin.id,
						config: { region: "us", token: "stored-secret" },
					}),
				],
			}),
		),
	);
});

it.effect("refuses to uninstall a system plugin through the private path", () => {
	const systemPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "media" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);
		const failure = failureOf(yield* Effect.exit(service.uninstallPlugin(userId, "media")));
		assert(failure instanceof PluginConflictError);
		expect(failure.reason).toEqual({ code: "system-plugin", pluginSlug: "media" });
	}).pipe(Effect.provide(makeLayer()));
});

it.effect("hides private plugins owned by another user", () =>
	Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(service.uninstallPlugin(userId, "someone-elses-plugin")),
		);
		expect(failure).toMatchObject({
			_tag: "PluginNotFoundError",
			reason: { code: "plugin-not-found", pluginSlug: "someone-elses-plugin" },
		});
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("uninstalls a private plugin the caller owns", () => {
	const deactivated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const removed = yield* service.uninstallPlugin(userId, privatePlugin.slug);
		expect(removed.slug).toBe(privatePlugin.slug);
		expect(deactivated).toEqual([privatePlugin.id]);
	}).pipe(Effect.provide(makeLayer({ deactivated, privatePlugins: [privatePlugin] })));
});

it.effect("keeps a referenced private plugin installed", () => {
	const deactivated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(service.uninstallPlugin(userId, privatePlugin.slug)),
		);
		assert(failure instanceof PluginConflictError);
		expect(failure.reason.code).toBe("workflow-referenced");
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({ deactivated, hasWorkflowReferences: true, privatePlugins: [privatePlugin] }),
		),
	);
});

const operationScript = {
	capabilities: [],
	name: "Fixture Operation",
	slug: "operation.fixture",
	kind: "operation" as const,
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	entry: "scripts/operation.sandbox.ts",
};

const operationScriptSource = `import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

export const manifest = defineManifest({
	capabilities: [],
	kind: "operation",
	name: "Fixture Operation",
	slug: "operation.fixture",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineOperation({
	manifest,
	output: Schema.Null,
	input: Schema.Unknown,
	run: () => Effect.succeed(null),
});
`;

it.effect("rejects an operation referencing an undeclared script slug", () => {
	const created: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				config: {},
				files: { [operationScript.entry]: operationScriptSource },
				manifest: privateManifest({
					scripts: [operationScript],
					operations: [
						{
							auth: "user",
							slug: "run.fixture",
							description: "Run fixture",
							scriptSlug: "does-not-exist",
						},
					],
				}),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		assert(failure.reason.code === "validation-failed");
		expect(created).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ created })));
});

it.effect("rejects duplicate operation slugs before compiling the package", () => {
	const created: Array<Record<string, unknown>> = [];
	const operation = {
		auth: "user" as const,
		slug: "run.fixture",
		description: "Run fixture",
		scriptSlug: operationScript.slug,
	};
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				config: {},
				files: { [operationScript.entry]: operationScriptSource },
				manifest: privateManifest({
					operations: [operation, operation],
					scripts: [operationScript],
				}),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		assert(failure.reason.code === "validation-failed");
		expect(failure.reason.diagnostics.map(({ message }) => message).join("; ")).toContain(
			"Duplicate operation slug: run.fixture",
		);
		expect(created).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ created })));
});

it.effect("installs a private package whose operation references a compiled script", () => {
	const created: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			config: {},
			files: { [operationScript.entry]: operationScriptSource },
			manifest: privateManifest({
				scripts: [operationScript],
				operations: [
					{
						auth: "user",
						slug: "run.fixture",
						description: "Run fixture",
						scriptSlug: operationScript.slug,
					},
				],
			}),
		});
		expect(installed.scope).toBe("user");
		expect(installed.slug).toBe("private-fixture");
		expect(created).toHaveLength(1);
	}).pipe(Effect.provide(makeLayer({ created })));
});

it.effect("orders provisioned system installations by slug when their sort order ties", () => {
	const media = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "media" } }),
	);
	const fitness = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "fitness" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(media);
		loader.load(fitness);
		const listed = yield* service.listInstallations(userId);
		expect(listed.map(({ slug, sortOrder }) => [slug, sortOrder])).toEqual([
			["fitness", 0],
			["media", 0],
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				installations: [
					installationRow({ pluginId: media.id, pluginScope: "system", pluginSlug: "media" }),
					installationRow({ pluginId: fitness.id, pluginScope: "system", pluginSlug: "fitness" }),
				],
			}),
		),
	);
});
