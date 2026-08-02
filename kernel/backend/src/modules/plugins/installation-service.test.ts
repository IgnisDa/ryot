import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import {
	compileClientPlugin,
	STYLEX_TRACER_BUILD_FINGERPRINT,
} from "@ryot-app/client-plugin-compiler";
import { badRequest, DbError, type InternalError, internalError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { ClientRendererId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { writePluginArchive } from "@ryot-app/plugin-archive";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { databaseLayer } from "#lib/test-utils/effect";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginDefinitionMaterializer } from "./definition-materializer";
import { PluginIngestionLock } from "./ingestion-lock";
import {
	PluginInstallationRepository,
	type PluginInstallationState,
	type PluginPrivateInstallationRow,
} from "./installation-repository";
import { PluginInstallationService } from "./installation-service";
import { PluginInstallationLifecycleDispatcher } from "./installation-workflow";
import { PluginLoader, type PluginRegistryEntry } from "./loader";
import { PluginRepository } from "./repository";
import { styleXTracerActivationLayer } from "./stylex-tracer-activation";
import { fixtureManifest } from "./test-support";
import type { StoredPlugin } from "./types";
import { PLUGIN_PACKAGE_LIMITS } from "./validation";

const userId = UserId.make("user-1");
const bytes = (value: string) => new TextEncoder().encode(value);
type HomeSavedView = Effect.Success<
	ReturnType<PluginInstallationRepository["Service"]["findHomeSavedView"]>
>;
type DefaultHomeSavedView = Effect.Success<
	ReturnType<PluginInstallationRepository["Service"]["findHomeSavedViewBySlug"]>
>;

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
	homeSavedViewId: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	pluginSlug: "private-fixture",
	id: `${overrides.pluginId}-installation`,
	...overrides,
});

