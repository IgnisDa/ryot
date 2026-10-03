import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import {
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Layer,
	Path,
	Redacted,
	Schema,
} from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { ServerRun } from "#lib/infrastructure/server-run";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { testExecutionId, testRedisUrl } from "#lib/test-utils/redis";
import { sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxExecutionAuthority, type SandboxExecutionPrincipal } from "./execution-principal";
import { SandboxHostImplementations } from "./host-implementations";
import { SandboxService } from "./service";
import type { SandboxRunInput } from "./shared";
import { SandboxSidecarAdmission } from "./sidecar-admission";

type RecordedHostCall = {
	readonly args: ReadonlyArray<unknown>;
	readonly subject: SandboxExecutionPrincipal["subject"];
};

type NativeServiceControlValue = {
	readonly calls: Array<RecordedHostCall>;
	readonly hostStarted: Deferred.Deferred<void>;
	readonly hostCompleted: Deferred.Deferred<void>;
	readonly hostInterrupted: Deferred.Deferred<void>;
	readonly releaseHost: Deferred.Deferred<{ readonly key: string; readonly source: string }>;
};

class NativeServiceControl extends Context.Service<
	NativeServiceControl,
	NativeServiceControlValue
>()("test/SandboxNativeServiceControl") {}

class NativeServiceTempRoot extends Context.Service<NativeServiceTempRoot, string>()(
	"test/SandboxNativeServiceTempRoot",
) {}

const makeUserSubject = (userId: UserId): SandboxExecutionPrincipal["subject"] => ({
	userId,
	type: "user",
	accountGeneration: { userId, token: `native-service-account-generation-${userId}` },
});

const unusedEffect = () => Effect.die("Unused native sandbox host implementation");
const unusedValue = (): never => {
	throw new Error("Unused native sandbox lifecycle host implementation");
};

const withRecoveryCleanup = <A, E, R>(
	executionIds: ReadonlyArray<string>,
	effect: Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const redis = yield* RedisService;
			yield* Effect.addFinalizer(() => redis.del(...executionIds.map(redisKeys.sandboxRecovery)));
			return yield* effect;
		}),
	);

const makeHostImplementations = (
	control: NativeServiceControlValue,
): SandboxHostImplementations["Service"] => ({
	automation: { emitSignal: unusedEffect, sendNotification: unusedEffect },
	additional: {
		deleteEvents: unusedEffect,
		createEvents: unusedEffect,
		updateEvents: unusedEffect,
		executeRyotql: unusedEffect,
		getPluginConfig: unusedEffect,
		getUserSettings: unusedEffect,
		listIntegrations: unusedEffect,
		listEventSchemas: unusedEffect,
		getEntitySchemas: unusedEffect,
		getUserPreferences: unusedEffect,
		ensureUserEntities: unusedEffect,
		getOAuthAccessToken: unusedEffect,
		upsertGlobalEntities: unusedEffect,
		getCurrentIntegration: unusedEffect,
		requestEventStreamWork: unusedEffect,
		changeUserRelationships: unusedEffect,
		upsertGlobalRelationships: unusedEffect,
	},
	runtime: {
		httpCall: unusedEffect,
		setCachedValue: unusedEffect,
		getPersistentValue: unusedEffect,
		claimPersistentValue: unusedEffect,
		getCachedValue: (input, key) => {
			control.calls.push({ args: [key], subject: input.principal.subject });
			if (key !== "block") {
				return Effect.succeed({ key, source: "native-host" });
			}
			return Deferred.succeed(control.hostStarted, undefined).pipe(
				Effect.andThen(Deferred.await(control.releaseHost)),
				Effect.onInterrupt(() => Deferred.succeed(control.hostInterrupted, undefined)),
				Effect.ensuring(Deferred.succeed(control.hostCompleted, undefined)),
			);
		},
	},
	lifecycle: {
		updateEvents: { commit: unusedEffect, validate: unusedEffect },
		deleteEvents: { commit: unusedEffect, validate: unusedEffect },
		upsertGlobalEntities: {
			value: unusedValue,
			commit: unusedEffect,
			prepare: unusedEffect,
			validate: unusedEffect,
			applyPolicies: unusedEffect,
		},
		changeUserRelationships: {
			value: unusedValue,
			commit: unusedEffect,
			prepare: unusedEffect,
			validate: unusedEffect,
			applyPolicies: unusedEffect,
		},
		upsertGlobalRelationships: {
			value: unusedValue,
			commit: unusedEffect,
			prepare: unusedEffect,
			validate: unusedEffect,
			applyPolicies: unusedEffect,
		},
	},
});

const nativeServiceLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const temporaryRoot = yield* fs.makeTempDirectoryScoped({
			prefix: "ryot-sandbox-native-service-",
		});
		const root = yield* fs.realPath(temporaryRoot);
		const runtimeDirectory = yield* sandboxRuntimeDirectory;
		const control: NativeServiceControlValue = {
			calls: [],
			hostStarted: yield* Deferred.make<void>(),
			hostCompleted: yield* Deferred.make<void>(),
			hostInterrupted: yield* Deferred.make<void>(),
			releaseHost: yield* Deferred.make<{ readonly key: string; readonly source: string }>(),
		};
		const appConfig = makeAppConfigLayer({
			sandbox: { runtimeDirectory },
			fileStorage: { localTempDir: root },
			redisUrl: Redacted.make(testRedisUrl()),
		});
		const dependencies = Layer.mergeAll(
			appConfig,
			Layer.succeed(ServerRun, { id: "native-service-test-run" }),
			Layer.succeed(SandboxExecutionAuthority, { resolve: (_principal) => Effect.succeed("user") }),
			Layer.succeed(SandboxHostImplementations, makeHostImplementations(control)),
			Layer.succeed(NativeServiceControl, control),
			Layer.succeed(NativeServiceTempRoot, root),
		);
		return Layer.mergeAll(SandboxService.layer, SandboxCompiler.layer).pipe(
			Layer.provideMerge(RedisService.layer),
			Layer.provideMerge(dependencies),
		);
	}),
).pipe(Layer.provideMerge(BunServices.layer));

const hostDefinitionSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Native service host call",
  slug: "native-service-host-call",
});

export default defineScript({
  manifest,
  input: Schema.Struct({ count: Schema.Number, key: Schema.String }),
  output: Schema.Struct({ cached: Schema.Unknown, count: Schema.Number }),
  run: (input, host) => Effect.gen(function* () {
    return { cached: yield* host.getCachedValue(input.key), count: input.count };
  }),
});
`;

const artifactDefinitionSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script",
  name: "Native service artifact read",
  slug: "native-service-artifact-read",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.String,
  run: () => Effect.gen(function* () {
    const bytes = yield* readArtifact;
    return new TextDecoder().decode(bytes);
  }),
});
`;

const blockedDefinitionSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Native service cancelled run",
  slug: "native-service-cancelled-run",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.String,
  run: (_input, host) => Effect.gen(function* () {
    Reflect.set(globalThis, "nativeServiceState", "cancelled-neighbour");
    yield* host.getCachedValue("block");
    return "finished";
  }),
});
`;

const neighbourDefinitionSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Native service neighbour",
  slug: "native-service-neighbour",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.String,
  run: () => Effect.succeed(String(Reflect.get(globalThis, "nativeServiceState") ?? "fresh")),
});
`;

const capsDefinitionSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Native service payload caps",
  slug: "native-service-payload-caps",
});

export default defineScript({
  manifest,
  input: Schema.Struct({ unit: Schema.String, count: Schema.Number, tail: Schema.Number, pad: Schema.String }),
  output: Schema.String,
  run: (input) => Effect.succeed(input.unit.repeat(input.count) + "a".repeat(input.tail)),
});
`;

const encodeContext = Schema.encodeSync(
	Schema.fromJsonString(
		Schema.Struct({
			pad: Schema.String,
			unit: Schema.String,
			tail: Schema.Finite,
			count: Schema.Finite,
		}),
	),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodedBytes = (value: string) => new TextEncoder().encode(value).byteLength;

const grantedInlineDefinitionSource = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact, readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

export const manifest = defineManifest({
  kind: "operation",
  name: "Native service granted inline",
  slug: "native-service-granted-inline",
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ named: Schema.Boolean }),
  output: Schema.Unknown,
  run: (input, host) => Effect.gen(function* () {
    const artifact = new TextDecoder().decode(yield* readArtifact);
    const named = input.named
      ? yield* readNamedArtifact("other").pipe(
          Effect.match({ onFailure: (error) => error.data?.code ?? "failed", onSuccess: () => "read" }),
        )
      : null;
    const cached = yield* host.getCachedValue("inline-key");
    return { named, cached, artifact };
  }),
});
`;

