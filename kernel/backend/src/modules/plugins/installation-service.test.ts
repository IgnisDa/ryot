import { assert, expect, it } from "@effect/vitest";
import { badRequest, type InternalError, internalError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { writePluginArchive } from "@ryot-app/plugin-archive";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Cause, Context, Effect, Exit, Layer, Option, Stream } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { databaseLayer } from "#lib/test-utils/effect";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginIngestionLock } from "./ingestion-lock";
import {
	PluginInstallationRepository,
	type PluginInstallationHydratedState,
	type PluginPrivateInstallationRow,
} from "./installation-repository";
import { PluginInstallationService } from "./installation-service";
import { PluginInstallationLifecycleDispatcher } from "./installation-workflow";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { PluginSavedViewReferences } from "./saved-view-references";
import { validateSystemPluginSet } from "./system-set";
import { fixtureManifest } from "./test-support";
import type { StoredPlugin } from "./types";
import { PLUGIN_PACKAGE_LIMITS } from "./validation";

class LoadedSystemPlugins extends Context.Service<
	LoadedSystemPlugins,
	{ readonly load: (plugin: StoredPlugin) => void }
>()("LoadedSystemPlugins") {}

const userId = UserId.make("user-1");
const bytes = (value: string) => new TextEncoder().encode(value);
const compiledScriptsFor = (
	manifest: PluginManifest,
	files: Readonly<Record<string, Uint8Array>>,
) =>
	manifest.scripts.map(({ entry }) => ({
		entry,
		format: 1,
		javascript: "export {};",
		source: files[entry] ? new TextDecoder("utf-8", { fatal: true }).decode(files[entry]) : "",
	}));
type HomeSavedView = Effect.Success<
	ReturnType<PluginInstallationRepository["Service"]["findHomeSavedView"]>
>;

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
	assert(Exit.isFailure(exit));
	return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

const privateManifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
	...fixtureManifest(),
	hooks: [],
	scripts: [],
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
	metadata: { ...fixtureManifest().metadata, name: "Private", slug: "private-fixture" },
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
	overrides: Partial<PluginInstallationHydratedState> & { pluginId: string },
): PluginInstallationHydratedState => ({
	userId,
	config: {},
	sortOrder: 0,
	health: "ready",
	isDisabled: false,
	healthReason: null,
	uninstalledAt: null,
	pluginScope: "user",
	createdAt: new Date(),
	updatedAt: new Date(),
	homeSavedViewSlug: null,
	activeConfigRevisionId: null,
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
	readonly savedViewFences?: Array<unknown>;
	readonly invalidatedUsers?: Array<UserId>;
	readonly hasSavedViewReferences?: boolean;
	readonly hasDefinitionReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly integrationFences?: Array<unknown>;
	readonly privatePlugins?: Array<StoredPlugin>;
	readonly created?: Array<Record<string, unknown>>;
	readonly updated?: Array<Record<string, unknown>>;
	readonly missingUpdateState?: boolean;
	readonly lockIngestion?: () => Effect.Effect<void>;
	readonly systemPlugins?: Array<StoredPlugin>;
	readonly installations?: Array<PluginInstallationHydratedState>;
	readonly healthUpdates?: Array<Record<string, unknown>>;
	readonly homeViewUpdates?: Array<Record<string, unknown>>;
	readonly homeViewTransactionScopes?: Array<"root" | "transaction">;
	readonly homeTargets?: ReadonlyMap<string, NonNullable<HomeSavedView>>;
	readonly claimedUploads?: Array<Record<string, unknown>>;
	readonly privateInstallations?: Array<PluginPrivateInstallationRow>;
	readonly listActiveSystemSlugs?: () => Effect.Effect<Array<string>>;
	readonly persisted?: Array<{
		plugin: StoredPlugin["manifest"];
		identity: Record<string, unknown>;
	}>;
}) => {
	const systemPlugins = [...(input?.systemPlugins ?? [])];
	const loadedLayer = Layer.succeed(LoadedSystemPlugins, {
		load: (plugin) => {
			const index = systemPlugins.findIndex(({ slug }) => slug === plugin.slug);
			systemPlugins.splice(index === -1 ? systemPlugins.length : index, 1, plugin);
		},
	});
	const definitionsLayer = Layer.mock(DefinitionRepository)({
		getGlobalSnapshot: Effect.sync(() =>
			validateSystemPluginSet(kernelDefinitionSource(), systemPlugins),
		),
	});
	const invalidatorLayer = Layer.succeed(PluginCatalogInvalidator, {
		all: Effect.sync(() => void input?.invalidatedAll?.push(undefined)),
		user: (ownerId) => Effect.sync(() => void input?.invalidatedUsers?.push(ownerId)),
	});
	const repositoryLayer = Layer.mock(PluginRepository)({
		lockIngestion: () => input?.lockIngestion?.() ?? Effect.void,
		listActiveSystemPlugins: () => Effect.sync(() => [...systemPlugins]),
		listPrivateForUser: () => Effect.succeed(input?.privatePlugins ?? []),
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		deactivate: (pluginId) => Effect.sync(() => void input?.deactivated?.push(pluginId)),
		hasDefinitionReferences: () => Effect.succeed(input?.hasDefinitionReferences ?? false),
		findActiveSystemPlugin: (slug) =>
			Effect.sync(() => systemPlugins.find((plugin) => plugin.slug === slug) ?? null),
		listActiveSystemSlugs: () =>
			input?.listActiveSystemSlugs?.() ?? Effect.sync(() => systemPlugins.map(({ slug }) => slug)),
		findPrivateByIdForUser: (pluginId) =>
			Effect.succeed((input?.privatePlugins ?? []).find(({ id }) => id === pluginId) ?? null),
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
	const installationLayer = Layer.mock(PluginInstallationRepository)({
		refreshClientConfigsForPlugin: () => Effect.void,
		provisionSystemInstallationsForAllUsers: () => Effect.void,
		remove: (id) => Effect.sync(() => input?.removed?.push(id)),
		listForUser: () => Effect.succeed(input?.installations ?? []),
		listPendingLifecycle: () => Effect.succeed(input?.pendingLifecycle ?? []),
		listPrivateInstallations: () => Effect.succeed(input?.privateInstallations ?? []),
		updateHealth: (values) => Effect.sync(() => void input?.healthUpdates?.push(values)),
		findByUserAndPlugin: (_user, pluginId) =>
			Effect.succeed((input?.installations ?? []).find((row) => row.pluginId === pluginId) ?? null),
		upsertState: (values) =>
			Effect.sync(() => {
				input?.created?.push(values);
				return installationRow({ ...values, pluginId: values.pluginId });
			}),
		findHomeSavedView: (_ownerId, savedViewSlug) =>
			Effect.gen(function* () {
				const database = yield* Database;
				input?.homeViewTransactionScopes?.push("transaction" in database ? "root" : "transaction");
				input?.homeViewEvents?.push("lock-saved-view");
				return input?.homeTargets?.get(savedViewSlug) ?? null;
			}),
		setHomeSavedView: (ownerId, id, homeSavedViewSlug) =>
			Effect.gen(function* () {
				const database = yield* Database;
				input?.homeViewTransactionScopes?.push("transaction" in database ? "root" : "transaction");
				input?.homeViewEvents?.push("set-installation");
				input?.homeViewUpdates?.push({ id, userId: ownerId, homeSavedViewSlug });
				return (input?.installations ?? []).some((row) => row.id === id && row.userId === ownerId);
			}),
		updateState: (values) =>
			Effect.sync(() => {
				input?.updated?.push(values);
				const current = (input?.installations ?? []).find((row) => row.id === values.id);
				return current && !input?.missingUpdateState
					? {
							...current,
							...values,
							healthReason: current.health === "needs-configuration" ? null : current.healthReason,
							health:
								current.health === "needs-configuration" ? ("ready" as const) : current.health,
						}
					: undefined;
			}),
	});
	const ingestionLockLayer = PluginIngestionLock.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				repositoryLayer,
				installationLayer,
				Layer.succeed(PluginRevisionActivation, { activated: () => Effect.void }),
			),
		),
	);
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
	const savedViewReferencesLayer = Layer.succeed(PluginSavedViewReferences, {
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
						: Effect.void.pipe(Effect.as(undefined)),
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
	const objectStorageLayer = Layer.mock(ObjectStorageService)({
		openObject: () =>
			input?.openUploadFails
				? Effect.fail(badRequest("Plugin upload object is unavailable"))
				: Effect.succeed(Stream.make(input?.archiveBytes ?? new Uint8Array())),
	});
	const serviceLayer = PluginInstallationService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				definitionsLayer,
				invalidatorLayer,
				repositoryLayer,
				ingestionLockLayer,
				installationLayer,
				workflowReferenceLayer,
				uploadIntentsLayer,
				objectStorageLayer,
				lifecycleDispatcherLayer,
				savedViewReferencesLayer,
			),
		),
	);
	return Layer.mergeAll(loadedLayer, serviceLayer, databaseLayer);
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

