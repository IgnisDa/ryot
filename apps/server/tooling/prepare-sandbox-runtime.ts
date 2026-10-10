#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { SandboxHostConfigLive } from "@ryot-app/kernel-backend/modules/scripts/host/sandbox-host-live";
import { appConfigDefinition } from "@ryot-app/kernel-backend/platform/config/definition";
import { AppConfig } from "@ryot-app/kernel-backend/platform/config/service";
import { ServerRun } from "@ryot-app/kernel-backend/platform/server-run";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/plugin-backend-compiler/protocol";
import { SandboxSidecarAdmission } from "@ryot-app/sandbox/host/admission";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { SandboxSidecarClient } from "@ryot-app/sandbox/host/client";
import { SandboxHostCallScope } from "@ryot-app/sandbox/host/config";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { ExecutionFiles } from "@ryot-app/sandbox/host/file-access";
import { SandboxHostCallGate } from "@ryot-app/sandbox/host/host-call-gate";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import { unusedSandboxHostFunctions } from "@ryot-app/sandbox/host/host.test-support";
import type { SandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { SandboxSidecarQuarantine } from "@ryot-app/sandbox/host/quarantine";
import {
	SandboxRecoveryStore,
	SandboxRecoveryStoreError,
} from "@ryot-app/sandbox/host/recovery-store";
import { SandboxSidecarSupervisor } from "@ryot-app/sandbox/host/supervisor";
import { ScriptExecutionPrincipal } from "@ryot-app/sandbox/protocol/principal";
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
const expectedKeyCount = trusts.length * smokeTiers.length;
// Must match SIDECAR_UID, SIDECAR_GID, and the OOM score adjustment in ryot-sandbox-launcher.rs
const sidecarId = 1002;
const sidecarOomScore = 1000;

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

const encodePrincipal = Schema.encodeSync(Schema.fromJsonString(ScriptExecutionPrincipal));
const resolveTrustedPrincipal = (principal: ScriptExecutionPrincipal) =>
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

const recordedHostCalls: string[] = [];

const SandboxHostFunctionsSmokeLive = Layer.succeed(
	SandboxHostFunctions,
	unusedSandboxHostFunctions({
		getCachedValue: (_input, key) =>
			key === smokeHostCallKey
				? Effect.sync(() => {
						recordedHostCalls.push(key);
						return smokeHostCallValue;
					})
				: Effect.fail({ message: "Unexpected native sandbox smoke host call" }),
	}),
);

const SandboxExecutorSmokeLive = Layer.effect(SandboxExecutor, SandboxExecutor.make).pipe(
	Layer.provideMerge(SandboxHostCallGate.layer),
	Layer.provide(ExecutionFiles.layer),
	Layer.provide(SandboxHostFunctionsSmokeLive),
	Layer.provideMerge(SandboxExecutionAuthoritySmokeLive),
	Layer.provideMerge(SandboxSidecarSupervisorSmokeLive),
);

const RuntimeSmokeLive = SandboxExecutorSmokeLive.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			BunServices.layer,
			Layer.succeed(SandboxHostCallScope, { bound: (effect) => effect }),
			SandboxHostConfigLive.pipe(
				Layer.provide(Layer.merge(AppConfigSmokeLive, ServerRunSmokeLive)),
			),
		),
	),
);

const verifyConfinedSidecars = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const sidecars: string[] = [];
	for (const entry of yield* fs.readDirectory("/proc")) {
		if (!/^\d+$/.test(entry)) {
			continue;
		}
		const status = yield* fs
			.readFileString(`/proc/${entry}/status`)
			.pipe(Effect.orElseSucceed(() => ""));
		const lines = status.split("\n");
		if (!lines.includes("Name:\tryot-sandboxd") || !lines.includes(`PPid:\t${process.pid}`)) {
			continue;
		}
		const oomScore = yield* fs.readFileString(`/proc/${entry}/oom_score_adj`);
		if (
			!lines.includes(`Uid:\t${sidecarId}\t${sidecarId}\t${sidecarId}\t${sidecarId}`) ||
			!lines.includes(`Gid:\t${sidecarId}\t${sidecarId}\t${sidecarId}\t${sidecarId}`) ||
			!lines.includes("NoNewPrivs:\t1") ||
			!lines.includes("Seccomp:\t2") ||
			oomScore.trim() !== String(sidecarOomScore)
		) {
			return yield* new SandboxRunError({
				kind: "infrastructure",
				message: "Native sandbox sidecar process is not confined",
			});
		}
		sidecars.push(entry);
	}
	if (sidecars.length !== expectedKeyCount) {
		return yield* new SandboxRunError({
			kind: "infrastructure",
			message: "Native sandbox smoke did not find all confined sidecar processes",
		});
	}
	return undefined;
});

const smoke = Effect.gen(function* () {
	const crypto = yield* Crypto.Crypto;
	const service = yield* SandboxExecutor;
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
		readonly principal: ScriptExecutionPrincipal;
	}> = [];

	for (const trust of trusts) {
		for (const tier of smokeTiers) {
			const compiled = compiledByTier[tier];
			const contentHash = Hex.encode(
				yield* crypto.digest("SHA-256", new TextEncoder().encode(compiled.javascript)),
			);
			const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
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
								id: PluginId.make("production-runtime-smoke"),
								configSchema: { fields: {}, unknownKeys: "strict" },
								compiledHashes: { [smokeSourceManifest.slug]: contentHash },
								packageId: PluginPackageId.make("ryot/production-runtime-smoke"),
								revisionId: PluginRevisionId.make("production-runtime-smoke-revision"),
								configRevisionId: PluginConfigRevisionId.make("production-runtime-smoke-config"),
								schemaScope: {
									eventSchemas: [],
									entitySchemaSlugs: [],
									signalSchemaSlugs: [],
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

	if (completedKeys.length !== expectedKeyCount || recordedHostCalls.length !== expectedKeyCount) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "Native sandbox smoke did not complete all fixture keys",
		});
	}
	if (process.platform === "linux") {
		yield* verifyConfinedSidecars;
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
