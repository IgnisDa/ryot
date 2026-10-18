import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Schema } from "effect";

import { SANDBOX_LIMITS } from "../protocol/limits";
import { SandboxSidecarAdmission } from "./admission";
import { SandboxExecutionAuthority } from "./authority";
import { compileTestScript } from "./compile.test-support";
import { SandboxExecutor } from "./executor";
import { makeUserPluginRevision } from "./executor.test-support";
import { encodeJson } from "./host-call-args.test-support";
import { SandboxHostCallGate } from "./host-call-gate";
import { SandboxHostFunctions } from "./host-functions";
import {
	deleteRedisKeysOnExit,
	makeSandboxHostConfigLayer,
	testExecutionId,
	testSandboxRedisLayer,
	unusedSandboxHostFunctions,
} from "./host.test-support";
import type { SandboxRunInput } from "./invocation";
import { memoryPinnedJournal } from "./pinned-journal.test-support";
import type { SandboxPrincipal } from "./principal";
import { sandboxRedisKeys } from "./redis";
import { makeUserSubject } from "./run-input.test-support";

type RecordedHostCall = {
	readonly args: ReadonlyArray<unknown>;
	readonly subject: SandboxPrincipal["subject"];
};

type NativeServiceControlValue = {
	readonly calls: Array<RecordedHostCall>;
	readonly hostStarted: Deferred.Deferred<void>;
	readonly hostCompleted: Deferred.Deferred<void>;
	readonly hostInterrupted: Deferred.Deferred<void>;
	readonly releaseHost: Deferred.Deferred<{ readonly key: string; readonly source: string }>;
};

class NativeServiceTempRoot extends Context.Service<NativeServiceTempRoot, string>()(
	"test/SandboxNativeServiceTempRoot",
) {}

class NativeServiceControl extends Context.Service<
	NativeServiceControl,
	NativeServiceControlValue
>()("test/SandboxNativeServiceControl") {}

const withRecoveryCleanup = <A, E, R>(
	executionIds: ReadonlyArray<string>,
	effect: Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		deleteRedisKeysOnExit(() => executionIds.map(sandboxRedisKeys.recovery)).pipe(
			Effect.andThen(effect),
		),
	);

const makeHostImplementations = (control: NativeServiceControlValue) =>
	unusedSandboxHostFunctions({
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
	});

const nativeServiceLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const temporaryRoot = yield* fs.makeTempDirectoryScoped({
			prefix: "ryot-sandbox-native-service-",
		});
		const root = yield* fs.realPath(temporaryRoot);
		const control: NativeServiceControlValue = {
			calls: [],
			hostStarted: yield* Deferred.make<void>(),
			hostCompleted: yield* Deferred.make<void>(),
			hostInterrupted: yield* Deferred.make<void>(),
			releaseHost: yield* Deferred.make<{ readonly key: string; readonly source: string }>(),
		};
		const dependencies = Layer.mergeAll(
			makeSandboxHostConfigLayer({ tempDirectory: root, runId: "native-service-test-run" }),
			Layer.succeed(SandboxExecutionAuthority, { resolve: (_principal) => Effect.succeed("user") }),
			Layer.succeed(SandboxHostFunctions, makeHostImplementations(control)),
			Layer.succeed(NativeServiceControl, control),
			Layer.succeed(NativeServiceTempRoot, root),
		);
		return Layer.mergeAll(SandboxExecutor.layer, ViteBuildService.layer).pipe(
			Layer.provideMerge(testSandboxRedisLayer),
			Layer.provideMerge(dependencies),
		);
	}),
).pipe(Layer.provideMerge(BunServices.layer));

const hostDefinitionSource = `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { readArtifact } from "@ryot-app/plugin-backend-sdk/filesystem";

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
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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

const encodedBytes = (value: string) => new TextEncoder().encode(value).byteLength;

const grantedInlineDefinitionSource = `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { readArtifact, readNamedArtifact } from "@ryot-app/plugin-backend-sdk/filesystem";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

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
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
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
	compiled: Effect.Success<ReturnType<typeof compileTestScript>>,
	executionId: string,
	context: unknown,
	ownerId: UserId,
	grants?: SandboxRunInput["grants"],
): SandboxRunInput => ({
	context,
	executionId,
	lane: "interactive",
	compiledFormat: compiled.format,
	compiledCode: compiled.javascript,
	startedAt: "2026-01-01T00:00:00.000Z",
	principal: {
		metadata: compiled.manifest,
		subject: makeUserSubject(ownerId),
		scriptId: SandboxScriptId.make(executionId),
		contentHash: sha256Hex(compiled.javascript),
		pluginRevision: makeUserPluginRevision({
			ownerId,
			compiledHashes: { [compiled.manifest.slug]: sha256Hex(compiled.javascript) },
		}),
	},
	...(grants === undefined ? {} : { grants }),
});