const makeLayer = (input?: {
	readonly removed?: Array<string>;
	readonly dispatchFails?: boolean;
	readonly archiveBytes?: Uint8Array;
	readonly openUploadFails?: boolean;
	readonly claimUploadFails?: boolean;
	readonly dispatched?: Array<string>;
	readonly deleteUploadFails?: boolean;
	readonly deactivated?: Array<string>;
	readonly invalidatedAll?: Array<void>;
	readonly hasEntityReferences?: boolean;
	readonly deletedUploads?: Array<string>;
	readonly homeViewEvents?: Array<string>;
	readonly hasWorkflowReferences?: boolean;
	readonly pendingLifecycle?: Array<string>;
	readonly dispatchFailsFor?: Array<string>;
	readonly removedGenerated?: Array<string>;
	readonly savedViewFences?: Array<unknown>;
	readonly invalidatedUsers?: Array<UserId>;
	readonly hasSavedViewReferences?: boolean;
	readonly hasDefinitionReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly integrationFences?: Array<unknown>;
	readonly privatePlugins?: Array<StoredPlugin>;
	readonly created?: Array<Record<string, unknown>>;
	readonly updated?: Array<Record<string, unknown>>;
	readonly lockIngestion?: () => Effect.Effect<void>;
	readonly systemPlugins?: Array<PluginRegistryEntry>;
	readonly installations?: Array<PluginInstallationState>;
	readonly healthUpdates?: Array<Record<string, unknown>>;
	readonly homeViewUpdates?: Array<Record<string, unknown>>;
	readonly homeViewTransactionScopes?: Array<"root" | "transaction">;
	readonly homeTargets?: ReadonlyMap<string, NonNullable<HomeSavedView>>;
	readonly defaultHomeTargets?: ReadonlyMap<string, NonNullable<DefaultHomeSavedView>>;
	readonly claimedUploads?: Array<Record<string, unknown>>;
	readonly privateInstallations?: Array<PluginPrivateInstallationRow>;
	readonly materialize?: (userId: UserId) => Effect.Effect<void, DbError>;
	readonly listActiveManifests?: () => Effect.Effect<Array<PluginManifest>>;
	readonly persisted?: Array<{
		plugin: StoredPlugin["manifest"];
		identity: Record<string, unknown>;
	}>;
	readonly stylexTracerEnabled?: boolean;
	readonly clientCompile?: ClientPluginCompiler["Service"]["compile"];
}) => {
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(DefinitionRegistry, registry);
	const invalidatorLayer = Layer.succeed(PluginCatalogInvalidator, {
		all: Effect.sync(() => void input?.invalidatedAll?.push(undefined)),
		user: (ownerId) => Effect.sync(() => void input?.invalidatedUsers?.push(ownerId)),
	});
	const loaderLayer = PluginLoader.layer.pipe(Layer.provide(registryLayer));
	const repositoryLayer = Layer.mock(PluginRepository)({
		lockIngestion: () => input?.lockIngestion?.() ?? Effect.void,
		listPrivateForUser: () => Effect.succeed(input?.privatePlugins ?? []),
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		deactivate: (pluginId) => Effect.sync(() => void input?.deactivated?.push(pluginId)),
		hasDefinitionReferences: () => Effect.succeed(input?.hasDefinitionReferences ?? false),
		findPrivateByIdForUser: (pluginId) =>
			Effect.succeed((input?.privatePlugins ?? []).find(({ id }) => id === pluginId) ?? null),
		listActiveManifests: () =>
			input?.listActiveManifests?.() ??
			Effect.succeed((input?.systemPlugins ?? []).map(({ manifest }) => manifest)),
		hasIntegrationReferences: (fence) =>
			Effect.sync(() => {
				input?.integrationFences?.push(fence);
				return input?.hasIntegrationReferences ?? false;
			}),
		persist: (plugin, identity) =>
			Effect.sync(() => {
				input?.persisted?.push({ identity, plugin: plugin.manifest });
				return `${identity.slug}-plugin-id`;
			}),
	});
	const ingestionLockLayer = PluginIngestionLock.layer.pipe(Layer.provide(repositoryLayer));
	const installationLayer = Layer.mock(PluginInstallationRepository)({
		provisionSystemInstallationsForAllUsers: () => Effect.void,
		remove: (id) => Effect.sync(() => input?.removed?.push(id)),
		listForUser: () => Effect.succeed(input?.installations ?? []),
		listPendingLifecycle: () => Effect.succeed(input?.pendingLifecycle ?? []),
		listPrivateInstallations: () => Effect.succeed(input?.privateInstallations ?? []),
		updateHealth: (values) => Effect.sync(() => void input?.healthUpdates?.push(values)),
		findHomeSavedView: (_ownerId, savedViewId) =>
			Effect.succeed(input?.homeTargets?.get(savedViewId) ?? null),
		findByUserAndPlugin: (_user, pluginId) =>
			Effect.succeed((input?.installations ?? []).find((row) => row.pluginId === pluginId) ?? null),
		findHomeSavedViewBySlug: (_ownerId, installationId, slug) =>
			Effect.succeed(input?.defaultHomeTargets?.get(`${installationId}:${slug}`) ?? null),
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
		lockHomeSavedView: (_ownerId, savedViewId) =>
			Effect.gen(function* () {
				const database = yield* Database;
				input?.homeViewTransactionScopes?.push("transaction" in database ? "root" : "transaction");
				input?.homeViewEvents?.push("lock-saved-view");
				return input?.homeTargets?.get(savedViewId) ?? null;
			}),
		setHomeSavedView: (ownerId, id, homeSavedViewId) =>
			Effect.gen(function* () {
				const database = yield* Database;
				input?.homeViewTransactionScopes?.push("transaction" in database ? "root" : "transaction");
				input?.homeViewEvents?.push("set-installation");
				input?.homeViewUpdates?.push({ id, homeSavedViewId, userId: ownerId });
				return (input?.installations ?? []).some((row) => row.id === id && row.userId === ownerId);
			}),
	});
	const lifecycleDispatcherLayer = Layer.succeed(PluginInstallationLifecycleDispatcher, {
		dispatch: (installationId) =>
			Effect.sync(() => void input?.dispatched?.push(installationId)).pipe(
				Effect.andThen(
					input?.dispatchFails || input?.dispatchFailsFor?.includes(installationId)
						? internalError("queue unavailable")
						: (Effect.void as Effect.Effect<void, InternalError>),
				),
			),
	});
	const workflowReferenceLayer = Layer.mock(SandboxWorkflowReferenceRepository)({
		hasInstallationReferences: () => Effect.succeed(input?.hasWorkflowReferences ?? false),
	});
	const definitionMaterializerLayer = Layer.succeed(PluginDefinitionMaterializer, {
		materialize: (owner) => input?.materialize?.(owner) ?? Effect.void,
		removeGenerated: (installationId) =>
			Effect.sync(() => void input?.removedGenerated?.push(installationId)),
		hasCustomSavedViewReferences: (ownerId, installationId) =>
			Effect.sync(() => {
				input?.savedViewFences?.push({ installationId, userId: ownerId });
				return input?.hasSavedViewReferences ?? false;
			}),
	});
	const uploadIntentsLayer = Layer.mock(UploadIntentsService)({
		deleteTemporaryUpload: (intentId) =>
			Effect.sync(() => input?.deletedUploads?.push(intentId)).pipe(
				Effect.andThen(
					input?.deleteUploadFails
						? Effect.fail(new UploadBadRequest({ reason: { intentId, code: "intent-busy" } }))
						: Effect.sync(() => undefined),
				),
			),
		claimTemporaryUpload: (token, ownerId, claimId) =>
			Effect.sync(() => input?.claimedUploads?.push({ token, claimId, userId: ownerId })).pipe(
				Effect.andThen(
					input?.claimUploadFails
						? Effect.fail(new UploadBadRequest({ reason: { code: "token-invalid" } }))
						: Effect.succeed({
								fileName: "plugin.zip",
								resolvedPath: "/tmp/plugin.zip",
								intentId: "plugin-upload-intent",
								leaseExpiresAt: "2026-08-27T00:00:00.000Z",
								locator: { key: "plugin-upload", type: "local" as const },
							}),
				),
			),
	});
	const clientCompilerLayer = input?.clientCompile
		? Layer.succeed(ClientPluginCompiler, ClientPluginCompiler.of({ compile: input.clientCompile }))
		: Layer.mock(ClientPluginCompiler)({});
	const objectStorageLayer = Layer.mock(ObjectStorageService)({
		openObject: () =>
			input?.openUploadFails
				? Effect.fail(badRequest("Plugin upload object is unavailable"))
				: Effect.succeed(Stream.make(input?.archiveBytes ?? new Uint8Array())),
	});
	const serviceLayer = PluginInstallationService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				loaderLayer,
				databaseLayer,
				invalidatorLayer,
				repositoryLayer,
				ingestionLockLayer,
				installationLayer,
				workflowReferenceLayer,
				uploadIntentsLayer,
				objectStorageLayer,
				clientCompilerLayer,
				styleXTracerActivationLayer(input?.stylexTracerEnabled ?? false),
				lifecycleDispatcherLayer,
				definitionMaterializerLayer,
			),
		),
	);
	return Layer.mergeAll(loaderLayer, serviceLayer, databaseLayer);
};

