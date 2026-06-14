import { assert, expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { PluginConflictError, PluginRequestError } from "@ryot/contract/modules/plugins/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginDefinitionMaterializer } from "./definition-materializer";
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
	readonly removed?: Array<string>;
	readonly deactivated?: Array<string>;
	readonly hasEntityReferences?: boolean;
	readonly hasWorkflowReferences?: boolean;
	readonly removedGenerated?: Array<string>;
	readonly hasDefinitionReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly privatePlugins?: Array<StoredPlugin>;
	readonly created?: Array<Record<string, unknown>>;
	readonly updated?: Array<Record<string, unknown>>;
	readonly systemPlugins?: Array<PluginRegistryEntry>;
	readonly installations?: Array<PluginInstallationState>;
	readonly materialize?: () => Effect.Effect<void, DbError>;
	readonly persisted?: Array<{
		plugin: StoredPlugin["manifest"];
		identity: Record<string, unknown>;
	}>;
}) => {
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(DefinitionRegistry, registry);
	const loaderLayer = PluginLoader.layer.pipe(Layer.provide(registryLayer));
	const repositoryLayer = Layer.mock(PluginRepository)({
		lockIngestion: () => Effect.void,
		listPrivateForUser: () => Effect.succeed(input?.privatePlugins ?? []),
		persist: (plugin, identity) =>
			Effect.sync(() => {
				input?.persisted?.push({ plugin: plugin.manifest, identity });
				return `${identity.slug}-plugin-id`;
			}),
		findPrivateByIdForUser: (pluginId) =>
			Effect.succeed((input?.privatePlugins ?? []).find(({ id }) => id === pluginId) ?? null),
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		hasDefinitionReferences: () => Effect.succeed(input?.hasDefinitionReferences ?? false),
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
		updateState: (values) =>
			Effect.sync(() => {
				input?.updated?.push(values);
				const current = (input?.installations ?? []).find((row) => row.id === values.id);
				return current ? { ...current, ...values } : undefined;
			}),
		remove: (id) => Effect.sync(() => input?.removed?.push(id)),
	});
	const workflowReferenceLayer = Layer.mock(SandboxWorkflowReferenceRepository)({
		hasInstallationReferences: () => Effect.succeed(input?.hasWorkflowReferences ?? false),
	});
	const definitionMaterializerLayer = Layer.succeed(PluginDefinitionMaterializer, {
		materialize: () => input?.materialize?.() ?? Effect.void,
		removeGenerated: (installationId) =>
			Effect.sync(() => void input?.removedGenerated?.push(installationId)),
	});
	const serviceLayer = PluginInstallationService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				loaderLayer,
				databaseLayer,
				repositoryLayer,
				installationLayer,
				definitionMaterializerLayer,
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
		expect([...failure.reason.surfaces].sort()).toEqual(["bindings.entityAutomations"]);
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

const nestedConfiguredManifest = privateManifest({
	configSchema: {
		unknownKeys: "strict",
		fields: {
			credentials: {
				type: "object",
				label: "Credentials",
				description: "Credentials",
				defaultValue: { username: "default-user", password: "default-password" },
				properties: {
					username: { type: "string", label: "Username", description: "Username" },
					password: {
						secret: true,
						type: "string",
						label: "Password",
						description: "Password",
						defaultValue: "schema-password",
					},
				},
			},
			accounts: {
				type: "array",
				label: "Accounts",
				description: "Accounts",
				defaultValue: [{ name: "default", token: "default-token" }],
				items: {
					type: "object",
					label: "Account",
					description: "Account",
					properties: {
						name: { type: "string", label: "Name", description: "Name" },
						token: {
							secret: true,
							type: "string",
							label: "Token",
							description: "Token",
							defaultValue: "schema-token",
						},
					},
				},
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

it.effect("patches config while preserving omitted secrets and returning a safe response", () => {
	const updated: Array<Record<string, unknown>> = [];
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const result = yield* service.updateInstallation(userId, privatePlugin.slug, {
			sortOrder: 7,
			config: { region: "ca" },
		});

		expect(updated[0]).toMatchObject({
			sortOrder: 7,
			config: { region: "ca", token: "stored-secret" },
		});
		expect(result).toMatchObject({
			sortOrder: 7,
			config: { region: "ca" },
			configuredSecrets: ["token"],
		});
		expect(result.config).not.toHaveProperty("token");
	}).pipe(
		Effect.provide(
			makeLayer({
				updated,
				privatePlugins: [privatePlugin],
				installations: [
					installationRow({
						pluginId: privatePlugin.id,
						config: { region: "us", token: "stored-secret" },
					}),
				],
			}),
		),
	);
});

it.effect(
	"recursively redacts config values and secret defaults from list and patch output",
	() => {
		const privatePlugin = storedPrivatePlugin(nestedConfiguredManifest);
		const installations = [
			installationRow({
				pluginId: privatePlugin.id,
				config: {
					credentials: { username: "alice", password: "stored-password" },
					accounts: [
						{ name: "first", token: "stored-first" },
						{ name: "second", token: "stored-second" },
					],
				},
			}),
		];
		return Effect.gen(function* () {
			const service = yield* PluginInstallationService;
			const listed = (yield* service.listInstallations(userId))[0];
			const patched = yield* service.updateInstallation(userId, privatePlugin.slug, {
				config: { credentials: { username: "bob", password: "replacement" } },
			});

			for (const item of [listed, patched]) {
				expect(item?.configuredSecrets).toEqual(["accounts[].token", "credentials.password"]);
				expect(item?.config).toEqual({
					accounts: [{ name: "first" }, { name: "second" }],
					credentials: { username: item === listed ? "alice" : "bob" },
				});
				const credentials = item?.configSchema.fields["credentials"];
				const accounts = item?.configSchema.fields["accounts"];
				expect(credentials?.defaultValue).toEqual({ username: "default-user" });
				expect(
					credentials?.type === "object" && credentials.properties["password"],
				).not.toHaveProperty("defaultValue");
				expect(accounts?.defaultValue).toEqual([{ name: "default" }]);
				expect(
					accounts?.type === "array" &&
						accounts.items.type === "object" &&
						accounts.items.properties["token"],
				).not.toHaveProperty("defaultValue");
			}
		}).pipe(Effect.provide(makeLayer({ privatePlugins: [privatePlugin], installations })));
	},
);

it.effect("applies defaults after explicit unsets and rejects removing required config", () => {
	const updated: Array<Record<string, unknown>> = [];
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	const installations = [
		installationRow({
			pluginId: privatePlugin.id,
			config: { region: "us", token: "stored-secret" },
		}),
	];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const reset = yield* service.updateInstallation(userId, privatePlugin.slug, {
			unsetConfigKeys: ["region"],
		});
		expect(updated[0]).toMatchObject({ config: { region: "eu", token: "stored-secret" } });
		expect(reset.config).toEqual({ region: "eu" });

		const failure = failureOf(
			yield* Effect.exit(
				service.updateInstallation(userId, privatePlugin.slug, { unsetConfigKeys: ["token"] }),
			),
		);
		expect(failure).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
		expect(updated).toHaveLength(1);
	}).pipe(Effect.provide(makeLayer({ updated, installations, privatePlugins: [privatePlugin] })));
});

it.effect("allows system controls but rejects system config changes", () => {
	const updated: Array<Record<string, unknown>> = [];
	const systemPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "media" } }),
	);
	const installations = [
		installationRow({ pluginId: systemPlugin.id, pluginScope: "system", pluginSlug: "media" }),
	];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);

		expect(
			yield* service.updateInstallation(userId, "media", { isDisabled: true, sortOrder: 4 }),
		).toMatchObject({ scope: "system", isDisabled: true, sortOrder: 4, config: {} });
		expect(
			failureOf(yield* Effect.exit(service.updateInstallation(userId, "media", { config: {} }))),
		).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "system-plugin", pluginSlug: "media" },
		});
	}).pipe(Effect.provide(makeLayer({ updated, installations })));
});

