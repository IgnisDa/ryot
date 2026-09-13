#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { appConfigDefinition } from "@ryot-app/kernel-backend/lib/infrastructure/config/definition";
import { AppConfig } from "@ryot-app/kernel-backend/lib/infrastructure/config/service";
import {
	SandboxRecoveryStore,
	SandboxRecoveryStoreError,
} from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-recovery-store";
import {
	SandboxExecutionAuthority,
	SandboxExecutionPrincipal,
} from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxFileService } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/file-service";
import { SandboxHostCallGate } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/host-call-gate";
import { SandboxHostImplementations } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/host-implementations";
import { SandboxService } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/service";
import type { SandboxRunInput } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/shared";
import { SandboxSidecarAdmission } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/sidecar-admission";
import { SandboxSidecarClient } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/sidecar-client";
import { SandboxSidecarQuarantine } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/sidecar-quarantine";
import { SandboxSidecarSupervisor } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/sidecar-supervisor";
import { ServerRun } from "@ryot-app/kernel-backend/lib/infrastructure/server-run";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/sandbox-compiler/protocol";
import {
	ConfigProvider,
	Context,
	Crypto,
	Data,
	Effect,
	FileSystem,
	Layer,
	Path,
	Schema,
} from "effect";
import { Hex } from "effect/encoding";

import {
	SandboxSmokeFixturesJson,
	smokeHostCallKey,
	smokeHostCallValue,
	smokeSourceManifest,
	smokeTiers,
} from "./sandbox-smoke-fixtures";

const startedAt = "2026-01-01T00:00:00.000Z";
const scriptId = SandboxScriptId.make("production-runtime-smoke");
const ownerId = UserId.make("production-runtime-smoke-user");
const trusts = ["system", "user"] as const;

type SmokeTier = (typeof smokeTiers)[number];
type SmokeTrust = (typeof trusts)[number];

const SmokeOutput = Schema.Struct({
	ambient: Schema.Tuple([]),
	aliasIdentity: Schema.Literal(true),
	hostValue: Schema.Literal(smokeHostCallValue),
});

class SandboxSmokeConfigError extends Data.TaggedError("SandboxSmokeConfigError")<{
	readonly message: string;
}> {}

const configEnvironmentKey = (field: { readonly envKey?: string | undefined }) =>
	field.envKey === undefined
		? Effect.fail(
				new SandboxSmokeConfigError({
					message: "Smoke configuration field has no canonical environment key",
				}),
			)
		: Effect.succeed(field.envKey);

const SandboxSmokeConfigProviderLive = Layer.effectContext(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-native-sandbox-smoke-" });
		const workDirectory = path.join(root, "work");
		yield* fs.makeDirectory(workDirectory, { recursive: true });
		const [redisUrlKey, localTempDirKey, adminAccessTokenKey, databaseUrlKey] = yield* Effect.all([
			configEnvironmentKey(appConfigDefinition.fields.redisUrl),
			configEnvironmentKey(appConfigDefinition.fields.fileStorage.fields.localTempDir),
			configEnvironmentKey(appConfigDefinition.fields.server.fields.adminAccessToken),
			configEnvironmentKey(appConfigDefinition.fields.database.fields.url),
		]);
		const values = {
			[localTempDirKey]: workDirectory,
			[redisUrlKey]: "redis://127.0.0.1:6379",
			[adminAccessTokenKey]: "sandbox-smoke-build-placeholder",
			[databaseUrlKey]: "postgres://sandbox-smoke:sandbox-smoke@127.0.0.1:5432/sandbox-smoke",
		};
		return Context.make(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values));
	}),
).pipe(Layer.provide(BunServices.layer));

const AppConfigSmokeLive = AppConfig.layer.pipe(Layer.provideMerge(SandboxSmokeConfigProviderLive));

const ServerRunSmokeLive = Layer.succeed(ServerRun, { id: "production-runtime-smoke" });

const trustedPrincipals = new Map<string, SmokeTrust>();