const bootstrapScript = {
	capabilities: [],
	kind: "script" as const,
	name: "Fixture Bootstrap",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "script.fixture-bootstrap",
	entry: "backend/bootstrap/bootstrap.sandbox.ts",
};

const bootstrapScriptSource = `import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	capabilities: [],
	name: "Fixture Bootstrap",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "script.fixture-bootstrap",
});

export default defineScript({
	manifest,
	output: Schema.Null,
	input: Schema.Unknown,
	run: () => Effect.succeed(null),
});
`;

const requireFixtureScript = () => {
	const script = fixtureManifest().scripts[0];
	assert(script);
	return script;
};

const userBootstrapEntry = {
	slug: "seed",
	description: "Seed owner data",
	scriptSlug: bootstrapScript.slug,
};

const systemEntry = (manifest: PluginManifest): PluginRegistryEntry => ({
	manifest,
	scripts: [],
	ownerId: null,
	scope: "system",
	slug: manifest.metadata.slug,
	id: `${manifest.metadata.slug}-plugin-id`,
	sourceHash: `hash-${manifest.metadata.slug}`,
});

const tracerManifest = (slug = "stylex-tracer") =>
	privateManifest({
		metadata: { ...privateManifest().metadata, slug, name: "StyleX tracer" },
		client: {
			apiVersion: 1,
			homeView: null,
			exports: {
				page: {
					kind: "page",
					entry: "client/page.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		},
	});

const tracerFiles = {
	"client/page.tsx": bytes(`
import { StyleXTracerPanel } from "@ryot-app/client-ui-sdk/stylex-tracer";
import { tracerTokens } from "@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
void StyleXTracerPanel;
void tracerTokens;
void stylex;
export default function Page() { return null; }
`),
};

const compileTracerClient: ClientPluginCompiler["Service"]["compile"] = (input) =>
	compileClientPlugin(input).pipe(
		Effect.map(({ artifact }) => artifact),
		Effect.provide(BunFileSystem.layer),
	);

it.effect("validates the exact tracer installation with StyleX when enabled", () => {
	const created: Array<Record<string, unknown>> = [];
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			config: {},
			files: tracerFiles,
			manifest: tracerManifest(),
		});

		expect(installed.slug).toBe("stylex-tracer");
		expect(created).toHaveLength(1);
		expect(persisted).toHaveLength(1);
	}).pipe(
		Effect.provide(
			makeLayer({
				created,
				persisted,
				stylexTracerEnabled: true,
				clientCompile: (input) => {
					expect(input.stylexTracer).toEqual({ fingerprint: STYLEX_TRACER_BUILD_FINGERPRINT });
					return compileTracerClient(input);
				},
			}),
		),
	);
});

it.effect("rejects tracer imports without persisting when activation is disabled", () => {
	const created: Array<Record<string, unknown>> = [];
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(
				service.installPrivatePlugin({
					userId,
					config: {},
					files: tracerFiles,
					manifest: tracerManifest(),
				}),
			),
		);

		assert(failure instanceof PluginRequestError);
		expect(failure.reason.code).toBe("compilation-failed");
		expect(created).toEqual([]);
		expect(persisted).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ created, persisted, clientCompile: compileTracerClient })));
});

it.effect("does not enable tracer compilation for another plugin slug", () => {
	const created: Array<Record<string, unknown>> = [];
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(
				service.installPrivatePlugin({
					userId,
					config: {},
					files: tracerFiles,
					manifest: tracerManifest("stylex-tracer-other"),
				}),
			),
		);

		assert(failure instanceof PluginRequestError);
		expect(failure.reason.code).toBe("compilation-failed");
		expect(created).toEqual([]);
		expect(persisted).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				created,
				persisted,
				stylexTracerEnabled: true,
				clientCompile: (input) => {
					expect(input.stylexTracer).toBeUndefined();
					return compileTracerClient(input);
				},
			}),
		),
	);
});

it.effect("claims, reads, and best-effort deletes an uploaded plugin archive", () => {
	const token = "plugin-upload-token";
	const claimedUploads: Array<Record<string, unknown>> = [];
	const deletedUploads: Array<string> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			config: {},
			uploadToken: token,
		});
		expect(installed.slug).toBe("private-fixture");
		expect(claimedUploads).toEqual([
			{ token, userId, claimId: `plugin-package:${sha256Hex(token)}` },
		]);
		expect(deletedUploads).toEqual(["plugin-upload-intent"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				claimedUploads,
				deletedUploads,
				deleteUploadFails: true,
				archiveBytes: writePluginArchive({ files: {}, manifest: privateManifest() }),
			}),
		),
	);
});

it.effect("maps an unavailable upload claim without attempting cleanup", () => {
	const deletedUploads: Array<string> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ userId, config: {}, uploadToken: "missing" }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "upload-unavailable" });
		expect(deletedUploads).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ deletedUploads, claimUploadFails: true })));
});

it.effect("maps an invalid archive and deletes the claimed upload", () => {
	const deletedUploads: Array<string> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ userId, config: {}, uploadToken: "corrupt" }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ issue: "malformed-zip", code: "package-archive-invalid" });
		expect(deletedUploads).toEqual(["plugin-upload-intent"]);
	}).pipe(Effect.provide(makeLayer({ deletedUploads, archiveBytes: new Uint8Array([1, 2, 3]) })));
});

it.effect("maps an unavailable archive object and deletes the claimed upload", () => {
	const deletedUploads: Array<string> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ userId, config: {}, uploadToken: "missing-object" }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "upload-unavailable" });
		expect(deletedUploads).toEqual(["plugin-upload-intent"]);
	}).pipe(Effect.provide(makeLayer({ deletedUploads, openUploadFails: true })));
});