const ambientAuthorityModule = (manifest: unknown) => `
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
const reachable = [];
for (const name of ["Deno", "Bun", "process", "require", "fetch", "Request", "Response", "Blob", "File", "MessageChannel", "MessagePort", "BroadcastChannel", "SharedArrayBuffer", "Atomics", "WebAssembly", "Worker", "SharedWorker", "importScripts"]) {
  if (name in globalThis) reachable.push("global:" + name);
}
for (const [label, generate] of [
  ["eval", () => (0, eval)("1")],
  ["Function", () => new Function("return 1")()],
  ["AsyncFunction", () => (async () => {}).constructor("return 1")],
  ["GeneratorFunction", () => (function* () {}).constructor("yield 1")],
]) {
  try { generate(); reachable.push("codegen:" + label); } catch {}
}
for (const symbol of Object.getOwnPropertySymbols(globalThis)) reachable.push("symbol:" + String(symbol.description));
const forbidden = ["ext:core/ops", "data:text/javascript,export default 1", "file:///etc/passwd", "https://example.com/module.js", "node:fs", "npm:zod"];
export default {
  definitionType: "ryot:sandbox-script",
  manifest: ${encodeJson(manifest)},
  input: Schema.Struct({}),
  output: Schema.Array(Schema.String),
  run: () => Effect.promise(async () => {
    for (const specifier of forbidden) {
      try { await import(specifier); reachable.push("import:" + specifier); } catch {}
    }
    return reachable;
  }),
};
`;

const makeRunInput = (
	compiled: Effect.Success<ReturnType<SandboxCompiler["Service"]["compile"]>>,
	executionId: string,
	context: unknown,
	uploaderId: UserId,
	grants?: SandboxRunInput["grants"],
): SandboxRunInput => ({
	context,
	executionId,
	compiledFormat: compiled.format,
	compiledCode: compiled.javascript,
	principal: {
		providerId: null,
		pluginRevision: null,
		metadata: compiled.manifest,
		standaloneUploaderId: uploaderId,
		scriptSlug: compiled.manifest.slug,
		subject: makeUserSubject(uploaderId),
		scriptId: SandboxScriptId.make(executionId),
		contentHash: sha256Hex(compiled.javascript),
	},
	...(grants === undefined ? {} : { grants }),
});

