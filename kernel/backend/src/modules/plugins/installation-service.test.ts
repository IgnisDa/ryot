import { assert, expect, layer } from "@effect/vitest";
import { DbError, badRequest, internalError } from "@ryot-app/contract/errors";
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
import { Cause, Context, Effect, Exit, Layer, Option, Ref, Stream } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { databaseLayer } from "#lib/test-utils/effect";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginIngestionRetirement } from "./ingestion-retirement";
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
	activationId: `${manifest.metadata.slug}-activation`,
});

const installationRow = (
	overrides: Partial<PluginInstallationHydratedState> & { pluginId: string },
): PluginInstallationHydratedState => ({
	userId,
	config: {},
	sortOrder: 0,
	health: "ready",
	isHidden: false,
	userSettings: {},
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

type PersistedPlugin = {
	readonly plugin: StoredPlugin["manifest"];
	readonly identity: Record<string, unknown>;
};

type Recordings = {
	readonly retirementEvents: ReadonlyArray<string>;
	readonly removed: ReadonlyArray<string>;
	readonly dispatched: ReadonlyArray<string>;
	readonly deactivated: ReadonlyArray<string>;
	readonly invalidatedAll: ReadonlyArray<void>;
	readonly deletedUploads: ReadonlyArray<string>;
	readonly homeViewEvents: ReadonlyArray<string>;
	readonly savedViewFences: ReadonlyArray<unknown>;
	readonly invalidatedUsers: ReadonlyArray<UserId>;
	readonly integrationFences: ReadonlyArray<unknown>;
	readonly persisted: ReadonlyArray<PersistedPlugin>;
	readonly created: ReadonlyArray<Record<string, unknown>>;
	readonly updated: ReadonlyArray<Record<string, unknown>>;
	readonly healthUpdates: ReadonlyArray<Record<string, unknown>>;
	readonly claimedUploads: ReadonlyArray<Record<string, unknown>>;
	readonly homeViewUpdates: ReadonlyArray<Record<string, unknown>>;
	readonly homeViewTransactionScopes: ReadonlyArray<"root" | "transaction">;
};

const emptyRecordings: Recordings = {
	removed: [],
	created: [],
	updated: [],
	persisted: [],
	dispatched: [],
	deactivated: [],
	healthUpdates: [],
	invalidatedAll: [],
	deletedUploads: [],
	homeViewEvents: [],
	claimedUploads: [],
	savedViewFences: [],
	homeViewUpdates: [],
	retirementEvents: [],
	invalidatedUsers: [],
	integrationFences: [],
	homeViewTransactionScopes: [],
};

class FakeInstallationDependencies extends Context.Service<
	FakeInstallationDependencies,
	{ readonly [Key in keyof Recordings]: Effect.Effect<Recordings[Key]> } & {
		readonly loadSystemPlugin: (plugin: StoredPlugin) => Effect.Effect<void>;
	}
>()("test/FakeInstallationDependencies") {}

class InstallationFakeState extends Context.Service<
	InstallationFakeState,
	{
		readonly recordings: Ref.Ref<Recordings>;
		readonly receipts: Ref.Ref<
			ReadonlyArray<{
				activationId: string;
				ownerId: string | null;
				slug: string;
				pluginId: string;
				installationId: string | null;
			}>
		>;
		readonly systemPlugins: Ref.Ref<ReadonlyArray<StoredPlugin>>;
		readonly systemSlugsAddedOnLock: Ref.Ref<ReadonlyArray<string>>;
	}
>()("test/InstallationFakeState") {}

type FakeInstallationOptions = {
	readonly cleanupFailsOnce?: boolean;
	readonly dispatchFails?: boolean;
	readonly archiveBytes?: Uint8Array;
	readonly openUploadFails?: boolean;
	readonly claimUploadFails?: boolean;
	readonly deleteUploadFails?: boolean;
	readonly missingUpdateState?: boolean;
	readonly hasEntityReferences?: boolean;
	readonly hasWorkflowReferences?: boolean;
	readonly hasSavedViewReferences?: boolean;
	readonly hasDefinitionReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly pendingLifecycle?: ReadonlyArray<string>;
	readonly dispatchFailsFor?: ReadonlyArray<string>;
	readonly systemSlugAddedOnLock?: string;
	readonly systemPlugins?: ReadonlyArray<StoredPlugin>;
	readonly privatePlugins?: ReadonlyArray<StoredPlugin>;
	readonly installations?: ReadonlyArray<PluginInstallationHydratedState>;
	readonly homeTargets?: ReadonlyMap<string, NonNullable<HomeSavedView>>;
	readonly privateInstallations?: ReadonlyArray<PluginPrivateInstallationRow>;
};

const record = <Key extends keyof Recordings>(
	recordings: Ref.Ref<Recordings>,
	key: Key,
	value: Recordings[Key][number],
) => Ref.update(recordings, (current) => ({ ...current, [key]: [...current[key], value] }));

const makeLayer = (options: FakeInstallationOptions = {}) => {
	let cleanupInterrupted = false;
	const installations = options.installations ?? [];
	const privatePlugins = options.privatePlugins ?? [];
	const applyStateUpdate = (
		values: Parameters<PluginInstallationRepository["Service"]["updateState"]>[0],
	) => {
		const current = installations.find((row) => row.id === values.id);
		if (!current || options.missingUpdateState) {
			return undefined;
		}
		const needsConfiguration = current.health === "needs-configuration";
		return {
			...current,
			...values,
			healthReason: needsConfiguration ? null : current.healthReason,
			health: needsConfiguration ? ("ready" as const) : current.health,
		};
	};
	const stateLayer = Layer.effect(
		InstallationFakeState,
		Effect.gen(function* () {
			return {
				recordings: yield* Ref.make(emptyRecordings),
				systemSlugsAddedOnLock: yield* Ref.make<ReadonlyArray<string>>([]),
				systemPlugins: yield* Ref.make<ReadonlyArray<StoredPlugin>>(options.systemPlugins ?? []),
				receipts: yield* Ref.make<
					ReadonlyArray<{
						activationId: string;
						ownerId: string | null;
						slug: string;
						pluginId: string;
						installationId: string | null;
					}>
				>([]),
			};
		}),
	);
	const inspectionLayer = Layer.effect(
		FakeInstallationDependencies,
		Effect.gen(function* () {
			const { recordings, systemPlugins } = yield* InstallationFakeState;
			const read = <Key extends keyof Recordings>(key: Key) =>
				Effect.map(Ref.get(recordings), (current) => current[key]);
			return {
				removed: read("removed"),
				created: read("created"),
				updated: read("updated"),
				persisted: read("persisted"),
				dispatched: read("dispatched"),
				deactivated: read("deactivated"),
				healthUpdates: read("healthUpdates"),
				invalidatedAll: read("invalidatedAll"),
				deletedUploads: read("deletedUploads"),
				homeViewEvents: read("homeViewEvents"),
				claimedUploads: read("claimedUploads"),
				savedViewFences: read("savedViewFences"),
				homeViewUpdates: read("homeViewUpdates"),
				retirementEvents: read("retirementEvents"),
				invalidatedUsers: read("invalidatedUsers"),
				integrationFences: read("integrationFences"),
				homeViewTransactionScopes: read("homeViewTransactionScopes"),
				loadSystemPlugin: (plugin) =>
					Ref.update(systemPlugins, (current) => {
						const index = current.findIndex(({ slug }) => slug === plugin.slug);
						return index === -1
							? [...current, plugin]
							: current.map((existing, position) => (position === index ? plugin : existing));
					}),
			};
		}),
	);
	const dependenciesLayer = Layer.unwrap(
		Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const { receipts, recordings, systemPlugins, systemSlugsAddedOnLock } =
				yield* InstallationFakeState;
			const transactionScope = Effect.map(database.isTransactionActive, (active) =>
				active ? ("transaction" as const) : ("root" as const),
			);
			return Layer.mergeAll(
				Layer.succeed(PluginIngestionRetirement, {
					retire: (input) =>
						Effect.gen(function* () {
							yield* Effect.flatMap(transactionScope, (scope) =>
								record(
									recordings,
									"retirementEvents",
									`cleanup:${input.pluginInstallationId}:${scope}`,
								),
							);
							if (options.cleanupFailsOnce && !cleanupInterrupted) {
								cleanupInterrupted = true;
								return yield* new DbError({ message: "Cleanup interrupted" });
							}
							return yield* Effect.void;
						}),
				}),
				Layer.mock(DefinitionRepository)({
					getGlobalSnapshot: Effect.map(Ref.get(systemPlugins), (plugins) =>
						validateSystemPluginSet(kernelDefinitionSource(), [...plugins]),
					),
				}),
				Layer.succeed(PluginCatalogInvalidator, {
					recordAll: Effect.void,
					recordUser: () => Effect.void,
					deliverPending: () => Effect.void,
					all: record(recordings, "invalidatedAll", undefined),
					user: (ownerId) => record(recordings, "invalidatedUsers", ownerId),
				}),
				Layer.mock(PluginRepository)({
					listPrivateForUser: () => Effect.succeed([...privatePlugins]),
					deactivate: (pluginId) => record(recordings, "deactivated", pluginId),
					hasEntityReferences: () => Effect.succeed(options.hasEntityReferences ?? false),
					hasDefinitionReferences: () => Effect.succeed(options.hasDefinitionReferences ?? false),
					listActiveSystemPlugins: () =>
						Effect.map(Ref.get(systemPlugins), (plugins) => [...plugins]),
					hasIntegrationReferences: (fence) =>
						record(recordings, "integrationFences", fence).pipe(
							Effect.as(options.hasIntegrationReferences ?? false),
						),
					findActiveSystemPlugin: (slug) =>
						Effect.map(
							Ref.get(systemPlugins),
							(plugins) => plugins.find((plugin) => plugin.slug === slug) ?? null,
						),
					persist: (plugin, identity) =>
						record(recordings, "persisted", { identity, plugin: plugin.manifest }).pipe(
							Effect.as(`${identity.slug}-plugin-id`),
						),
					findUninstallReceipt: (activationId) =>
						Effect.map(
							Ref.get(receipts),
							(all) => all.find((receipt) => receipt.activationId === activationId) ?? null,
						),
					lockIngestion: () => {
						const slug = options.systemSlugAddedOnLock;
						return slug === undefined
							? Effect.void
							: Ref.update(systemSlugsAddedOnLock, (slugs) => [...slugs, slug]);
					},
					listActiveSystemSlugs: () =>
						Effect.gen(function* () {
							const plugins = yield* Ref.get(systemPlugins);
							return [
								...plugins.map(({ slug }) => slug),
								...(yield* Ref.get(systemSlugsAddedOnLock)),
							];
						}),
					recordUninstallReceipt: (receipt) =>
						Ref.update(receipts, (all) => [
							...all,
							{
								slug: receipt.slug,
								pluginId: receipt.pluginId,
								ownerId: receipt.ownerId ?? null,
								activationId: receipt.activationId,
								installationId: receipt.installationId ?? null,
							},
						]),
					findPrivateByIdForUser: (pluginId) =>
						Effect.map(Ref.get(recordings), ({ persisted }) => {
							const saved = persisted.find(
								({ plugin }) => `${plugin.metadata.slug}-plugin-id` === pluginId,
							);
							return (
								privatePlugins.find(({ id }) => id === pluginId) ??
								(saved ? storedPrivatePlugin(saved.plugin) : null)
							);
						}),
				}),
				Layer.mock(PluginInstallationRepository)({
					assertIngestionActive: () => Effect.void,
					refreshClientConfigsForPlugin: () => Effect.void,
					listForUser: () => Effect.succeed([...installations]),
					provisionSystemInstallationsForAllUsers: () => Effect.void,
					updateHealth: (values) => record(recordings, "healthUpdates", values),
					listPrivateInstallations: () => Effect.succeed([...(options.privateInstallations ?? [])]),
					updateState: (values) =>
						record(recordings, "updated", values).pipe(Effect.as(applyStateUpdate(values))),
					findByUserAndPlugin: (_user, pluginId) =>
						Effect.succeed(installations.find((row) => row.pluginId === pluginId) ?? null),
					upsertState: (values) =>
						record(recordings, "created", values).pipe(
							Effect.as(installationRow({ ...values, pluginId: values.pluginId })),
						),
					beginIngestionRetirement: (_owner, id) =>
						Effect.flatMap(transactionScope, (scope) =>
							record(recordings, "retirementEvents", `fence:${id}:${scope}`),
						),
					remove: (id) =>
						Effect.flatMap(transactionScope, (scope) =>
							record(recordings, "retirementEvents", `remove:${id}:${scope}`),
						).pipe(Effect.andThen(record(recordings, "removed", id))),
					listPendingLifecycle: () =>
						Effect.succeed(
							(options.pendingLifecycle ?? []).map((installationId) => ({
								installationId,
								activationId: "private-fixture-activation",
							})),
						),
					findHomeSavedView: (_ownerId, savedViewSlug) =>
						Effect.gen(function* () {
							yield* record(recordings, "homeViewTransactionScopes", yield* transactionScope);
							yield* record(recordings, "homeViewEvents", "lock-saved-view");
							return options.homeTargets?.get(savedViewSlug) ?? null;
						}),
					setHomeSavedView: (ownerId, id, homeSavedViewSlug) =>
						Effect.gen(function* () {
							yield* record(recordings, "homeViewTransactionScopes", yield* transactionScope);
							yield* record(recordings, "homeViewEvents", "set-installation");
							yield* record(recordings, "homeViewUpdates", {
								id,
								userId: ownerId,
								homeSavedViewSlug,
							});
							return installations.some((row) => row.id === id && row.userId === ownerId);
						}),
				}),
				Layer.succeed(PluginInstallationLifecycleDispatcher, {
					dispatch: ({ installationId }) =>
						record(recordings, "dispatched", installationId).pipe(
							Effect.andThen(
								options.dispatchFails || options.dispatchFailsFor?.includes(installationId)
									? internalError("queue unavailable")
									: Effect.void,
							),
						),
				}),
				Layer.mock(SandboxWorkflowReferenceRepository)({
					hasInstallationReferences: () => Effect.succeed(options.hasWorkflowReferences ?? false),
				}),
				Layer.succeed(PluginSavedViewReferences, {
					hasCustomSavedViewReferences: (ownerId, installationId) =>
						record(recordings, "savedViewFences", { installationId, userId: ownerId }).pipe(
							Effect.as(options.hasSavedViewReferences ?? false),
						),
				}),
				Layer.mock(UploadIntentsService)({
					deleteTemporaryUpload: (intentId) =>
						record(recordings, "deletedUploads", intentId).pipe(
							Effect.andThen(
								options.deleteUploadFails
									? Effect.fail(new UploadBadRequest({ reason: { intentId, code: "intent-busy" } }))
									: Effect.void.pipe(Effect.as(undefined)),
							),
						),
					claimTemporaryUpload: (token, ownerId, claimId) =>
						record(recordings, "claimedUploads", { token, claimId, userId: ownerId }).pipe(
							Effect.andThen(
								options.claimUploadFails
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
				}),
				Layer.mock(ObjectStorageService)({
					openObject: () =>
						options.openUploadFails
							? Effect.fail(badRequest("Plugin upload object is unavailable"))
							: Effect.succeed(Stream.make(options.archiveBytes ?? new Uint8Array())),
				}),
			);
		}),
	);
	const ingestionLockLayer = PluginIngestionLock.layer.pipe(
		Layer.provide(Layer.succeed(PluginRevisionActivation, { activated: () => Effect.void })),
	);
	return PluginInstallationService.layer.pipe(
		Layer.provide(ingestionLockLayer),
		Layer.provideMerge(dependenciesLayer),
		Layer.provideMerge(inspectionLayer),
		Layer.provideMerge(stateLayer),
		Layer.provideMerge(databaseLayer),
	);
};

const bootstrapScript = {
	capabilities: [],
	kind: "script" as const,
	oauthConnectionFields: [],
	name: "Fixture Bootstrap",
	executableDependencies: [],
	requiredPluginConfigKeys: [],
	optionalPluginConfigKeys: [],
	slug: "script.fixture-bootstrap",
	entry: "backend/bootstrap/bootstrap.sandbox.ts",
};

const bootstrapScriptSource = `import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	name: "Fixture Bootstrap",
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
	activationId: `${manifest.metadata.slug}-activation`,
});

layer(
	makeLayer({
		deleteUploadFails: true,
		archiveBytes: writePluginArchive({ files: {}, manifest: privateManifest() }),
	}),
)((test) => {
	test.effect("claims, reads, and best-effort deletes an uploaded plugin archive", () => {
		const token = "plugin-upload-token";
		return Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const installed = yield* service.installPrivatePlugin({
				userId,
				config: {},
				uploadToken: token,
			});
			expect(installed).toEqual({
				pluginId: "private-fixture-plugin-id",
				activationId: "private-fixture-activation",
				id: "private-fixture-plugin-id-installation",
			});
			expect(yield* fake.claimedUploads).toEqual([
				{ token, userId, claimId: `plugin-package:${sha256Hex(token)}` },
			]);
			expect(yield* fake.deletedUploads).toEqual(["plugin-upload-intent"]);
		});
	});
});

layer(makeLayer({ claimUploadFails: true }))((test) => {
	test.effect("maps an unavailable upload claim without attempting cleanup", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const exit = yield* Effect.exit(
				service.installPrivatePlugin({ userId, config: {}, uploadToken: "missing" }),
			);
			const failure = failureOf(exit);
			assert(failure instanceof PluginRequestError);
			expect(failure.reason).toEqual({ code: "upload-unavailable" });
			expect(yield* fake.deletedUploads).toEqual([]);
		}),
	);
});

layer(makeLayer({ archiveBytes: new Uint8Array([1, 2, 3]) }))((test) => {
	test.effect("maps an invalid archive and deletes the claimed upload", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const exit = yield* Effect.exit(
				service.installPrivatePlugin({ userId, config: {}, uploadToken: "corrupt" }),
			);
			const failure = failureOf(exit);
			assert(failure instanceof PluginRequestError);
			expect(failure.reason).toEqual({ issue: "malformed-zip", code: "package-archive-invalid" });
			expect(yield* fake.deletedUploads).toEqual(["plugin-upload-intent"]);
		}),
	);
});

layer(makeLayer({ openUploadFails: true }))((test) => {
	test.effect("maps an unavailable archive object and deletes the claimed upload", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const exit = yield* Effect.exit(
				service.installPrivatePlugin({ userId, config: {}, uploadToken: "missing-object" }),
			);
			const failure = failureOf(exit);
			assert(failure instanceof PluginRequestError);
			expect(failure.reason).toEqual({ code: "upload-unavailable" });
			expect(yield* fake.deletedUploads).toEqual(["plugin-upload-intent"]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("checks update ownership before claiming the upload", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
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
			expect(yield* fake.claimedUploads).toEqual([]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects an oversized package before persistence", () => {
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
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("rejects only the private manifest surfaces that cannot carry user subject", () =>
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
			const files = Object.fromEntries(
				manifest.scripts.map(({ entry }) => [entry, bytes("source")]),
			);
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
			expect([...failure.reason.surfaces].sort((left, right) => left.localeCompare(right))).toEqual(
				["httpRateLimits", "userBootstrap"],
			);
		}),
	);
});

layer(
	makeLayer({
		systemPlugins: [
			systemEntry(
				privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
			),
		],
	}),
)((test) => {
	test.effect("reserves slugs owned by active system plugins", () =>
		Effect.gen(function* () {
			const service = yield* PluginInstallationService;
			const exit = yield* Effect.exit(
				service.installPrivatePlugin({
					userId,
					files: {},
					config: {},
					compiledScripts: [],
					manifest: privateManifest({
						metadata: { ...privateManifest().metadata, slug: "example" },
					}),
				}),
			);
			const failure = failureOf(exit);
			assert(failure instanceof PluginRequestError);
			expect(failure.reason).toEqual({ code: "slug-reserved", pluginSlug: "example" });
		}),
	);
});

layer(makeLayer({ systemSlugAddedOnLock: privateManifest().metadata.slug }))((test) => {
	test.effect("rejects persistence when a system slug appears after install preparation", () => {
		const manifest = privateManifest();
		return Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
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
			expect(yield* fake.persisted).toEqual([]);
		});
	});
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

layer(makeLayer())((test) => {
	test.effect("applies config defaults and persists validated config", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const installed = yield* service.installPrivatePlugin({
				userId,
				files: {},
				compiledScripts: [],
				manifest: configuredManifest,
				config: { token: "secret-value" },
			});
			expect((yield* fake.created)[0]).toMatchObject({
				isHidden: false,
				health: "installing",
				config: { region: "eu", token: "secret-value" },
			});
			expect(installed).toEqual({
				pluginId: "private-fixture-plugin-id",
				activationId: "private-fixture-activation",
				id: "private-fixture-plugin-id-installation",
			});
			expect(yield* fake.invalidatedUsers).toEqual([userId]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects config missing a required value before persisting", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
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
			expect(yield* fake.created).toEqual([]);
		}),
	);
});

const privatePlugin = storedPrivatePlugin(privateManifest());
const privateInstallation = installationRow({ pluginId: privatePlugin.id });

layer(makeLayer({ privatePlugins: [privatePlugin] }))((test) => {
	test.effect("refuses a second private plugin with the same slug", () =>
		Effect.gen(function* () {
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
		}),
	);
});

const globalHomeViewSlug = "global-view";

layer(
	makeLayer({
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
		homeTargets: new Map<string, NonNullable<HomeSavedView>>([
			[
				globalHomeViewSlug,
				{ view: { isHidden: false, renderer: { kind: "kernel", name: "entity-browser" } } },
			],
		]),
	}),
)((test) => {
	test.effect("sets and clears a usable home view without requiring workspace placement", () => {
		const savedViewSlug = globalHomeViewSlug;
		return Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			expect(yield* service.setHomeView(userId, privatePlugin.slug, { savedViewSlug })).toEqual({
				savedViewSlug,
			});
			expect(
				yield* service.setHomeView(userId, privatePlugin.slug, { savedViewSlug: null }),
			).toEqual({ savedViewSlug: null });
			expect(yield* fake.homeViewUpdates).toEqual([
				{ userId, id: privateInstallation.id, homeSavedViewSlug: savedViewSlug },
				{ userId, homeSavedViewSlug: null, id: privateInstallation.id },
			]);
			expect(yield* fake.invalidatedUsers).toEqual([userId, userId]);
			expect(yield* fake.homeViewEvents).toEqual([
				"lock-saved-view",
				"set-installation",
				"set-installation",
			]);
			expect(yield* fake.homeViewTransactionScopes).toEqual([
				"transaction",
				"transaction",
				"transaction",
			]);
		});
	});
});

const pageHomeViewSlug = "plugin-view";
const pagePlugin = storedPrivatePlugin(
	privateManifest({
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
	}),
);

layer(
	makeLayer({
		privatePlugins: [pagePlugin],
		installations: [installationRow({ pluginId: pagePlugin.id })],
		homeTargets: new Map([
			[
				pageHomeViewSlug,
				{
					view: {
						isHidden: false,
						renderer: { kind: "plugin", exportName: "summary", pluginId: pagePlugin.id },
					},
				},
			],
		]),
	}),
)((test) => {
	test.effect("accepts a home view backed by an advertised plugin page", () => {
		const savedViewSlug = pageHomeViewSlug;
		return Effect.gen(function* () {
			const service = yield* PluginInstallationService;
			expect(yield* service.setHomeView(userId, pagePlugin.slug, { savedViewSlug })).toEqual({
				savedViewSlug,
			});
		});
	});
});

const hiddenHomeViewSlug = "hidden-view";
const unavailableHomeViewSlug = "unavailable-view";
const missingHomeViewSlug = "missing-view";

layer(
	makeLayer({
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
		homeTargets: new Map<string, NonNullable<HomeSavedView>>([
			[
				hiddenHomeViewSlug,
				{ view: { isHidden: true, renderer: { kind: "kernel", name: "entity-browser" } } },
			],
			[
				unavailableHomeViewSlug,
				{
					view: {
						isHidden: false,
						renderer: { kind: "plugin", exportName: "missing", pluginId: privatePlugin.id },
					},
				},
			],
		]),
	}),
)((test) => {
	test.effect("rejects missing, hidden, and unusable home views", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			for (const [savedViewSlug, code] of [
				[missingHomeViewSlug, "home-view-not-found"],
				[hiddenHomeViewSlug, "home-view-hidden"],
				[unavailableHomeViewSlug, "home-view-renderer-unavailable"],
			] as const) {
				expect(
					failureOf(
						yield* Effect.exit(service.setHomeView(userId, privatePlugin.slug, { savedViewSlug })),
					),
				).toMatchObject({ _tag: "PluginRequestError", reason: { code, savedViewSlug } });
			}
			expect(yield* fake.homeViewUpdates).toEqual([]);
		}),
	);
});

const configuredPlugin = storedPrivatePlugin(configuredManifest);
const configuredInstallation = installationRow({
	pluginId: configuredPlugin.id,
	config: { region: "us", token: "stored-secret" },
});

layer(makeLayer({ privatePlugins: [configuredPlugin], installations: [configuredInstallation] }))(
	(test) => {
		test.effect(
			"patches config while preserving omitted secrets and returning a safe response",
			() =>
				Effect.gen(function* () {
					const fake = yield* FakeInstallationDependencies;
					const service = yield* PluginInstallationService;
					const result = yield* service.updateInstallation(userId, configuredPlugin.slug, {
						sortOrder: 7,
						config: { region: "ca" },
					});

					expect((yield* fake.updated)[0]).toMatchObject({
						sortOrder: 7,
						config: { region: "ca", token: "stored-secret" },
					});
					expect(result).toEqual({
						pluginId: configuredPlugin.id,
						id: "private-fixture-plugin-id-installation",
					});
				}),
		);
	},
);

layer(
	makeLayer({
		missingUpdateState: true,
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
	}),
)((test) => {
	test.effect("rejects an update when the installation write affects no row", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
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
				expect(failure.reason).toEqual({
					code: "plugin-not-found",
					pluginSlug: privatePlugin.slug,
				});
			}
			expect(yield* fake.invalidatedUsers).toEqual([]);
		}),
	);
});

layer(makeLayer({ privatePlugins: [configuredPlugin], installations: [configuredInstallation] }))(
	(test) => {
		test.effect("applies defaults after explicit unsets and rejects removing required config", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				const reset = yield* service.updateInstallation(userId, configuredPlugin.slug, {
					unsetConfigKeys: ["region"],
				});
				expect((yield* fake.updated)[0]).toMatchObject({
					config: { region: "eu", token: "stored-secret" },
				});
				expect(reset).toEqual({ id: configuredInstallation.id, pluginId: configuredPlugin.id });

				const failure = failureOf(
					yield* Effect.exit(
						service.updateInstallation(userId, configuredPlugin.slug, {
							unsetConfigKeys: ["token"],
						}),
					),
				);
				expect(failure).toMatchObject({
					_tag: "PluginRequestError",
					reason: { code: "validation-failed" },
				});
				expect(yield* fake.updated).toHaveLength(1);
			}),
		);
	},
);

const exampleSystemPlugin = systemEntry(
	privateManifest({ metadata: { ...privateManifest().metadata, slug: "example" } }),
);
const exampleSystemInstallation = installationRow({
	pluginScope: "system",
	pluginSlug: "example",
	pluginId: exampleSystemPlugin.id,
});

layer(makeLayer({ installations: [exampleSystemInstallation] }))((test) => {
	test.effect("allows system controls but rejects system config changes", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* fake.loadSystemPlugin(exampleSystemPlugin);

			expect(
				yield* service.updateInstallation(userId, "example", { sortOrder: 4, isHidden: true }),
			).toEqual({ id: exampleSystemInstallation.id, pluginId: exampleSystemPlugin.id });
			expect(
				failureOf(
					yield* Effect.exit(service.updateInstallation(userId, "example", { config: {} })),
				),
			).toMatchObject({
				_tag: "PluginConflictError",
				reason: { code: "system-plugin", pluginSlug: "example" },
			});
			expect(yield* fake.invalidatedUsers).toEqual([userId]);
		}),
	);
});

layer(
	makeLayer({
		privatePlugins: [configuredPlugin],
		installations: [
			installationRow({
				isHidden: true,
				health: "installing",
				pluginId: configuredPlugin.id,
				config: { region: "eu", token: "stored-secret" },
			}),
		],
	}),
)((test) => {
	test.effect("hides foreign installations and rejects enabling an unready installation", () =>
		Effect.gen(function* () {
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
						service.updateInstallation(userId, configuredPlugin.slug, { isHidden: false }),
					),
				),
			).toMatchObject({
				_tag: "PluginConflictError",
				reason: { health: "installing", code: "installation-not-ready" },
			});
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("refuses to uninstall a system plugin through the private path", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* fake.loadSystemPlugin(exampleSystemPlugin);
			const failure = failureOf(
				yield* Effect.exit(service.uninstallPlugin(userId, "example", "example-activation")),
			);
			assert(failure instanceof PluginConflictError);
			expect(failure.reason).toEqual({ code: "system-plugin", pluginSlug: "example" });
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("hides private plugins owned by another user", () =>
		Effect.gen(function* () {
			const service = yield* PluginInstallationService;
			const failure = failureOf(
				yield* Effect.exit(
					service.uninstallPlugin(userId, "someone-elses-plugin", "unknown-activation"),
				),
			);
			expect(failure).toMatchObject({
				_tag: "PluginNotFoundError",
				reason: { code: "plugin-not-found", pluginSlug: "someone-elses-plugin" },
			});
		}),
	);
});

layer(makeLayer({ privatePlugins: [privatePlugin], installations: [privateInstallation] }))(
	(test) => {
		test.effect("uninstalls a private plugin the caller owns", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				const removed = yield* service.uninstallPlugin(
					userId,
					privatePlugin.slug,
					privatePlugin.activationId,
				);
				expect(removed).toEqual({ id: privateInstallation.id, pluginId: privatePlugin.id });
				expect(yield* fake.deactivated).toEqual([privatePlugin.id]);
				expect(yield* fake.removed).toEqual([privateInstallation.id]);
				expect(yield* fake.invalidatedUsers).toEqual([userId]);
			}),
		);
		test.effect("replays a committed private uninstall without repeating the write", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				const first = yield* service.uninstallPlugin(
					userId,
					privatePlugin.slug,
					privatePlugin.activationId,
				);
				expect(
					yield* service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId),
				).toEqual(first);
				expect(yield* fake.removed).toEqual([privateInstallation.id]);
				expect(yield* fake.deactivated).toEqual([privatePlugin.id]);
				expect(yield* fake.retirementEvents).toEqual([
					`fence:${privateInstallation.id}:transaction`,
					`cleanup:${privateInstallation.id}:root`,
					`remove:${privateInstallation.id}:transaction`,
				]);
			}),
		);
	},
);

layer(
	makeLayer({
		hasIntegrationReferences: true,
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
	}),
)((test) => {
	test.effect("fences a private uninstall on the exact installation being removed", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const failure = failureOf(
				yield* Effect.exit(
					service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId),
				),
			);
			assert(failure instanceof PluginConflictError);
			expect(failure.reason.code).toBe("integration-referenced");
			expect(yield* fake.integrationFences).toEqual([
				{ pluginId: privatePlugin.id, pluginInstallationId: privateInstallation.id },
			]);
			expect(yield* fake.deactivated).toEqual([]);
		}),
	);
});

layer(
	makeLayer({
		hasDefinitionReferences: true,
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
	}),
)((test) => {
	test.effect("keeps a private plugin referenced by persisted definitions", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const failure = failureOf(
				yield* Effect.exit(
					service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId),
				),
			);
			assert(failure instanceof PluginConflictError);
			expect(failure.reason.code).toBe("entity-referenced");
			expect(yield* fake.deactivated).toEqual([]);
		}),
	);
});

layer(
	makeLayer({
		hasWorkflowReferences: true,
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
	}),
)((test) => {
	test.effect("tombstones a private installation while accepted workflows retain their pins", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			expect(
				yield* service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId),
			).toEqual({ id: privateInstallation.id, pluginId: privatePlugin.id });
			expect(yield* fake.deactivated).toEqual([privatePlugin.id]);
		}),
	);
});

layer(
	makeLayer({
		hasSavedViewReferences: true,
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
	}),
)((test) => {
	test.effect("keeps a private plugin with custom views installed", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const failure = failureOf(
				yield* Effect.exit(
					service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId),
				),
			);
			assert(failure instanceof PluginConflictError);
			expect(failure.reason.code).toBe("saved-view-referenced");
			expect(yield* fake.savedViewFences).toEqual([
				{ userId, installationId: privateInstallation.id },
			]);
			expect(yield* fake.deactivated).toEqual([]);
		}),
	);
});

const operationScript = {
	capabilities: [],
	name: "Fixture Operation",
	slug: "operation.fixture",
	oauthConnectionFields: [],
	kind: "operation" as const,
	executableDependencies: [],
	requiredPluginConfigKeys: [],
	optionalPluginConfigKeys: [],
	entry: "backend/operations/operation.sandbox.ts",
};

const operationScriptSource = `import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

export const manifest = defineManifest({
	kind: "operation",
	name: "Fixture Operation",
	slug: "operation.fixture",
});

export default defineOperation({
	manifest,
	output: Schema.Null,
	input: Schema.Unknown,
	run: () => Effect.succeed(null),
});
`;

const upgradedOperationManifest: PluginManifest = {
	...configuredManifest,
	scripts: [operationScript],
	metadata: { ...configuredManifest.metadata, version: "2.0.0" },
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
const upgradedOperationPlugin = storedPrivatePlugin({
	...upgradedOperationManifest,
	metadata: configuredManifest.metadata,
});
const upgradedOperationInstallation = installationRow({
	pluginId: upgradedOperationPlugin.id,
	config: { region: "us", token: "stored-secret" },
});

layer(
	makeLayer({
		privatePlugins: [upgradedOperationPlugin],
		installations: [upgradedOperationInstallation],
	}),
)((test) => {
	test.effect(
		"updates source while retaining plugin, installation, and omitted secret config",
		() => {
			const nextManifest = upgradedOperationManifest;
			const installation = upgradedOperationInstallation;
			return Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				const result = yield* service.updatePrivatePlugin({
					userId,
					manifest: nextManifest,
					config: { region: "ca" },
					pluginSlug: upgradedOperationPlugin.slug,
					files: { [operationScript.entry]: bytes(operationScriptSource) },
					compiledScripts: compiledScriptsFor(nextManifest, {
						[operationScript.entry]: bytes(operationScriptSource),
					}),
				});

				const persisted = yield* fake.persisted;
				expect(persisted).toHaveLength(1);
				expect(persisted[0]).toMatchObject({
					plugin: { metadata: { version: "2.0.0" } },
					identity: { scope: "user", ownerId: userId, slug: upgradedOperationPlugin.slug },
				});
				expect((yield* fake.updated)[0]).toMatchObject({
					id: installation.id,
					config: { region: "ca", token: "stored-secret" },
				});
				expect(result).toEqual({ id: installation.id, pluginId: upgradedOperationPlugin.id });
				expect(yield* fake.invalidatedUsers).toEqual([userId]);
			});
		},
	);
});

layer(makeLayer({ privatePlugins: [configuredPlugin], installations: [configuredInstallation] }))(
	(test) => {
		test.effect("rejects changed identity but activates an upgrade needing configuration", () => {
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
			return Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				const changedSlug = failureOf(
					yield* Effect.exit(
						service.updatePrivatePlugin({
							userId,
							files: {},
							compiledScripts: [],
							pluginSlug: configuredPlugin.slug,
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
				expect(yield* fake.persisted).toEqual([]);

				const invalidConfig = yield* service.updatePrivatePlugin({
					userId,
					files: {},
					compiledScripts: [],
					manifest: nextManifest,
					pluginSlug: configuredPlugin.slug,
				});
				expect(invalidConfig).toEqual({
					id: configuredInstallation.id,
					pluginId: configuredPlugin.id,
				});
				expect((yield* fake.persisted).map(({ plugin }) => plugin)).toEqual([nextManifest]);
				expect(yield* fake.healthUpdates).toEqual([
					{
						id: configuredInstallation.id,
						health: "needs-configuration",
						healthReason: "Configuration does not match the active package revision",
					},
				]);
				expect(yield* fake.updated).toEqual([]);
			});
		});
	},
);

const unconfiguredInstallation = installationRow({
	isHidden: true,
	config: { region: "us" },
	pluginId: configuredPlugin.id,
	health: "needs-configuration",
});

layer(
	makeLayer({
		cleanupFailsOnce: true,
		privatePlugins: [privatePlugin],
		installations: [privateInstallation],
	}),
)((test) => {
	test.effect(
		"retries interrupted installation cleanup before recording uninstall or removing the owner",
		() =>
			Effect.gen(function* () {
				const service = yield* PluginInstallationService;
				const fake = yield* FakeInstallationDependencies;
				expect(
					(yield* Effect.exit(
						service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId),
					))._tag,
				).toBe("Failure");
				expect(yield* fake.removed).toEqual([]);
				expect(yield* fake.deactivated).toEqual([]);
				yield* service.uninstallPlugin(userId, privatePlugin.slug, privatePlugin.activationId);
				expect(yield* fake.retirementEvents).toEqual([
					`fence:${privateInstallation.id}:transaction`,
					`cleanup:${privateInstallation.id}:root`,
					`fence:${privateInstallation.id}:transaction`,
					`cleanup:${privateInstallation.id}:root`,
					`remove:${privateInstallation.id}:transaction`,
				]);
			}),
	);
});

layer(makeLayer({ privatePlugins: [configuredPlugin], installations: [unconfiguredInstallation] }))(
	(test) => {
		test.effect("validates reconfiguration before enabling newly compatible definitions", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				expect(
					failureOf(
						yield* Effect.exit(
							service.updateInstallation(userId, configuredPlugin.slug, { isHidden: false }),
						),
					),
				).toMatchObject({ _tag: "PluginRequestError", reason: { code: "validation-failed" } });
				expect(yield* fake.updated).toEqual([]);
				const result = yield* service.updateInstallation(userId, configuredPlugin.slug, {
					isHidden: false,
					config: { token: "replacement-secret" },
				});
				expect(result).toEqual({ pluginId: configuredPlugin.id, id: unconfiguredInstallation.id });
				expect(yield* fake.updated).toEqual([
					{
						sortOrder: 0,
						isHidden: false,
						id: unconfiguredInstallation.id,
						config: { region: "us", token: "replacement-secret" },
					},
				]);
			}),
		);
	},
);

layer(makeLayer())((test) => {
	test.effect("rejects package updates for system and foreign plugins", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* fake.loadSystemPlugin(exampleSystemPlugin);

			expect(
				failureOf(
					yield* Effect.exit(
						service.updatePrivatePlugin({
							userId,
							files: {},
							compiledScripts: [],
							pluginSlug: exampleSystemPlugin.slug,
							manifest: exampleSystemPlugin.manifest,
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
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects an operation referencing an undeclared script slug", () => {
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
			const fake = yield* FakeInstallationDependencies;
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
			expect(yield* fake.created).toEqual([]);
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("rejects duplicate operation slugs before persistence", () => {
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
			const fake = yield* FakeInstallationDependencies;
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
			expect(yield* fake.created).toEqual([]);
		});
	});
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

layer(makeLayer())((test) => {
	test.effect(
		"installs a private package in installing health and dispatches its lifecycle once",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
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
					activationId: "private-fixture-activation",
					id: "private-fixture-plugin-id-installation",
				});
				const created = yield* fake.created;
				expect(created).toHaveLength(1);
				expect(created[0]).toMatchObject({ health: "installing" });
				expect(yield* fake.dispatched).toEqual(["private-fixture-plugin-id-installation"]);
			}),
	);
});

layer(
	makeLayer({ dispatchFails: true, pendingLifecycle: ["private-fixture-plugin-id-installation"] }),
)((test) => {
	test.effect("keeps a failed dispatch pending for reconciliation", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			const installed = yield* service.installPrivatePlugin({
				userId,
				config: {},
				files: operationFiles,
				manifest: operationManifest,
				compiledScripts: operationCompiledScripts,
			});
			expect(yield* fake.dispatched).toHaveLength(1);
			yield* service.dispatchPendingInstallationLifecycle();
			expect(yield* fake.dispatched).toHaveLength(2);
			expect(yield* fake.healthUpdates).toEqual([]);
			expect(installed).toEqual({
				pluginId: "private-fixture-plugin-id",
				activationId: "private-fixture-activation",
				id: "private-fixture-plugin-id-installation",
			});
		}),
	);
});

layer(makeLayer({ privatePlugins: [privatePlugin], installations: [privateInstallation] }))(
	(test) => {
		test.effect("rejects user bootstrap for a private package update", () => {
			const nextManifest = privateManifest({
				scripts: [bootstrapScript],
				userBootstrap: [userBootstrapEntry],
				metadata: { ...privateManifest().metadata, version: "2.0.0" },
			});
			const files = { [bootstrapScript.entry]: bytes(bootstrapScriptSource) };
			return Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
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
				expect(yield* fake.dispatched).toEqual([]);
			});
		});
	},
);

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

const shadowedBySlug = privateInstallationRow({ pluginSlug: "example" });

layer(
	makeLayer({
		privateInstallations: [shadowedBySlug, privateInstallationRow({ pluginSlug: "notes" })],
	}),
)((test) => {
	test.effect(
		"marks a private installation incompatible when a shipped plugin claims its slug",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				yield* fake.loadSystemPlugin(shippedEntry());
				yield* service.reconcileSystemInstallations();
				expect(yield* fake.healthUpdates).toEqual([
					{
						health: "incompatible",
						id: shadowedBySlug.installationId,
						healthReason: shippedConflict("Shipped plugins already use the slug 'example'"),
					},
				]);
				expect(yield* fake.invalidatedAll).toHaveLength(1);
				expect(yield* fake.invalidatedUsers).toEqual([userId]);
			}),
	);
});

const surfaceConflictRow = privateInstallationRow({
	pluginSlug: "notes",
	manifest: privateManifest({
		importSources: [sharedImportSource],
		metadata: { ...privateManifest().metadata, slug: "notes" },
	}),
});
const definitionConflictRow = privateInstallationRow({
	pluginSlug: "tasks",
	manifest: privateManifest({
		entitySchemas: fixtureManifest().entitySchemas,
		metadata: { ...privateManifest().metadata, slug: "tasks" },
	}),
});

layer(makeLayer({ privateInstallations: [surfaceConflictRow, definitionConflictRow] }))((test) => {
	test.effect("marks conflicts claimed on a shipped surface slug or definition slug", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* fake.loadSystemPlugin(
				shippedEntry({
					importSources: [sharedImportSource],
					entitySchemas: fixtureManifest().entitySchemas,
				}),
			);
			yield* service.reconcileSystemInstallations();
			expect(yield* fake.healthUpdates).toEqual([
				{
					health: "incompatible",
					id: surfaceConflictRow.installationId,
					healthReason: shippedConflict(
						"Duplicate import source slug 'shared-source' in effective plugins 'example' and 'notes'",
					),
				},
				{
					health: "incompatible",
					id: definitionConflictRow.installationId,
					healthReason: shippedConflict(
						"Shipped plugins already define the entity schema 'fixture-entity'",
					),
				},
			]);
		}),
	);
});

const sharedSavedView = (() => {
	const kernelView = kernelDefinitionSource().savedViews[0];
	assert(kernelView);
	assert(kernelView.renderer.kind === "kernel");
	return { ...kernelView, name: "Shared View", slug: "shared-view", renderer: kernelView.renderer };
})();
const withSharedSavedView = (slug: string) =>
	privateManifest({
		savedViews: [sharedSavedView],
		metadata: { ...privateManifest().metadata, slug },
	});
const shadowedByView = privateInstallationRow({
	pluginSlug: "notes",
	manifest: withSharedSavedView("notes"),
});

layer(
	makeLayer({
		privateInstallations: [
			shadowedByView,
			privateInstallationRow({
				health: "failed",
				pluginSlug: "tasks",
				manifest: withSharedSavedView("tasks"),
			}),
		],
	}),
)((test) => {
	test.effect(
		"marks a private installation incompatible when a shipped plugin claims its view",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				yield* fake.loadSystemPlugin(shippedEntry({ savedViews: [sharedSavedView] }));
				yield* service.reconcileSystemInstallations();
				expect(yield* fake.healthUpdates).toEqual([
					{
						health: "incompatible",
						id: shadowedByView.installationId,
						healthReason: shippedConflict(
							"Shipped plugins already define the saved view 'shared-view'",
						),
					},
				]);
			}),
	);
});

const recoveredInstallation = privateInstallationRow({
	pluginSlug: "notes",
	health: "incompatible",
	healthReason: shippedConflict("Shipped plugins already use the slug 'notes'"),
});

layer(
	makeLayer({
		privateInstallations: [
			recoveredInstallation,
			privateInstallationRow({
				pluginSlug: "tasks",
				userId: UserId.make("user-2"),
				installationId: "tasks-installation-other",
			}),
		],
	}),
)((test) => {
	test.effect("returns an incompatible installation to ready once its conflict is gone", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* service.reconcileSystemInstallations();
			expect(yield* fake.healthUpdates).toEqual([
				{ health: "ready", healthReason: null, id: recoveredInstallation.installationId },
			]);
			expect([...(yield* fake.updated), ...(yield* fake.deactivated)]).toEqual([]);
		}),
	);
});

const unchangedConflictReason = shippedConflict("Shipped plugins already use the slug 'example'");

layer(
	makeLayer({
		privateInstallations: [
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
				pluginSlug: "example",
				health: "incompatible",
				healthReason: unchangedConflictReason,
				installationId: "already-incompatible",
			}),
		],
	}),
)((test) => {
	test.effect("leaves installing, settled and unchanged-reason conflicts alone", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* fake.loadSystemPlugin(shippedEntry());
			yield* service.reconcileSystemInstallations();
			expect(yield* fake.healthUpdates).toEqual([]);
		}),
	);
});

const pendingLifecycle = ["installation-a", "installation-b", "installation-c"];

layer(makeLayer({ pendingLifecycle, dispatchFailsFor: ["installation-b"] }))((test) => {
	test.effect("dispatches every pending installation and keeps going after a failed dispatch", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationDependencies;
			const service = yield* PluginInstallationService;
			yield* service.dispatchPendingInstallationLifecycle();
			expect([...(yield* fake.dispatched)].sort()).toEqual(pendingLifecycle);
		}),
	);
});

const incompatibleInstallation = installationRow({
	health: "incompatible",
	pluginId: privatePlugin.id,
	healthReason: shippedConflict("Shipped plugins already use the slug 'private-fixture'"),
});

layer(makeLayer({ privatePlugins: [privatePlugin], installations: [incompatibleInstallation] }))(
	(test) => {
		test.effect("clears incompatible health when a private package update succeeds", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				const result = yield* service.updatePrivatePlugin({
					userId,
					files: {},
					compiledScripts: [],
					pluginSlug: privatePlugin.slug,
					manifest: privateManifest({
						metadata: { ...privateManifest().metadata, version: "2.0.0" },
					}),
				});
				expect(result).toEqual({ pluginId: privatePlugin.id, id: incompatibleInstallation.id });
				expect(yield* fake.healthUpdates).toEqual([
					{ health: "ready", healthReason: null, id: incompatibleInstallation.id },
				]);
			}),
		);
	},
);

layer(makeLayer({ privatePlugins: [privatePlugin], installations: [privateInstallation] }))(
	(test) => {
		test.effect("uninstalls a private plugin shadowed by a newly shipped slug", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationDependencies;
				const service = yield* PluginInstallationService;
				yield* fake.loadSystemPlugin(
					systemEntry(
						privateManifest({
							metadata: { ...privateManifest().metadata, slug: privatePlugin.slug },
						}),
					),
				);
				const removed = yield* service.uninstallPlugin(
					userId,
					privatePlugin.slug,
					privatePlugin.activationId,
				);
				expect(removed).toEqual({ id: privateInstallation.id, pluginId: privatePlugin.id });
				expect(yield* fake.deactivated).toEqual([privatePlugin.id]);
				expect(yield* fake.removed).toEqual([privateInstallation.id]);
			}),
		);
	},
);