it.effect("checks update ownership before claiming the upload", () => {
	const claimedUploads: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.updatePrivatePlugin({
				userId,
				config: {},
				uploadToken: "unused",
				pluginSlug: "not-installed",
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginNotFoundError);
		expect(claimedUploads).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ claimedUploads })));
});

it.effect("rejects an oversized package before compiling it", () => {
	const files = Object.fromEntries(
		Array.from({ length: PLUGIN_PACKAGE_LIMITS.fileCount + 1 }, (_unused, index) => [
			`scripts/file-${index}.ts`,
			bytes("this is not valid typescript {{{"),
		]),
	);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({ files, userId, config: {}, manifest: privateManifest() }),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ limit: "file-count", code: "package-limit-exceeded" });
	}).pipe(Effect.provide(makeLayer()));
});

it.effect("rejects only the private manifest surfaces that cannot carry user subject", () =>
	Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const fixture = fixtureManifest();
		const script = requireFixtureScript();
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				files: {},
				config: {},
				manifest: privateManifest({
					bindings: fixture.bindings,
					userBootstrap: [userBootstrapEntry],
					entitySchemas: fixture.entitySchemas,
					signalSchemas: fixture.signalSchemas,
					scripts: [...fixture.scripts, bootstrapScript],
					relationshipSchemas: fixture.relationshipSchemas,
					boot: [{ slug: "startup", description: "Startup", scriptSlug: script.slug }],
					httpRateLimits: [
						{ requests: 1, key: "outbound", intervalMs: 1_000, origins: ["https://example.com"] },
					],
					crons: [
						{
							slug: "hourly",
							description: "Hourly",
							scriptSlug: script.slug,
							schedule: { cron: "0 * * * *" },
						},
					],
				}),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		assert(failure.reason.code === "unsupported-manifest-surface");
		expect([...failure.reason.surfaces].sort((left, right) => left.localeCompare(right))).toEqual([
			"boot",
			"httpRateLimits",
			"userBootstrap",
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
				manifest: privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "slug-reserved", pluginSlug: "example" });
	}).pipe(
		Effect.provide(
			makeLayer({
				systemPlugins: [
					systemEntry(
						privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
					),
				],
			}),
		),
	),
);

it.effect("rejects persistence when a system slug appears after install preparation", () => {
	let systemSlugExists = false;
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
	const manifest = privateManifest();
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(service.installPrivatePlugin({ userId, manifest, files: {}, config: {} })),
		);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "slug-reserved", pluginSlug: manifest.metadata.slug });
		expect(persisted).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				persisted,
				lockIngestion: () => Effect.sync(() => void (systemSlugExists = true)),
				listActiveManifests: () => Effect.succeed(systemSlugExists ? [manifest] : []),
			}),
		),
	);
});

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
						name: { label: "Name", type: "string", description: "Name" },
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
	const invalidatedUsers: Array<UserId> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			files: {},
			manifest: configuredManifest,
			config: { token: "secret-value" },
		});
		expect(created[0]).toMatchObject({
			isDisabled: false,
			health: "installing",
			config: { region: "eu", token: "secret-value" },
		});
		expect(installed.config).toEqual({ region: "eu" });
		expect(installed.configuredSecrets).toEqual(["token"]);
		expect(installed.scope).toBe("user");
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(Effect.provide(makeLayer({ created, invalidatedUsers })));
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
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);
		const listed = yield* service.listInstallations(userId);
		expect(listed.map(({ slug }) => slug)).toEqual(["example", "private-fixture"]);
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

it.effect("sets and clears a usable home view without requiring workspace placement", () => {
	const updates: Array<Record<string, unknown>> = [];
	const homeViewEvents: Array<string> = [];
	const homeViewTransactionScopes: Array<"root" | "transaction"> = [];
	const invalidatedUsers: Array<UserId> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installation = installationRow({ pluginId: privatePlugin.id });
	const savedViewId = SavedViewId.make("global-view");
	const homeTargets = new Map<string, NonNullable<HomeSavedView>>([
		[
			savedViewId,
			{
				view: {
					isDisabled: false,
					renderer: { kind: "custom", rendererId: ClientRendererId.make("renderer-1") },
				},
				renderer: {
					userId,
					publishedRevision: 1,
					publishedHash: "published-hash",
					publishedDefinition: {
						files: [],
						entry: "client.tsx",
						pluginDependencies: [],
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				},
			},
		],
	]);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewId })).toEqual({
			savedViewId,
		});
		expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewId: null })).toEqual({
			savedViewId: null,
		});
		expect(updates).toEqual([
			{ userId, id: installation.id, homeSavedViewId: savedViewId },
			{ userId, id: installation.id, homeSavedViewId: null },
		]);
		expect(invalidatedUsers).toEqual([userId, userId]);
		expect(homeViewEvents).toEqual(["lock-saved-view", "set-installation", "set-installation"]);
		expect(homeViewTransactionScopes).toEqual(["transaction", "transaction", "transaction"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				homeTargets,
				homeViewEvents,
				invalidatedUsers,
				homeViewUpdates: updates,
				homeViewTransactionScopes,
				installations: [installation],
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("accepts a home view backed by an advertised plugin page", () => {
	const savedViewId = SavedViewId.make("plugin-view");
	const manifest = privateManifest({
		client: {
			apiVersion: 1,
			homeView: null,
			exports: {
				summary: {
					kind: "page",
					entry: "client/summary.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		},
	});
	const privatePlugin = storedPrivatePlugin(manifest);
	const installation = installationRow({ pluginId: privatePlugin.id });
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewId })).toEqual({
			savedViewId,
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				installations: [installation],
				privatePlugins: [privatePlugin],
				homeTargets: new Map([
					[
						savedViewId,
						{
							renderer: null,
							view: {
								isDisabled: false,
								renderer: { kind: "plugin", exportName: "summary", pluginId: privatePlugin.id },
							},
						},
					],
				]),
			}),
		),
	);
});