const systemEntry = (manifest: PluginManifest): StoredPlugin => ({
	manifest,
	scripts: [],
	ownerId: null,
	scope: "system",
	status: "active",
	slug: manifest.metadata.slug,
	id: `${manifest.metadata.slug}-plugin-id`,
	sourceHash: `hash-${manifest.metadata.slug}`,
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
		expect(installed).toEqual({
			pluginId: "private-fixture-plugin-id",
			id: "private-fixture-plugin-id-installation",
		});
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

it.effect("rejects an oversized package before persistence", () => {
	const files = Object.fromEntries(
		Array.from({ length: PLUGIN_PACKAGE_LIMITS.fileCount + 1 }, (_unused, index) => [
			`scripts/file-${index}.ts`,
			bytes("this is not valid typescript {{{"),
		]),
	);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				files,
				userId,
				config: {},
				compiledScripts: [],
				manifest: privateManifest(),
			}),
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
		const manifest = privateManifest({
			hooks: fixture.hooks,
			userBootstrap: [userBootstrapEntry],
			entitySchemas: fixture.entitySchemas,
			signalSchemas: fixture.signalSchemas,
			scripts: [...fixture.scripts, bootstrapScript],
			relationshipSchemas: fixture.relationshipSchemas,
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
		});
		const files = Object.fromEntries(manifest.scripts.map(({ entry }) => [entry, bytes("source")]));
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				files,
				userId,
				manifest,
				config: {},
				compiledScripts: compiledScriptsFor(manifest, files),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		assert(failure.reason.code === "unsupported-manifest-surface");
		expect([...failure.reason.surfaces].sort((left, right) => left.localeCompare(right))).toEqual([
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
				compiledScripts: [],
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
			yield* Effect.exit(
				service.installPrivatePlugin({
					userId,
					manifest,
					files: {},
					config: {},
					compiledScripts: [],
				}),
			),
		);
		assert(failure instanceof PluginRequestError);
		expect(failure.reason).toEqual({ code: "slug-reserved", pluginSlug: manifest.metadata.slug });
		expect(persisted).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				persisted,
				lockIngestion: () => Effect.sync(() => void (systemSlugExists = true)),
				listActiveSystemSlugs: () =>
					Effect.succeed(systemSlugExists ? [manifest.metadata.slug] : []),
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

it.effect("applies config defaults and persists validated config", () => {
	const created: Array<Record<string, unknown>> = [];
	const invalidatedUsers: Array<UserId> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const installed = yield* service.installPrivatePlugin({
			userId,
			files: {},
			compiledScripts: [],
			manifest: configuredManifest,
			config: { token: "secret-value" },
		});
		expect(created[0]).toMatchObject({
			isDisabled: false,
			health: "installing",
			config: { region: "eu", token: "secret-value" },
		});
		expect(installed).toEqual({
			pluginId: "private-fixture-plugin-id",
			id: "private-fixture-plugin-id-installation",
		});
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(Effect.provide(makeLayer({ created, invalidatedUsers })));
});

it.effect("rejects config missing a required value before persisting", () => {
	const created: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				userId,
				files: {},
				config: {},
				compiledScripts: [],
				manifest: configuredManifest,
			}),
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
			service.installPrivatePlugin({
				userId,
				files: {},
				config: {},
				compiledScripts: [],
				manifest: privateManifest(),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginConflictError);
		expect(failure.reason).toEqual({ code: "already-installed", pluginSlug: privatePlugin.slug });
	}).pipe(Effect.provide(makeLayer({ privatePlugins: [privatePlugin] })));
});