const encodePrincipal = Schema.encodeSync(Schema.fromJsonString(SandboxExecutionPrincipal));
const resolveTrustedPrincipal = (principal: SandboxExecutionPrincipal) =>
	trustedPrincipals.get(encodePrincipal(principal));

const invalidSmokePrincipal = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Smoke fixture principal is not trusted",
	});

const SandboxExecutionAuthoritySmokeLive = Layer.succeed(SandboxExecutionAuthority, {
	resolve: (principal) => {
		const trusted = resolveTrustedPrincipal(principal);
		return trusted === undefined ? Effect.fail(invalidSmokePrincipal()) : Effect.succeed(trusted);
	},
});

const SandboxSidecarQuarantineSmokeLive = Layer.succeed(SandboxSidecarQuarantine, {
	open: (principal, trust) => {
		if (resolveTrustedPrincipal(principal) !== trust) {
			return Effect.fail(invalidSmokePrincipal());
		}
		return Effect.succeed({
			probation: false,
			survived: Effect.void,
			identities: [`smoke:${principal.contentHash}`],
			recordCrash: Effect.fail(
				new SandboxRunError({
					kind: "infrastructure",
					message: "Native sandbox smoke recorded a sidecar crash",
				}),
			),
		});
	},
});

const initialRecoveryState = { recoveries: 0, suspended: false };
const smokeRecoveryUnavailable = () =>
	new SandboxRecoveryStoreError({ message: "Native sandbox smoke recovery is disabled" });

const SandboxRecoveryStoreSmokeLive = Layer.succeed(SandboxRecoveryStore, {
	read: () => Effect.succeed(initialRecoveryState),
	clear: () => Effect.succeed(initialRecoveryState),
	resume: () => Effect.fail(smokeRecoveryUnavailable()),
	collateral: () => Effect.fail(smokeRecoveryUnavailable()),
});

const SandboxSidecarSupervisorSmokeLive = Layer.effect(
	SandboxSidecarSupervisor,
	SandboxSidecarSupervisor.make,
).pipe(
	Layer.provideMerge(SandboxSidecarClient.layer),
	Layer.provideMerge(SandboxSidecarAdmission.layer),
	Layer.provide(SandboxExecutionAuthoritySmokeLive),
	Layer.provide(SandboxSidecarQuarantineSmokeLive),
	Layer.provide(SandboxRecoveryStoreSmokeLive),
);

const unusedHostEffect = () => Effect.die("Unused native sandbox smoke host implementation");
const unusedHostValue = (): never => {
	throw new Error("Unused native sandbox smoke host implementation");
};

const recordedHostCalls: string[] = [];

const SandboxHostImplementationsSmokeLive = Layer.succeed(SandboxHostImplementations, {
	automation: { emitSignal: unusedHostEffect, sendNotification: unusedHostEffect },
	runtime: {
		httpCall: unusedHostEffect,
		setCachedValue: unusedHostEffect,
		getPersistentValue: unusedHostEffect,
		claimPersistentValue: unusedHostEffect,
		getCachedValue: (_input, key) =>
			key === smokeHostCallKey
				? Effect.sync(() => {
						recordedHostCalls.push(key);
						return smokeHostCallValue;
					})
				: Effect.fail({ message: "Unexpected native sandbox smoke host call" }),
	},
	lifecycle: {
		updateEvents: { commit: unusedHostEffect, validate: unusedHostEffect },
		deleteEvents: { commit: unusedHostEffect, validate: unusedHostEffect },
		upsertGlobalEntities: {
			value: unusedHostValue,
			commit: unusedHostEffect,
			prepare: unusedHostEffect,
			validate: unusedHostEffect,
			applyPolicies: unusedHostEffect,
		},
		changeUserRelationships: {
			value: unusedHostValue,
			commit: unusedHostEffect,
			prepare: unusedHostEffect,
			validate: unusedHostEffect,
			applyPolicies: unusedHostEffect,
		},
		upsertGlobalRelationships: {
			value: unusedHostValue,
			commit: unusedHostEffect,
			prepare: unusedHostEffect,
			validate: unusedHostEffect,
			applyPolicies: unusedHostEffect,
		},
	},
	additional: {
		deleteEvents: unusedHostEffect,
		createEvents: unusedHostEffect,
		updateEvents: unusedHostEffect,
		executeRyotql: unusedHostEffect,
		getPluginConfig: unusedHostEffect,
		getUserSettings: unusedHostEffect,
		listIntegrations: unusedHostEffect,
		listEventSchemas: unusedHostEffect,
		getEntitySchemas: unusedHostEffect,
		getUserPreferences: unusedHostEffect,
		ensureUserEntities: unusedHostEffect,
		getOAuthAccessToken: unusedHostEffect,
		upsertGlobalEntities: unusedHostEffect,
		getCurrentIntegration: unusedHostEffect,
		requestEventStreamWork: unusedHostEffect,
		changeUserRelationships: unusedHostEffect,
		upsertGlobalRelationships: unusedHostEffect,
		invalidateOAuthAccessToken: unusedHostEffect,
	},
});