it.effect("rejects missing, disabled, and unusable home views", () => {
	const updates: Array<Record<string, unknown>> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installation = installationRow({ pluginId: privatePlugin.id });
	const disabledId = SavedViewId.make("disabled-view");
	const unavailableId = SavedViewId.make("unavailable-view");
	const missingId = SavedViewId.make("missing-view");
	const homeTargets = new Map<string, NonNullable<HomeSavedView>>([
		[
			disabledId,
			{
				renderer: null,
				view: { isDisabled: true, renderer: { kind: "kernel", name: "entity-browser" } },
			},
		],
		[
			unavailableId,
			{
				renderer: null,
				view: {
					isDisabled: false,
					renderer: { kind: "custom", rendererId: ClientRendererId.make("unpublished") },
				},
			},
		],
	]);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		for (const [savedViewId, code] of [
			[missingId, "home-view-not-found"],
			[disabledId, "home-view-disabled"],
			[unavailableId, "home-view-renderer-unavailable"],
		] as const) {
			expect(
				failureOf(
					yield* Effect.exit(service.setHomeView(userId, privatePlugin.slug, { savedViewId })),
				),
			).toMatchObject({ _tag: "PluginRequestError", reason: { code, savedViewId } });
		}
		expect(updates).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				homeTargets,
				homeViewUpdates: updates,
				installations: [installation],
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("falls back from a stale home override but preserves a usable selection", () => {
	const selectedId = SavedViewId.make("selected-view");
	const staleId = SavedViewId.make("stale-view");
	const selectedPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "selected" } }),
	);
	const stalePlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "stale" } }),
	);
	const installations = [
		installationRow({
			pluginScope: "system",
			pluginSlug: "selected",
			pluginId: selectedPlugin.id,
			homeSavedViewId: selectedId,
		}),
		installationRow({
			pluginSlug: "stale",
			pluginScope: "system",
			pluginId: stalePlugin.id,
			homeSavedViewId: staleId,
		}),
	];
	const homeTargets = new Map<string, NonNullable<HomeSavedView>>([
		[
			selectedId,
			{
				renderer: null,
				view: { isDisabled: false, renderer: { kind: "kernel", name: "entity-browser" } },
			},
		],
	]);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		loader.load(selectedPlugin);
		loader.load(stalePlugin);
		const service = yield* PluginInstallationService;
		const listed = yield* service.listInstallations(userId);
		expect(listed.map(({ slug, homeSavedViewId }) => ({ slug, homeSavedViewId }))).toEqual([
			{ slug: "selected", homeSavedViewId: selectedId },
			{ slug: "stale", homeSavedViewId: null },
		]);
	}).pipe(Effect.provide(makeLayer({ homeTargets, installations })));
});