layer(nativeServiceLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"preserves definition results and host dispatch through the real native service",
		() => {
			const ownerId = UserId.make(testExecutionId("native-service-owner"));
			const successExecutionId = testExecutionId("native-service-success");
			const invalidExecutionId = testExecutionId("native-service-invalid-input");
			return withRecoveryCleanup(
				[successExecutionId, invalidExecutionId],
				Effect.gen(function* () {
					const service = yield* SandboxExecutor;
					const control = yield* NativeServiceControl;
					const compiled = yield* compileTestScript(hostDefinitionSource);
					expect(compiled.manifest.capabilities).toContain("getCachedValue");
					const input = makeRunInput(
						compiled,
						successExecutionId,
						{ count: 7, key: "shared-key" },
						ownerId,
					);
					const result = yield* service.run(input);
					const invalid = yield* service.run(
						makeRunInput(compiled, invalidExecutionId, { key: "unused", count: "wrong" }, ownerId),
					);

					expect(result).toEqual({
						logs: [],
						inline: [],
						error: null,
						harvest: null,
						success: true,
						pendingInline: [],
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
						{ args: ["shared-key"], subject: makeUserSubject(ownerId) },
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
		},
	);

	test.effect("rejects module and snapshot tampering", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const tamperedExecutionId = testExecutionId("native-service-tampered-module");
		const unsupportedExecutionId = testExecutionId("native-service-unsupported-format");
		return withRecoveryCleanup(
			[tamperedExecutionId, unsupportedExecutionId],
			Effect.gen(function* () {
				const service = yield* SandboxExecutor;
				const control = yield* NativeServiceControl;
				control.calls.length = 0;
				const compiled = yield* compileTestScript(hostDefinitionSource);
				const tamperedInput = makeRunInput(
					compiled,
					tamperedExecutionId,
					{ count: 1, key: "unused" },
					ownerId,
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
					ownerId,
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

	test.effect("requires execution-bound grants for files and HTTP", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const grantedExecutionId = testExecutionId("native-service-granted-artifact");
		const deniedExecutionId = testExecutionId("native-service-missing-artifact-grant");
		return withRecoveryCleanup(
			[grantedExecutionId, deniedExecutionId],
			Effect.gen(function* () {
				const service = yield* SandboxExecutor;
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const root = yield* NativeServiceTempRoot;
				const artifactPath = path.join(root, "trusted-artifact.txt");
				yield* fs.writeFileString(artifactPath, "trusted artifact contents");
				const compiled = yield* compileTestScript(artifactDefinitionSource);
				expect(compiled.manifest.capabilities).toContain("artifact-read");

				const granted = yield* service.run(
					makeRunInput(compiled, grantedExecutionId, {}, ownerId, { artifactPath }),
				);
				const denied = yield* service.run(makeRunInput(compiled, deniedExecutionId, {}, ownerId));
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

	test.effect("disposes cancelled isolates and preserves neighbouring executions", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const cancelledExecutionId = testExecutionId("native-service-cancelled");
		const neighbourExecutionId = testExecutionId("native-service-neighbour");
		return withRecoveryCleanup(
			[cancelledExecutionId, neighbourExecutionId],
			Effect.gen(function* () {
				const admission = yield* SandboxSidecarAdmission;
				const gate = yield* SandboxHostCallGate;
				const service = yield* SandboxExecutor;
				const control = yield* NativeServiceControl;
				control.calls.length = 0;
				for (const lane of ["interactive", "background"] as const) {
					expect(gate.transientMemory(lane).capacity).toBe(admission.plan.pools[lane]);
				}
				const blocked = yield* compileTestScript(blockedDefinitionSource);
				const neighbour = yield* compileTestScript(neighbourDefinitionSource);
				const runFiber = yield* Effect.forkChild(
					service.run(makeRunInput(blocked, cancelledExecutionId, {}, ownerId)),
				);
				const started = yield* Effect.raceFirst(
					Deferred.await(control.hostStarted).pipe(
						Effect.as({ started: true } satisfies { readonly started: true }),
					),
					Fiber.await(runFiber).pipe(
						Effect.map(
							(exit) =>
								({ exit, started: false }) satisfies {
									readonly started: false;
									readonly exit: typeof exit;
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
				expect(control.calls).toEqual([{ args: ["block"], subject: makeUserSubject(ownerId) }]);
				expect(admission.snapshot().runs).toBe(0);

				const result = yield* service.run(
					makeRunInput(neighbour, neighbourExecutionId, {}, ownerId),
				);
				expect(result).toMatchObject({ success: true, value: "fresh" });
			}),
		);
	});

	test.effect("enforces invocation context and result caps", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const executionIds: string[] = [];
		const nextExecutionId = () => {
			const executionId = testExecutionId("native-service-caps");
			executionIds.push(executionId);
			return executionId;
		};
		return withRecoveryCleanup(
			executionIds,
			Effect.gen(function* () {
				const service = yield* SandboxExecutor;
				const compiled = yield* compileTestScript(capsDefinitionSource);
				const resultBytes = 4 * 1024 * 1024;
				const contextBytes = 64 * 1024;
				const run = (context: { pad: string; unit: string; tail: number; count: number }) =>
					service.run(makeRunInput(compiled, nextExecutionId(), context, ownerId));

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

	test.effect("rejects an invocation over the request byte limit before dispatch", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const executionId = testExecutionId("native-service-request-cap");
		return withRecoveryCleanup(
			[executionId],
			Effect.gen(function* () {
				const compiled = yield* compileTestScript(capsDefinitionSource);
				const service = yield* SandboxExecutor;
				const input = makeRunInput(
					compiled,
					executionId,
					{ tail: 0, pad: "", count: 0, unit: "a" },
					ownerId,
				);

				const error = yield* Effect.flip(
					service.run({ ...input, startedAt: "x".repeat(SANDBOX_LIMITS.execution.requestBytes) }),
				);

				expect(error).toMatchObject({
					kind: "invalid-input",
					message: "Sandbox invocation exceeds its byte limit",
				});
			}),
		);
	});

	test.effect("settles granted executions inline without elevating permissions", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const executionIds = [
			testExecutionId("native-service-granted-inline"),
			testExecutionId("native-service-granted-named"),
		];
		return withRecoveryCleanup(
			executionIds,
			Effect.gen(function* () {
				const service = yield* SandboxExecutor;
				const control = yield* NativeServiceControl;
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const root = yield* NativeServiceTempRoot;
				control.calls.length = 0;
				const artifactPath = path.join(root, "granted-inline-artifact.txt");
				yield* fs.writeFileString(artifactPath, "granted inline artifact");
				const compiled = yield* compileTestScript(grantedInlineDefinitionSource);
				expect(compiled.manifest.capabilities).toEqual(
					expect.arrayContaining(["artifact-read", "getCachedValue"]),
				);
				const settled: Array<ReadonlyArray<unknown>> = [];
				const runGranted = (executionId: string, named: boolean) =>
					service.run({
						...makeRunInput(compiled, executionId, { named }, ownerId, { artifactPath }),
						lane: "background",
						replayJournal: memoryPinnedJournal([]),
						workflowExecutionId: `${executionId}-workflow`,
						inlineDurableHost: {
							cancel: () => Effect.void,
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

	test.effect("gives an integrated isolate no ambient authority", () => {
		const ownerId = UserId.make(testExecutionId("native-service-owner"));
		const executionId = testExecutionId("native-service-ambient-authority");
		const fullExecutionId = testExecutionId("native-service-ambient-full");
		return withRecoveryCleanup(
			[executionId, fullExecutionId],
			Effect.gen(function* () {
				const compiled = yield* compileTestScript(neighbourDefinitionSource);
				const { kind, name, slug } = compiled.manifest;
				const javascript = ambientAuthorityModule({ kind, name, slug });
				const result = yield* (yield* SandboxExecutor).run(
					makeRunInput(
						{ ...compiled, javascript, manifest: { ...compiled.manifest, runtimeImports: [] } },
						executionId,
						{},
						ownerId,
					),
				);
				expect(result).toMatchObject({ value: [], success: true });
				const full = yield* (yield* SandboxExecutor).run(
					makeRunInput(
						{
							...compiled,
							javascript,
							manifest: {
								...compiled.manifest,
								runtimeImports: ["@ryot-app/plugin-backend-sdk/youtubei"],
							},
						},
						fullExecutionId,
						{},
						ownerId,
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