const SandboxServiceSmokeLive = Layer.effect(SandboxService, SandboxService.make).pipe(
	Layer.provideMerge(SandboxSidecarSupervisorSmokeLive),
	Layer.provideMerge(SandboxHostCallGate.layer),
	Layer.provide(SandboxFileService.layer),
	Layer.provide(SandboxHostImplementationsSmokeLive),
);

const RuntimeSmokeLive = SandboxServiceSmokeLive.pipe(
	Layer.provideMerge(Layer.mergeAll(BunServices.layer, AppConfigSmokeLive, ServerRunSmokeLive)),
);

const smoke = Effect.gen(function* () {
	const crypto = yield* Crypto.Crypto;
	const service = yield* SandboxService;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const supervisor = yield* SandboxSidecarSupervisor;
	const fixturesPath = yield* path.fromFileUrl(
		new URL("./sandbox-smoke-fixtures.json", import.meta.url),
	);
	const compiledByTier = yield* fs.readFileString(fixturesPath).pipe(
		Effect.flatMap(Schema.decodeEffect(SandboxSmokeFixturesJson)),
		Effect.mapError(
			() =>
				new SandboxRunError({
					kind: "missing-artifact",
					message: "Prebuilt smoke fixtures are missing or invalid",
				}),
		),
	);

	const fixtures: Array<{
		readonly trust: SmokeTrust;
		readonly compiledCode: string;
		readonly expectedTier: SmokeTier;
		readonly principal: SandboxExecutionPrincipal;
	}> = [];

	for (const trust of trusts) {
		for (const tier of smokeTiers) {
			const compiled = compiledByTier[tier];
			const contentHash = Hex.encode(
				yield* crypto.digest("SHA-256", new TextEncoder().encode(compiled.javascript)),
			);
			const principal = yield* Schema.decodeEffect(SandboxExecutionPrincipal)({
				scriptId,
				contentHash,
				providerId: null,
				metadata: compiled.manifest,
				scriptSlug: smokeSourceManifest.slug,
				...(trust === "system"
					? { kernelScript: true, pluginRevision: null, subject: { type: "system" } }
					: {
							subject: {
								type: "user",
								userId: ownerId,
								accountGeneration: {
									userId: ownerId,
									token: "production-runtime-smoke-account-generation",
								},
							},
							pluginRevision: {
								ownerId,
								scope: "user",
								workflowScripts: {},
								userBootstrapScriptSlugs: [],
								slug: "production-runtime-smoke",
								id: PluginId.make("production-runtime-smoke"),
								configSchema: { fields: {}, unknownKeys: "strict" },
								compiledHashes: { [smokeSourceManifest.slug]: contentHash },
								revisionId: PluginRevisionId.make("production-runtime-smoke-revision"),
								configRevisionId: PluginConfigRevisionId.make("production-runtime-smoke-config"),
								schemaScope: {
									eventSchemas: [],
									entitySchemaSlugs: [],
									relationshipSchemaSlugs: [],
								},
							},
						}),
			}).pipe(
				Effect.mapError(
					() =>
						new SandboxRunError({
							kind: "missing-artifact",
							message: "Smoke fixture principal is invalid",
						}),
				),
			);
			trustedPrincipals.set(encodePrincipal(principal), trust);
			fixtures.push({ trust, principal, expectedTier: tier, compiledCode: compiled.javascript });
		}
	}

	const completedKeys: string[] = [];
	for (const fixture of fixtures) {
		const located = yield* supervisor.locate(fixture.principal);
		const expectedKey = `${fixture.trust}/${fixture.expectedTier}`;
		if (
			located.trust !== fixture.trust ||
			located.tier !== fixture.expectedTier ||
			located.instance !== expectedKey
		) {
			return yield* new SandboxRunError({
				kind: "missing-artifact",
				message: "Native sidecar selected the wrong smoke fixture key",
			});
		}

		const executionId = `production-runtime-smoke-${yield* crypto.randomUUIDv4}`;
		const input: SandboxRunInput = {
			startedAt,
			executionId,
			context: {},
			lane: "interactive",
			principal: fixture.principal,
			compiledCode: fixture.compiledCode,
			compiledFormat: SANDBOX_COMPILED_FORMAT,
		};
		const result = yield* service.run(input);
		if (!result.success || result.error !== null || result.executionId !== executionId) {
			return yield* new SandboxRunError({
				kind: "script-failure",
				message: "Native sandbox smoke execution did not succeed",
			});
		}
		yield* Schema.decodeUnknownEffect(SmokeOutput)(result.value).pipe(
			Effect.mapError(
				() =>
					new SandboxRunError({
						kind: "invalid-output",
						message: "Native sandbox smoke output is invalid",
					}),
			),
		);
		if (result.recovery.executionId !== executionId || result.recovery.instance !== expectedKey) {
			return yield* new SandboxRunError({
				kind: "invalid-output",
				message: "Native sandbox smoke output or recovery identity is invalid",
			});
		}
		const calls = yield* Effect.sync(() => [...recordedHostCalls]);
		if (
			calls.length !== completedKeys.length + 1 ||
			calls.some((key) => key !== smokeHostCallKey)
		) {
			return yield* new SandboxRunError({
				kind: "script-failure",
				message: "Native sandbox smoke host call record is invalid",
			});
		}
		yield* service.completeRecovery(result.recovery);
		completedKeys.push(expectedKey);
	}

	if (completedKeys.length !== 6 || recordedHostCalls.length !== 6) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "Native sandbox smoke did not complete all six fixture keys",
		});
	}
	if (process.platform === "linux") {
		const sidecars: string[] = [];
		for (const entry of yield* fs.readDirectory("/proc")) {
			if (!/^\d+$/.test(entry)) {
				continue;
			}
			const status = yield* fs
				.readFileString(`/proc/${entry}/status`)
				.pipe(Effect.orElseSucceed(() => ""));
			if (
				!status.split("\n").includes("Name:\tryot-sandboxd") ||
				!status.split("\n").includes(`PPid:\t${process.pid}`)
			) {
				continue;
			}
			const oomScore = yield* fs.readFileString(`/proc/${entry}/oom_score_adj`);
			const lines = status.split("\n");
			if (
				!lines.includes("Uid:\t1002\t1002\t1002\t1002") ||
				!lines.includes("Gid:\t1002\t1002\t1002\t1002") ||
				!lines.includes("NoNewPrivs:\t1") ||
				!lines.includes("Seccomp:\t2") ||
				oomScore.trim() !== "1000"
			) {
				return yield* new SandboxRunError({
					kind: "infrastructure",
					message: "Native sandbox sidecar process is not confined",
				});
			}
			sidecars.push(entry);
		}
		if (sidecars.length !== 6) {
			return yield* new SandboxRunError({
				kind: "infrastructure",
				message: "Native sandbox smoke did not find six confined sidecar processes",
			});
		}
	}
	yield* Effect.logInfo("Native sandbox smoke passed").pipe(
		Effect.annotateLogs({ keys: completedKeys.join(",") }),
	);
	return undefined;
}).pipe(Effect.withSpan("production-native-sandbox-smoke"));

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The native sandbox smoke is a command-line entrypoint
	smoke.pipe(Effect.provide(RuntimeSmokeLive)),
);