it.effect("falls back to the manifest home and preserves the plugin root for null homes", () => {
	const defaultId = SavedViewId.make("default-home-id");
	const staleId = SavedViewId.make("stale-home-id");
	const kernelView = kernelDefinitionSource().savedViews[0];
	assert(kernelView?.renderer.kind === "kernel");
	const defaultPlugin = systemEntry(
		privateManifest({
			metadata: { ...privateManifest().metadata, slug: "defaulted" },
			savedViews: [
				{
					...kernelView,
					slug: "default-home",
					pluginSlug: "defaulted",
					renderer: kernelView.renderer,
				},
			],
			client: {
				apiVersion: 1,
				homeView: "default-home",
				exports: {
					widget: {
						kind: "component",
						entry: "client/widget.tsx",
						automaticEntityPresentations: false,
					},
				},
			},
		}),
	);
	const rootPlugin = systemEntry(
		privateManifest({
			metadata: { ...privateManifest().metadata, slug: "rooted" },
			client: {
				apiVersion: 1,
				homeView: null,
				routes: { "/": "root" },
				exports: {
					root: {
						kind: "page",
						entry: "client/root.tsx",
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				},
			},
		}),
	);
	const defaultInstallation = installationRow({
		pluginScope: "system",
		pluginSlug: "defaulted",
		homeSavedViewId: staleId,
		pluginId: defaultPlugin.id,
	});
	const rootInstallation = installationRow({
		pluginSlug: "rooted",
		pluginScope: "system",
		pluginId: rootPlugin.id,
	});
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		loader.load(defaultPlugin);
		loader.load(rootPlugin);
		const service = yield* PluginInstallationService;
		const listed = yield* service.listInstallations(userId);
		expect(listed.map(({ slug, homeSavedViewId }) => ({ slug, homeSavedViewId }))).toEqual([
			{ slug: "defaulted", homeSavedViewId: defaultId },
			{ slug: "rooted", homeSavedViewId: null },
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				installations: [defaultInstallation, rootInstallation],
				defaultHomeTargets: new Map([
					[
						`${defaultInstallation.id}:default-home`,
						{
							renderer: null,
							view: {
								id: defaultId,
								isDisabled: false,
								renderer: { kind: "kernel", name: "entity-browser" },
							},
						},
					],
				]),
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
		}).pipe(Effect.provide(makeLayer({ installations, privatePlugins: [privatePlugin] })));
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
	const invalidatedUsers: Array<UserId> = [];
	const updated: Array<Record<string, unknown>> = [];
	const systemPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
	);
	const installations = [
		installationRow({ pluginScope: "system", pluginSlug: "example", pluginId: systemPlugin.id }),
	];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);

		expect(
			yield* service.updateInstallation(userId, "example", { sortOrder: 4, isDisabled: true }),
		).toMatchObject({ config: {}, sortOrder: 4, scope: "system", isDisabled: true });
		expect(
			failureOf(yield* Effect.exit(service.updateInstallation(userId, "example", { config: {} }))),
		).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "system-plugin", pluginSlug: "example" },
		});
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(Effect.provide(makeLayer({ updated, installations, invalidatedUsers })));
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
			reason: { pluginSlug: "foreign", code: "plugin-not-found" },
		});
		expect(
			failureOf(
				yield* Effect.exit(
					service.updateInstallation(userId, privatePlugin.slug, { isDisabled: false }),
				),
			),
		).toMatchObject({
			_tag: "PluginConflictError",
			reason: { health: "needs-configuration", code: "installation-not-ready" },
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
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);
		const failure = failureOf(yield* Effect.exit(service.uninstallPlugin(userId, "example")));
		assert(failure instanceof PluginConflictError);
		expect(failure.reason).toEqual({ code: "system-plugin", pluginSlug: "example" });
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
	const invalidatedUsers: Array<UserId> = [];
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
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
				removedGenerated,
				invalidatedUsers,
				removed: removedIds,
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("fences a private uninstall on the exact installation being removed", () => {
	const deactivated: Array<string> = [];
	const integrationFences: Array<unknown> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(service.uninstallPlugin(userId, privatePlugin.slug)),
		);
		assert(failure instanceof PluginConflictError);
		expect(failure.reason.code).toBe("integration-referenced");
		expect(integrationFences).toEqual([
			{ pluginId: privatePlugin.id, pluginInstallationId: installations[0]?.id },
		]);
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
				integrationFences,
				hasIntegrationReferences: true,
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

it.effect("keeps a private plugin with custom views installed", () => {
	const deactivated: Array<string> = [];
	const savedViewFences: Array<unknown> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(service.uninstallPlugin(userId, privatePlugin.slug)),
		);
		assert(failure instanceof PluginConflictError);
		expect(failure.reason.code).toBe("saved-view-referenced");
		expect(savedViewFences).toEqual([{ userId, installationId: installations[0]?.id }]);
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
				savedViewFences,
				hasSavedViewReferences: true,
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
	entry: "backend/operations/operation.sandbox.ts",
};

const operationScriptSource = `import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

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
	const manifest = configuredManifest;
	const invalidatedUsers: Array<UserId> = [];
	const updated: Array<Record<string, unknown>> = [];
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
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
			files: { [operationScript.entry]: bytes(operationScriptSource) },
		});

		expect(persisted).toHaveLength(1);
		expect(persisted[0]).toMatchObject({
			plugin: { metadata: { version: "2.0.0" } },
			identity: { scope: "user", ownerId: userId, slug: privatePlugin.slug },
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
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(
		Effect.provide(
			makeLayer({
				updated,
				persisted,
				invalidatedUsers,
				installations: [installation],
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("fails a package update when generated views cannot be materialized", () => {
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
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
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
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
			reason: { code: "system-plugin", pluginSlug: "example" },
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
			reason: { pluginSlug: "foreign", code: "plugin-not-found" },
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
				files: { [operationScript.entry]: bytes(operationScriptSource) },
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
		slug: "run.fixture",
		auth: "user" as const,
		description: "Run fixture",
		scriptSlug: operationScript.slug,
	};
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				config: {},
				files: { [operationScript.entry]: bytes(operationScriptSource) },
				manifest: privateManifest({
					scripts: [operationScript],
					operations: [operation, operation],
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

const operationManifest = privateManifest({
	scripts: [operationScript],
	operations: [
		{
			auth: "user",
			slug: "run.fixture",
			description: "Run fixture",
			scriptSlug: operationScript.slug,
		},
	],
});

it.effect(
	"installs a private package in installing health and dispatches its lifecycle once",
	() => {
		const created: Array<Record<string, unknown>> = [];
		const dispatched: Array<string> = [];
		return Effect.gen(function* () {
			const service = yield* PluginInstallationService;
			const installed = yield* service.installPrivatePlugin({
				userId,
				config: {},
				manifest: operationManifest,
				files: { [operationScript.entry]: bytes(operationScriptSource) },
			});
			expect(installed.scope).toBe("user");
			expect(installed.slug).toBe("private-fixture");
			expect(installed.health).toBe("installing");
			expect(created).toHaveLength(1);
			expect(created[0]).toMatchObject({ health: "installing" });
			expect(dispatched).toEqual(["private-fixture-plugin-id-installation"]);
		}).pipe(Effect.provide(makeLayer({ created, dispatched })));
	},
);

it.effect("marks the installation failed when its lifecycle cannot be dispatched", () => {
	const dispatched: Array<string> = [];
	const healthUpdates: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			config: {},
			manifest: operationManifest,
			files: { [operationScript.entry]: bytes(operationScriptSource) },
		});
		expect(dispatched).toHaveLength(1);
		expect(healthUpdates).toEqual([
			{
				health: "failed",
				id: "private-fixture-plugin-id-installation",
				healthReason: "Installation lifecycle could not be started",
			},
		]);
		expect(installed).toMatchObject({
			health: "failed",
			healthReason: "Installation lifecycle could not be started",
		});
	}).pipe(Effect.provide(makeLayer({ dispatched, healthUpdates, dispatchFails: true })));
});

it.effect("rejects user bootstrap for a private package update", () => {
	const dispatched: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installation = installationRow({ pluginId: privatePlugin.id });
	const nextManifest = privateManifest({
		scripts: [bootstrapScript],
		userBootstrap: [userBootstrapEntry],
		metadata: { ...privateManifest().metadata, version: "2.0.0" },
	});
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(
				service.updatePrivatePlugin({
					userId,
					manifest: nextManifest,
					pluginSlug: privatePlugin.slug,
					files: { [bootstrapScript.entry]: bytes(bootstrapScriptSource) },
				}),
			),
		);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({
			surfaces: ["userBootstrap"],
			code: "unsupported-manifest-surface",
		});
		expect(dispatched).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({ dispatched, installations: [installation], privatePlugins: [privatePlugin] }),
		),
	);
});

it.effect("orders provisioned system installations by slug when their sort order ties", () => {
	const example = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
	);
	const sample = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "sample" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(example);
		loader.load(sample);
		const listed = yield* service.listInstallations(userId);
		expect(listed.map(({ slug, sortOrder }) => [slug, sortOrder])).toEqual([
			["example", 0],
			["sample", 0],
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				installations: [
					installationRow({ pluginId: example.id, pluginScope: "system", pluginSlug: "example" }),
					installationRow({ pluginId: sample.id, pluginSlug: "sample", pluginScope: "system" }),
				],
			}),
		),
	);
});

const shippedConflict = (issue: string) => `Conflicts with the shipped plugin set: ${issue}`;

const sharedImportSource = {
	name: "Shared",
	slug: "shared-source",
	description: "Shared import",
	requiredPluginConfigKeys: [],
	workflowSlug: "fixture-workflow",
	inputSchema: { fields: {}, unknownKeys: "strict" as const },
};

const privateInstallationRow = (
	overrides: Partial<PluginPrivateInstallationRow> & { readonly pluginSlug: string },
): PluginPrivateInstallationRow => ({
	userId,
	health: "ready",
	healthReason: null,
	pluginId: `${overrides.pluginSlug}-plugin-id`,
	installationId: `${overrides.pluginSlug}-installation`,
	manifest: privateManifest({
		metadata: { ...privateManifest().metadata, slug: overrides.pluginSlug },
	}),
	...overrides,
});

const shippedEntry = (overrides: Partial<PluginManifest> = {}) =>
	systemEntry(
		privateManifest({ ...overrides, metadata: { ...privateManifest().metadata, slug: "example" } }),
	);

it.effect("marks a private installation incompatible when a shipped plugin claims its slug", () => {
	const invalidatedAll: Array<void> = [];
	const invalidatedUsers: Array<UserId> = [];
	const healthUpdates: Array<Record<string, unknown>> = [];
	const shadowed = privateInstallationRow({ pluginSlug: "example" });
	const untouched = privateInstallationRow({ pluginSlug: "notes" });
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(shippedEntry());
		yield* service.reconcileSystemInstallations();
		expect(healthUpdates).toEqual([
			{
				health: "incompatible",
				id: shadowed.installationId,
				healthReason: shippedConflict("Shipped plugins already use the slug 'example'"),
			},
		]);
		expect(invalidatedAll).toHaveLength(1);
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(
		Effect.provide(
			makeLayer({
				healthUpdates,
				invalidatedAll,
				invalidatedUsers,
				privateInstallations: [shadowed, untouched],
			}),
		),
	);
});

it.effect("marks conflicts claimed on a shipped surface slug or definition slug", () => {
	const healthUpdates: Array<Record<string, unknown>> = [];
	const surfaceRow = privateInstallationRow({
		pluginSlug: "notes",
		manifest: privateManifest({
			importSources: [sharedImportSource],
			metadata: { ...privateManifest().metadata, slug: "notes" },
		}),
	});
	const definitionRow = privateInstallationRow({
		pluginSlug: "tasks",
		manifest: privateManifest({
			entitySchemas: fixtureManifest().entitySchemas,
			metadata: { ...privateManifest().metadata, slug: "tasks" },
		}),
	});
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(
			shippedEntry({
				importSources: [sharedImportSource],
				entitySchemas: fixtureManifest().entitySchemas,
			}),
		);
		yield* service.reconcileSystemInstallations();
		expect(healthUpdates).toEqual([
			{
				health: "incompatible",
				id: surfaceRow.installationId,
				healthReason: shippedConflict(
					"Duplicate import source slug 'shared-source' in effective plugins 'example' and 'notes'",
				),
			},
			{
				health: "incompatible",
				id: definitionRow.installationId,
				healthReason: shippedConflict(
					"Shipped plugins already define the entity schema 'fixture-entity'",
				),
			},
		]);
	}).pipe(
		Effect.provide(makeLayer({ healthUpdates, privateInstallations: [surfaceRow, definitionRow] })),
	);
});

it.effect("marks a private installation incompatible when a shipped plugin claims its view", () => {
	const materialized: Array<string> = [];
	const removedGenerated: Array<string> = [];
	const healthUpdates: Array<Record<string, unknown>> = [];
	const kernelView = kernelDefinitionSource().savedViews[0];
	assert(kernelView);
	assert(kernelView.renderer.kind === "kernel");
	const savedView = {
		...kernelView,
		name: "Shared View",
		slug: "shared-view",
		renderer: kernelView.renderer,
	};
	const withSavedView = (slug: string) =>
		privateManifest({ savedViews: [savedView], metadata: { ...privateManifest().metadata, slug } });
	const shadowed = privateInstallationRow({
		pluginSlug: "notes",
		manifest: withSavedView("notes"),
	});
	const settled = privateInstallationRow({
		health: "failed",
		pluginSlug: "tasks",
		manifest: withSavedView("tasks"),
	});
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(shippedEntry({ savedViews: [savedView] }));
		yield* service.reconcileSystemInstallations();
		expect(healthUpdates).toEqual([
			{
				health: "incompatible",
				id: shadowed.installationId,
				healthReason: shippedConflict(
					"Shipped plugins already define the saved view 'shared-view'",
				),
			},
		]);
		expect(removedGenerated).toEqual([shadowed.installationId, settled.installationId]);
		expect(materialized).toEqual([userId]);
	}).pipe(
		Effect.provide(
			makeLayer({
				healthUpdates,
				removedGenerated,
				privateInstallations: [shadowed, settled],
				materialize: (owner) => Effect.sync(() => void materialized.push(owner)),
			}),
		),
	);
});

it.effect("returns an incompatible installation to ready once its conflict is gone", () => {
	const updated: Array<Record<string, unknown>> = [];
	const deactivated: Array<string> = [];
	const materialized: Array<string> = [];
	const healthUpdates: Array<Record<string, unknown>> = [];
	const recovered = privateInstallationRow({
		pluginSlug: "notes",
		health: "incompatible",
		healthReason: shippedConflict("Shipped plugins already use the slug 'notes'"),
	});
	const otherOwner = privateInstallationRow({
		pluginSlug: "tasks",
		userId: UserId.make("user-2"),
		installationId: "tasks-installation-other",
	});
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		yield* service.reconcileSystemInstallations();
		expect(healthUpdates).toEqual([
			{ health: "ready", healthReason: null, id: recovered.installationId },
		]);
		expect(materialized).toEqual([userId]);
		expect([...updated, ...deactivated]).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				updated,
				deactivated,
				healthUpdates,
				privateInstallations: [recovered, otherOwner],
				materialize: (owner) => Effect.sync(() => void materialized.push(owner)),
			}),
		),
	);
});

it.effect(
	"leaves installing, settled and unchanged-reason conflicts alone but clears their views",
	() => {
		const removedGenerated: Array<string> = [];
		const healthUpdates: Array<Record<string, unknown>> = [];
		const reason = shippedConflict("Shipped plugins already use the slug 'example'");
		const privateInstallations = [
			privateInstallationRow({ health: "failed", pluginSlug: "example", installationId: "failed" }),
			privateInstallationRow({
				health: "installing",
				pluginSlug: "example",
				installationId: "installing",
			}),
			privateInstallationRow({
				pluginSlug: "example",
				health: "needs-configuration",
				installationId: "unconfigured",
			}),
			privateInstallationRow({
				healthReason: reason,
				pluginSlug: "example",
				health: "incompatible",
				installationId: "already-incompatible",
			}),
		];
		return Effect.gen(function* () {
			const loader = yield* PluginLoader;
			const service = yield* PluginInstallationService;
			loader.load(shippedEntry());
			yield* service.reconcileSystemInstallations();
			expect(healthUpdates).toEqual([]);
			expect(removedGenerated).toEqual([
				"failed",
				"installing",
				"unconfigured",
				"already-incompatible",
			]);
		}).pipe(Effect.provide(makeLayer({ healthUpdates, removedGenerated, privateInstallations })));
	},
);

it.effect("dispatches every pending installation and keeps going after a failed dispatch", () => {
	const dispatched: Array<string> = [];
	const pendingLifecycle = ["installation-a", "installation-b", "installation-c"];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		yield* service.dispatchPendingInstallationLifecycle();
		expect([...dispatched].sort()).toEqual(pendingLifecycle);
	}).pipe(
		Effect.provide(
			makeLayer({ dispatched, pendingLifecycle, dispatchFailsFor: ["installation-b"] }),
		),
	);
});

it.effect("clears incompatible health when a private package update succeeds", () => {
	const healthUpdates: Array<Record<string, unknown>> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installation = installationRow({
		health: "incompatible",
		pluginId: privatePlugin.id,
		healthReason: shippedConflict("Shipped plugins already use the slug 'private-fixture'"),
	});
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const result = yield* service.updatePrivatePlugin({
			userId,
			files: {},
			pluginSlug: privatePlugin.slug,
			manifest: privateManifest({ metadata: { ...privateManifest().metadata, version: "2.0.0" } }),
		});
		expect(result).toMatchObject({ health: "ready", version: "2.0.0", healthReason: null });
		expect(healthUpdates).toEqual([{ health: "ready", healthReason: null, id: installation.id }]);
	}).pipe(
		Effect.provide(
			makeLayer({ healthUpdates, installations: [installation], privatePlugins: [privatePlugin] }),
		),
	);
});

it.effect("uninstalls a private plugin shadowed by a newly shipped slug", () => {
	const removedIds: Array<string> = [];
	const deactivated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const service = yield* PluginInstallationService;
		loader.load(
			systemEntry(
				privateManifest({ metadata: { ...privateManifest().metadata, slug: privatePlugin.slug } }),
			),
		);
		const removed = yield* service.uninstallPlugin(userId, privatePlugin.slug);
		expect(removed.slug).toBe(privatePlugin.slug);
		expect(deactivated).toEqual([privatePlugin.id]);
		expect(removedIds).toEqual([installations[0]?.id]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
				removed: removedIds,
				privatePlugins: [privatePlugin],
			}),
		),
	);
});