layer(nativeServiceLayer, { excludeTestServices: true })((test) => {
	test.effect("real_native_service_preserves_definition_results_and_host_dispatch", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const successExecutionId = testExecutionId("native-service-success");
		const invalidExecutionId = testExecutionId("native-service-invalid-input");
		return withRecoveryCleanup(
			[successExecutionId, invalidExecutionId],
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const control = yield* NativeServiceControl;
				const compiled = yield* compiler.compile(hostDefinitionSource);
				expect(compiled.manifest.capabilities).toContain("getCachedValue");
				const input = makeRunInput(
					compiled,
					successExecutionId,
					{ count: 7, key: "shared-key" },
					uploaderId,
				);
				const result = yield* service.run(input);
				const invalid = yield* service.run(
					makeRunInput(compiled, invalidExecutionId, { key: "unused", count: "wrong" }, uploaderId),
				);

				expect(result).toEqual({
					logs: [],
					inline: [],
					error: null,
					harvest: null,
					success: true,
					executionId: input.executionId,
					timing: { totalMs: expect.any(Number), executionMs: expect.any(Number) },
					value: { count: 7, cached: { key: "shared-key", source: "native-host" } },
					recovery: {
						instance: "user/core",
						pinHash: expect.any(String),
						executionId: input.executionId,
					},
				});
				expect(result.timing.totalMs).toBeGreaterThan(0);
				expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
				expect(control.calls).toEqual([
					{ args: ["shared-key"], subject: makeUserSubject(uploaderId) },
				]);
				expect(invalid).toMatchObject({
					success: false,
					error: {
						phase: "input",
						message: expect.stringContaining("Definition input validation failed"),
					},
				});
				expect(control.calls).toHaveLength(1);
			}),
		);
	});

	test.effect("integration_rejects_module_and_snapshot_tampering", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const tamperedExecutionId = testExecutionId("native-service-tampered-module");
		const unsupportedExecutionId = testExecutionId("native-service-unsupported-format");
		return withRecoveryCleanup(
			[tamperedExecutionId, unsupportedExecutionId],
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const control = yield* NativeServiceControl;
				control.calls.length = 0;
				const compiled = yield* compiler.compile(hostDefinitionSource);
				const tamperedInput = makeRunInput(
					compiled,
					tamperedExecutionId,
					{ count: 1, key: "unused" },
					uploaderId,
				);
				const tampered = yield* Effect.flip(
					service.run({ ...tamperedInput, compiledCode: `${tamperedInput.compiledCode} ` }),
				);
				expect(tampered).toMatchObject({
					kind: "missing-artifact",
					message: "Sandbox compiled module does not match its pinned artifact",
				});

				const unsupportedInput = makeRunInput(
					compiled,
					unsupportedExecutionId,
					{ count: 1, key: "unused" },
					uploaderId,
				);
				const unsupported = yield* Effect.flip(
					service.run({ ...unsupportedInput, compiledFormat: compiled.format + 1 }),
				);
				expect(unsupported).toMatchObject({
					kind: "missing-artifact",
					message: "Sandbox compiled module does not match its pinned artifact",
				});
				expect(control.calls).toEqual([]);
			}),
		);
	});

	test.effect("files_and_http_require_execution_bound_grants", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const grantedExecutionId = testExecutionId("native-service-granted-artifact");
		const deniedExecutionId = testExecutionId("native-service-missing-artifact-grant");
		return withRecoveryCleanup(
			[grantedExecutionId, deniedExecutionId],
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const root = yield* NativeServiceTempRoot;
				const artifactPath = path.join(root, "trusted-artifact.txt");
				yield* fs.writeFileString(artifactPath, "trusted artifact contents");
				const compiled = yield* compiler.compile(artifactDefinitionSource);
				expect(compiled.manifest.capabilities).toContain("artifact-read");

				const granted = yield* service.run(
					makeRunInput(compiled, grantedExecutionId, {}, uploaderId, { artifactPath }),
				);
				const denied = yield* service.run(
					makeRunInput(compiled, deniedExecutionId, {}, uploaderId),
				);
				expect(granted).toMatchObject({
					error: null,
					success: true,
					value: "trusted artifact contents",
				});
				expect(denied).toMatchObject({
					success: false,
					error: {
						phase: "execute",
						data: { code: "missing-artifact-grant" },
						message: "Sandbox artifact grant is unavailable",
					},
				});
			}),
		);
	});

	test.effect("native_service_disposes_cancelled_isolates_and_preserves_neighbours", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const cancelledExecutionId = testExecutionId("native-service-cancelled");
		const neighbourExecutionId = testExecutionId("native-service-neighbour");
		return withRecoveryCleanup(
			[cancelledExecutionId, neighbourExecutionId],
			Effect.gen(function* () {
				const admission = yield* SandboxSidecarAdmission;
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const control = yield* NativeServiceControl;
				control.calls.length = 0;
				const blocked = yield* compiler.compile(blockedDefinitionSource);
				const neighbour = yield* compiler.compile(neighbourDefinitionSource);
				const runFiber = yield* Effect.forkChild(
					service.run(makeRunInput(blocked, cancelledExecutionId, {}, uploaderId)),
				);
				const started = yield* Effect.raceFirst(
					Deferred.await(control.hostStarted).pipe(
						Effect.as({ started: true } satisfies { readonly started: true }),
					),
					Fiber.await(runFiber).pipe(
						Effect.map(
							(exit) =>
								({ exit, started: false }) satisfies {
									readonly exit: typeof exit;
									readonly started: false;
								},
						),
					),
				);
				if (!started.started) {
					expect(started.exit).toMatchObject({
						_tag: "Success",
						value: {
							success: false,
							error: { message: "Sandbox host call arguments are invalid" },
						},
					});
					throw new Error(
						"Native sandbox run finished before its blocking host implementation started",
					);
				}
				yield* Fiber.interrupt(runFiber);
				const interrupted = yield* Fiber.await(runFiber);
				expect(Exit.isFailure(interrupted)).toBe(true);
				yield* Deferred.await(control.hostInterrupted);
				yield* Deferred.await(control.hostCompleted);
				expect(control.calls).toEqual([{ args: ["block"], subject: makeUserSubject(uploaderId) }]);
				expect(admission.snapshot().runs).toBe(0);

				const result = yield* service.run(
					makeRunInput(neighbour, neighbourExecutionId, {}, uploaderId),
				);
				expect(result).toMatchObject({ success: true, value: "fresh" });
			}),
		);
	});

	test.effect("integration_enforces_invocation_context_and_result_caps", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const executionIds: string[] = [];
		const nextExecutionId = () => {
			const executionId = testExecutionId("native-service-caps");
			executionIds.push(executionId);
			return executionId;
		};
		return withRecoveryCleanup(
			executionIds,
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const compiled = yield* compiler.compile(capsDefinitionSource);
				const resultBytes = 4 * 1024 * 1024;
				const contextBytes = 64 * 1024;
				const run = (context: { unit: string; count: number; tail: number; pad: string }) =>
					service.run(makeRunInput(compiled, nextExecutionId(), context, uploaderId));

				for (const unit of ["a", "🙂", '"']) {
					const unitBytes = encodedBytes(encodeJson(unit)) - 2;
					const count = Math.floor((resultBytes - 2) / unitBytes);
					const tail = resultBytes - 2 - count * unitBytes;
					const exact = yield* run({ unit, tail, count, pad: "" });
					expect(exact.success).toBe(true);
					expect(exact.value).toBe(unit.repeat(count) + "a".repeat(tail));
					expect(encodedBytes(encodeJson(exact.value))).toBe(resultBytes);
					expect(yield* run({ unit, count, pad: "", tail: tail + 1 })).toMatchObject({
						value: null,
						success: false,
						error: { phase: "output" },
					});

					const base = { tail: 0, pad: "", count: 0, unit: "a" };
					const padBytes = contextBytes - encodedBytes(encodeContext(base));
					const padCount = Math.floor(padBytes / unitBytes);
					const pad = unit.repeat(padCount) + "a".repeat(padBytes - padCount * unitBytes);
					expect(encodedBytes(encodeContext({ ...base, pad }))).toBe(contextBytes);
					expect(yield* run({ ...base, pad })).toMatchObject({ value: "", success: true });
					const oversized = yield* Effect.flip(run({ ...base, pad: `${pad}a` }));
					expect(oversized).toMatchObject({ kind: "invalid-input" });
				}
			}),
		);
	});

	test.effect("granted_executions_settle_inline_without_permission_elevation", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const executionIds = [
			testExecutionId("native-service-granted-inline"),
			testExecutionId("native-service-granted-named"),
		];
		return withRecoveryCleanup(
			executionIds,
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const control = yield* NativeServiceControl;
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const root = yield* NativeServiceTempRoot;
				control.calls.length = 0;
				const artifactPath = path.join(root, "granted-inline-artifact.txt");
				yield* fs.writeFileString(artifactPath, "granted inline artifact");
				const compiled = yield* compiler.compile(grantedInlineDefinitionSource);
				expect(compiled.manifest.capabilities).toEqual(
					expect.arrayContaining(["artifact-read", "getCachedValue"]),
				);
				const settled: Array<ReadonlyArray<unknown>> = [];
				const runGranted = (executionId: string, named: boolean) =>
					service.run({
						...makeRunInput(compiled, executionId, { named }, uploaderId, { artifactPath }),
						replayJournal: [],
						workflowExecutionId: `${executionId}-workflow`,
						inlineDurableHost: {
							capabilities: ["getCachedValue"],
							settle: (requests) =>
								Effect.sync(() => {
									settled.push(requests);
									return requests.map(() => ({ value: "settled", state: "success" as const }));
								}),
						},
					});

				const [inlineExecutionId = "", namedExecutionId = ""] = executionIds;
				const inline = yield* runGranted(inlineExecutionId, false);
				expect(inline).toMatchObject({
					success: true,
					value: {
						state: "completed",
						output: { named: null, cached: "settled", artifact: "granted inline artifact" },
					},
				});
				expect(inline.inline).toHaveLength(1);
				expect(settled).toEqual([
					[
						{
							index: 0,
							kind: "host",
							name: "getCachedValue",
							args: { args: ["inline-key"], capability: "getCachedValue" },
						},
					],
				]);

				const named = yield* runGranted(namedExecutionId, true);
				expect(named).toMatchObject({
					success: true,
					value: { state: "completed", output: { named: "missing-artifact-grant" } },
				});
				expect(control.calls).toEqual([]);
			}),
		);
	});

	test.effect("integrated_isolate_has_no_ambient_authority", () => {
		const uploaderId = UserId.make(testExecutionId("native-service-uploader"));
		const executionId = testExecutionId("native-service-ambient-authority");
		const fullExecutionId = testExecutionId("native-service-ambient-full");
		return withRecoveryCleanup(
			[executionId, fullExecutionId],
			Effect.gen(function* () {
				const compiled = yield* (yield* SandboxCompiler).compile(neighbourDefinitionSource);
				const { kind, name, slug } = compiled.manifest;
				const javascript = ambientAuthorityModule({ kind, name, slug });
				const result = yield* (yield* SandboxService).run(
					makeRunInput(
						{ ...compiled, javascript, manifest: { ...compiled.manifest, runtimeImports: [] } },
						executionId,
						{},
						uploaderId,
					),
				);
				expect(result).toMatchObject({ value: [], success: true });
				const full = yield* (yield* SandboxService).run(
					makeRunInput(
						{
							...compiled,
							javascript,
							manifest: {
								...compiled.manifest,
								runtimeImports: ["@ryot-app/sandbox-sdk/youtubei"],
							},
						},
						fullExecutionId,
						{},
						uploaderId,
					),
				);
				expect(full).toMatchObject({
					success: true,
					value: ["global:fetch", "global:Request", "global:Response"],
				});
			}),
		);
	});
});