it.effect("hides foreign installations and rejects enabling an unready installation", () => {
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		expect(
			failureOf(
				yield* Effect.exit(service.updateInstallation(userId, "foreign", { sortOrder: 1 })),
			),
		).toMatchObject({
			_tag: "PluginNotFoundError",
			reason: { code: "plugin-not-found", pluginSlug: "foreign" },
		});
		expect(
			failureOf(
				yield* Effect.exit(
					service.updateInstallation(userId, privatePlugin.slug, { isDisabled: false }),
				),
			),
		).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "installation-not-ready", health: "needs-configuration" },
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				privatePlugins: [privatePlugin],
				installations: [
					installationRow({
						isDisabled: true,
						pluginId: privatePlugin.id,
						health: "needs-configuration",
						config: { region: "eu", token: "stored-secret" },
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
	const removedIds: Array<string> = [];
	const deactivated: Array<string> = [];
	const removedGenerated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const removed = yield* service.uninstallPlugin(userId, privatePlugin.slug);
		expect(removed.slug).toBe(privatePlugin.slug);
		expect(deactivated).toEqual([privatePlugin.id]);
		expect(removedIds).toEqual([installations[0]?.id]);
		expect(removedGenerated).toEqual([installations[0]?.id]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
				removedGenerated,
				removed: removedIds,
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("keeps a private plugin referenced by persisted definitions", () => {
	const deactivated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(service.uninstallPlugin(userId, privatePlugin.slug)),
		);
		assert(failure instanceof PluginConflictError);
		expect(failure.reason.code).toBe("entity-referenced");
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
				hasDefinitionReferences: true,
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("keeps a referenced private plugin installed", () => {
	const deactivated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
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
			makeLayer({
				deactivated,
				installations,
				hasWorkflowReferences: true,
				privatePlugins: [privatePlugin],
			}),
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

it.effect("updates source while retaining plugin, installation, and omitted secret config", () => {
	const persisted: Array<{
		plugin: StoredPlugin["manifest"];
		identity: Record<string, unknown>;
	}> = [];
	const updated: Array<Record<string, unknown>> = [];
	const manifest = configuredManifest;
	const nextManifest: PluginManifest = {
		...manifest,
		scripts: [operationScript],
		metadata: { ...manifest.metadata, version: "2.0.0" },
		operations: [
			{
				auth: "user",
				slug: "run.fixture",
				description: "Run fixture",
				scriptSlug: operationScript.slug,
			},
		],
	};
	const privatePlugin = storedPrivatePlugin({ ...nextManifest, metadata: manifest.metadata });
	const installation = installationRow({
		pluginId: privatePlugin.id,
		config: { region: "us", token: "stored-secret" },
	});
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const result = yield* service.updatePrivatePlugin({
			userId,
			manifest: nextManifest,
			config: { region: "ca" },
			pluginSlug: privatePlugin.slug,
			files: { [operationScript.entry]: operationScriptSource },
		});

		expect(persisted).toHaveLength(1);
		expect(persisted[0]).toMatchObject({
			plugin: { metadata: { version: "2.0.0" } },
			identity: { slug: privatePlugin.slug, scope: "user", ownerId: userId },
		});
		expect(updated[0]).toMatchObject({
			id: installation.id,
			config: { region: "ca", token: "stored-secret" },
		});
		expect(result).toMatchObject({
			version: "2.0.0",
			config: { region: "ca" },
			configuredSecrets: ["token"],
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				updated,
				persisted,
				installations: [installation],
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("fails a package update when generated views cannot be materialized", () => {
	const persisted: Array<{
		plugin: StoredPlugin["manifest"];
		identity: Record<string, unknown>;
	}> = [];
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	const installation = installationRow({
		pluginId: privatePlugin.id,
		config: { region: "us", token: "stored-secret" },
	});
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(
				service.updatePrivatePlugin({
					userId,
					files: {},
					manifest: configuredManifest,
					pluginSlug: privatePlugin.slug,
				}),
			),
		);
		expect(failure).toMatchObject({ _tag: "DbError", message: "generated view conflict" });
		expect(persisted).toHaveLength(1);
	}).pipe(
		Effect.provide(
			makeLayer({
				persisted,
				installations: [installation],
				privatePlugins: [privatePlugin],
				materialize: () => Effect.fail(new DbError({ message: "generated view conflict" })),
			}),
		),
	);
});

it.effect("rejects package updates that change identity or invalidate merged config", () => {
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	const installations = [
		installationRow({
			pluginId: privatePlugin.id,
			config: { region: "us", token: "stored-secret" },
		}),
	];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const changedSlug = failureOf(
			yield* Effect.exit(
				service.updatePrivatePlugin({
					userId,
					files: {},
					pluginSlug: privatePlugin.slug,
					manifest: {
						...configuredManifest,
						metadata: { ...configuredManifest.metadata, slug: "renamed" },
					},
				}),
			),
		);
		expect(changedSlug).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});

		const invalidConfig = failureOf(
			yield* Effect.exit(
				service.updatePrivatePlugin({
					userId,
					files: {},
					unsetConfigKeys: ["token"],
					manifest: configuredManifest,
					pluginSlug: privatePlugin.slug,
				}),
			),
		);
		expect(invalidConfig).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
	}).pipe(Effect.provide(makeLayer({ installations, privatePlugins: [privatePlugin] })));
});

it.effect("rejects package updates for system and foreign plugins", () => {
	const systemPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "media" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);

		expect(
			failureOf(
				yield* Effect.exit(
					service.updatePrivatePlugin({
						userId,
						files: {},
						pluginSlug: systemPlugin.slug,
						manifest: systemPlugin.manifest,
					}),
				),
			),
		).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "system-plugin", pluginSlug: "media" },
		});
		expect(
			failureOf(
				yield* Effect.exit(
					service.updatePrivatePlugin({
						userId,
						files: {},
						pluginSlug: "foreign",
						manifest: configuredManifest,
					}),
				),
			),
		).toMatchObject({
			_tag: "PluginNotFoundError",
			reason: { code: "plugin-not-found", pluginSlug: "foreign" },
		});
	}).pipe(Effect.provide(makeLayer()));
});

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