it.effect("sets and clears a usable home view without requiring workspace placement", () => {
	const updates: Array<Record<string, unknown>> = [];
	const homeViewEvents: Array<string> = [];
	const homeViewTransactionScopes: Array<"root" | "transaction"> = [];
	const invalidatedUsers: Array<UserId> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installation = installationRow({ pluginId: privatePlugin.id });
	const savedViewSlug = "global-view";
	const homeTargets = new Map<string, NonNullable<HomeSavedView>>([
		[
			savedViewSlug,
			{ view: { isDisabled: false, renderer: { kind: "kernel", name: "entity-browser" } } },
		],
	]);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewSlug })).toEqual({
			savedViewSlug,
		});
		expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewSlug: null })).toEqual(
			{ savedViewSlug: null },
		);
		expect(updates).toEqual([
			{ userId, id: installation.id, homeSavedViewSlug: savedViewSlug },
			{ userId, id: installation.id, homeSavedViewSlug: null },
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
	const savedViewSlug = "plugin-view";
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
		expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewSlug })).toEqual({
			savedViewSlug,
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				installations: [installation],
				privatePlugins: [privatePlugin],
				homeTargets: new Map([
					[
						savedViewSlug,
						{
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
	const disabledId = "disabled-view";
	const unavailableId = "unavailable-view";
	const missingId = "missing-view";
	const homeTargets = new Map<string, NonNullable<HomeSavedView>>([
		[
			disabledId,
			{ view: { isDisabled: true, renderer: { kind: "kernel", name: "entity-browser" } } },
		],
		[
			unavailableId,
			{
				view: {
					isDisabled: false,
					renderer: { kind: "plugin", exportName: "missing", pluginId: privatePlugin.id },
				},
			},
		],
	]);
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		for (const [savedViewSlug, code] of [
			[missingId, "home-view-not-found"],
			[disabledId, "home-view-disabled"],
			[unavailableId, "home-view-renderer-unavailable"],
		] as const) {
			expect(
				failureOf(
					yield* Effect.exit(service.setHomeView(userId, privatePlugin.slug, { savedViewSlug })),
				),
			).toMatchObject({ _tag: "PluginRequestError", reason: { code, savedViewSlug } });
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
		expect(result).toEqual({
			pluginId: privatePlugin.id,
			id: "private-fixture-plugin-id-installation",
		});
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

it.effect("rejects an update when the installation write affects no row", () => {
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installation = installationRow({ pluginId: privatePlugin.id });
	const invalidatedUsers: Array<UserId> = [];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		for (const update of [
			service.updateInstallation(userId, privatePlugin.slug, { sortOrder: 1 }),
			service.updatePrivatePlugin({
				userId,
				files: {},
				compiledScripts: [],
				manifest: privateManifest(),
				pluginSlug: privatePlugin.slug,
			}),
		]) {
			const failure = failureOf(yield* Effect.exit(update));
			assert(failure instanceof PluginNotFoundError);
			expect(failure.reason).toEqual({ code: "plugin-not-found", pluginSlug: privatePlugin.slug });
		}
		expect(invalidatedUsers).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				invalidatedUsers,
				missingUpdateState: true,
				installations: [installation],
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

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
		expect(reset).toEqual({ id: installations[0]?.id, pluginId: privatePlugin.id });

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
		const loader = yield* LoadedSystemPlugins;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);

		expect(
			yield* service.updateInstallation(userId, "example", { sortOrder: 4, isDisabled: true }),
		).toEqual({ id: installations[0]?.id, pluginId: systemPlugin.id });
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
			reason: { health: "installing", code: "installation-not-ready" },
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				privatePlugins: [privatePlugin],
				installations: [
					installationRow({
						isDisabled: true,
						health: "installing",
						pluginId: privatePlugin.id,
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
		const loader = yield* LoadedSystemPlugins;
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
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const removed = yield* service.uninstallPlugin(userId, privatePlugin.slug);
		expect(removed).toEqual({ id: installations[0]?.id, pluginId: privatePlugin.id });
		expect(deactivated).toEqual([privatePlugin.id]);
		expect(removedIds).toEqual([installations[0]?.id]);
		expect(invalidatedUsers).toEqual([userId]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				installations,
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

it.effect("tombstones a private installation while accepted workflows retain their pins", () => {
	const deactivated: Array<string> = [];
	const privatePlugin = storedPrivatePlugin(privateManifest());
	const installations = [installationRow({ pluginId: privatePlugin.id })];
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		expect(yield* service.uninstallPlugin(userId, privatePlugin.slug)).toEqual({
			id: installations[0]?.id,
			pluginId: privatePlugin.id,
		});
		expect(deactivated).toEqual([privatePlugin.id]);
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
				demoAccess: "allowed",
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
			compiledScripts: compiledScriptsFor(nextManifest, {
				[operationScript.entry]: bytes(operationScriptSource),
			}),
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
		expect(result).toEqual({ id: installation.id, pluginId: privatePlugin.id });
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

it.effect("rejects changed identity but activates an upgrade needing configuration", () => {
	const nextManifest: PluginManifest = {
		...configuredManifest,
		metadata: { ...configuredManifest.metadata, version: "2.0.0" },
		configSchema: {
			...configuredManifest.configSchema,
			fields: {
				...configuredManifest.configSchema.fields,
				endpoint: {
					type: "string",
					label: "Endpoint",
					validation: { required: true },
					description: "Required endpoint",
				},
			},
		},
	};
	const persisted: Array<{ plugin: StoredPlugin["manifest"]; identity: Record<string, unknown> }> =
		[];
	const healthUpdates: Array<Record<string, unknown>> = [];
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
		const changedSlug = failureOf(
			yield* Effect.exit(
				service.updatePrivatePlugin({
					userId,
					files: {},
					compiledScripts: [],
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
		expect(persisted).toEqual([]);

		const invalidConfig = yield* service.updatePrivatePlugin({
			userId,
			files: {},
			compiledScripts: [],
			manifest: nextManifest,
			pluginSlug: privatePlugin.slug,
		});
		expect(invalidConfig).toEqual({ id: installations[0]?.id, pluginId: privatePlugin.id });
		expect(persisted.map(({ plugin }) => plugin)).toEqual([nextManifest]);
		expect(healthUpdates).toEqual([
			{
				id: installations[0]?.id,
				health: "needs-configuration",
				healthReason: "Configuration does not match the active package revision",
			},
		]);
		expect(updated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				updated,
				persisted,
				installations,
				healthUpdates,
				privatePlugins: [privatePlugin],
			}),
		),
	);
});

it.effect("validates reconfiguration before enabling newly compatible definitions", () => {
	const updated: Array<Record<string, unknown>> = [];
	const privatePlugin = storedPrivatePlugin(configuredManifest);
	const installation = installationRow({
		isDisabled: true,
		config: { region: "us" },
		pluginId: privatePlugin.id,
		health: "needs-configuration",
	});
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		expect(
			failureOf(
				yield* Effect.exit(
					service.updateInstallation(userId, privatePlugin.slug, { isDisabled: false }),
				),
			),
		).toMatchObject({ _tag: "PluginRequestError", reason: { code: "validation-failed" } });
		expect(updated).toEqual([]);
		const result = yield* service.updateInstallation(userId, privatePlugin.slug, {
			isDisabled: false,
			config: { token: "replacement-secret" },
		});
		expect(result).toEqual({ id: installation.id, pluginId: privatePlugin.id });
		expect(updated).toEqual([
			{
				sortOrder: 0,
				isDisabled: false,
				id: installation.id,
				config: { region: "us", token: "replacement-secret" },
			},
		]);
	}).pipe(
		Effect.provide(
			makeLayer({ updated, installations: [installation], privatePlugins: [privatePlugin] }),
		),
	);
});

it.effect("rejects package updates for system and foreign plugins", () => {
	const systemPlugin = systemEntry(
		privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
	);
	return Effect.gen(function* () {
		const loader = yield* LoadedSystemPlugins;
		const service = yield* PluginInstallationService;
		loader.load(systemPlugin);

		expect(
			failureOf(
				yield* Effect.exit(
					service.updatePrivatePlugin({
						userId,
						files: {},
						compiledScripts: [],
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
						compiledScripts: [],
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
	const manifest = privateManifest({
		scripts: [operationScript],
		operations: [
			{
				auth: "user",
				slug: "run.fixture",
				demoAccess: "allowed",
				description: "Run fixture",
				scriptSlug: "does-not-exist",
			},
		],
	});
	const files = { [operationScript.entry]: bytes(operationScriptSource) };
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				files,
				userId,
				manifest,
				config: {},
				compiledScripts: compiledScriptsFor(manifest, files),
			}),
		);
		const failure = failureOf(exit);
		assert(failure instanceof PluginRequestError);
		assert(failure.reason.code === "validation-failed");
		expect(created).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ created })));
});

it.effect("rejects duplicate operation slugs before persistence", () => {
	const created: Array<Record<string, unknown>> = [];
	const operation = {
		slug: "run.fixture",
		auth: "user" as const,
		description: "Run fixture",
		demoAccess: "allowed" as const,
		scriptSlug: operationScript.slug,
	};
	const manifest = privateManifest({
		scripts: [operationScript],
		operations: [operation, operation],
	});
	const files = { [operationScript.entry]: bytes(operationScriptSource) };
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const exit = yield* Effect.exit(
			service.installPrivatePlugin({
				files,
				userId,
				manifest,
				config: {},
				compiledScripts: compiledScriptsFor(manifest, files),
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
			demoAccess: "allowed",
			description: "Run fixture",
			scriptSlug: operationScript.slug,
		},
	],
});
const operationFiles = { [operationScript.entry]: bytes(operationScriptSource) };
const operationCompiledScripts = compiledScriptsFor(operationManifest, operationFiles);

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
				files: operationFiles,
				manifest: operationManifest,
				compiledScripts: operationCompiledScripts,
			});
			expect(installed).toEqual({
				pluginId: "private-fixture-plugin-id",
				id: "private-fixture-plugin-id-installation",
			});
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
			files: operationFiles,
			manifest: operationManifest,
			compiledScripts: operationCompiledScripts,
		});
		expect(dispatched).toHaveLength(1);
		expect(healthUpdates).toEqual([
			{
				health: "failed",
				id: "private-fixture-plugin-id-installation",
				healthReason: "Installation lifecycle could not be started",
			},
		]);
		expect(installed).toEqual({
			pluginId: "private-fixture-plugin-id",
			id: "private-fixture-plugin-id-installation",
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
	const files = { [bootstrapScript.entry]: bytes(bootstrapScriptSource) };
	return Effect.gen(function* () {
		const service = yield* PluginInstallationService;
		const failure = failureOf(
			yield* Effect.exit(
				service.updatePrivatePlugin({
					files,
					userId,
					manifest: nextManifest,
					pluginSlug: privatePlugin.slug,
					compiledScripts: compiledScriptsFor(nextManifest, files),
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
		const loader = yield* LoadedSystemPlugins;
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
		const loader = yield* LoadedSystemPlugins;
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
		const loader = yield* LoadedSystemPlugins;
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
	}).pipe(Effect.provide(makeLayer({ healthUpdates, privateInstallations: [shadowed, settled] })));
});

it.effect("returns an incompatible installation to ready once its conflict is gone", () => {
	const updated: Array<Record<string, unknown>> = [];
	const deactivated: Array<string> = [];
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
		expect([...updated, ...deactivated]).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				updated,
				deactivated,
				healthUpdates,
				privateInstallations: [recovered, otherOwner],
			}),
		),
	);
});

it.effect("leaves installing, settled and unchanged-reason conflicts alone", () => {
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
		const loader = yield* LoadedSystemPlugins;
		const service = yield* PluginInstallationService;
		loader.load(shippedEntry());
		yield* service.reconcileSystemInstallations();
		expect(healthUpdates).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ healthUpdates, privateInstallations })));
});

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
			compiledScripts: [],
			pluginSlug: privatePlugin.slug,
			manifest: privateManifest({ metadata: { ...privateManifest().metadata, version: "2.0.0" } }),
		});
		expect(result).toEqual({ id: installation.id, pluginId: privatePlugin.id });
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
		const loader = yield* LoadedSystemPlugins;
		const service = yield* PluginInstallationService;
		loader.load(
			systemEntry(
				privateManifest({ metadata: { ...privateManifest().metadata, slug: privatePlugin.slug } }),
			),
		);
		const removed = yield* service.uninstallPlugin(userId, privatePlugin.slug);
		expect(removed).toEqual({ id: installations[0]?.id, pluginId: privatePlugin.id });
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
