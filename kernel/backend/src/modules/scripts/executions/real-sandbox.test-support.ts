import { BunServices } from "@effect/platform-bun";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableResult } from "@ryot-app/plugin-backend-sdk/workflow";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, FileSystem, Layer, Redacted, Ref } from "effect";
import { PersistedQueue } from "effect/persistence";
import { Reactivity } from "effect/reactivity";

import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { makeUserPluginRevision } from "#modules/scripts/authorization/principal.test-support";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { unusedSandboxHostImplementations } from "#modules/scripts/host/host-implementations.test-support";
import {
	SandboxHostCallScopeLive,
	SandboxHostConfigLive,
	SandboxHostFunctionsLive,
	SandboxRedisLive,
} from "#modules/scripts/host/sandbox-host-live";
import { SandboxCompiler } from "#modules/scripts/registry/compiler";
import { ServerRun } from "#platform/server-run";
import { fairQueueStoreLayer } from "#platform/workflow/fair-queue-store";
import { implementWorkflow } from "#platform/workflow/scope";
import { makeAppConfigLayer, workflowEngineTestLayer } from "#testing/effect";
import { testExecutionId, testRedisServiceLayer, testRedisUrl } from "#testing/redis";

import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import { SandboxPluginScriptResolver } from "../registry/plugin-script-resolver";
import { SandboxRepository } from "../registry/repository";
import { SandboxWorkflowReferenceRepository } from "../registry/workflow-references";
import {
	compiledArtifactsLayer,
	unusedKernelWorkflowReferencesLayer,
} from "./fixtures.test-support";
import { SandboxExecutionQueueWorkerLive, sandboxLaneCapacity } from "./queues";
import { sandboxSchedulingKey } from "./scheduling-key";
import { ScriptExecutionService } from "./service";
import {
	runScriptExecutionWorkflow,
	SandboxWorkflowPinning,
	ScriptExecutionWorkflow,
} from "./workflow";

type CompiledSource = Effect.Success<ReturnType<SandboxCompiler["Service"]["compile"]>>;

export const realSandboxUserId = UserId.make("real-sandbox-user");

export class RealSandboxScripts extends Context.Service<
	RealSandboxScripts,
	{
		readonly install: (
			source: string,
		) => Effect.Effect<{
			readonly contentHash: string;
			readonly scriptId: SandboxScriptId;
			readonly compiled: CompiledSource;
			readonly pluginRevision: ReturnType<typeof makeUserPluginRevision>;
		}>;
	}
>()("test/RealSandboxScripts") {}

export const realSandboxLayer = (options: { readonly hostResult?: WorkflowDurableResult } = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const temporaryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-real-sandbox-" });
			const root = yield* fs.realPath(temporaryRoot);
			const prefix = `ryot:test:real-sandbox:${crypto.randomUUID()}:`;
			const installed = yield* Ref.make(
				new Map<
					string,
					{
						readonly compiled: CompiledSource;
						readonly pluginRevision: ReturnType<typeof makeUserPluginRevision>;
					}
				>(),
			);
			const appConfig = makeAppConfigLayer({
				sandbox: { workerConcurrency: 2 },
				fileStorage: { localTempDir: root },
				redisUrl: Redacted.make(testRedisUrl()),
			});
			const infrastructure = Layer.mergeAll(
				Layer.succeed(SandboxExecutionAuthority, {
					resolve: (_principal) => Effect.succeed("user"),
				}),
				SandboxHostFunctionsLive.pipe(
					Layer.provideMerge(
						Layer.succeed(ScriptHostImplementations, unusedSandboxHostImplementations()),
					),
				),
			).pipe(
				Layer.provideMerge(
					Layer.mergeAll(SandboxHostConfigLive, SandboxHostCallScopeLive, SandboxRedisLive),
				),
				Layer.provideMerge(
					Layer.succeed(ServerRun, { id: testExecutionId("real-sandbox-server") }),
				),
				Layer.provideMerge(testRedisServiceLayer),
				Layer.provideMerge(BunServices.layer),
				Layer.provideMerge(Reactivity.layer),
				Layer.provideMerge(appConfig),
			);
			const sandboxRuntime = Layer.mergeAll(SandboxExecutor.layer, SandboxCompiler.layer).pipe(
				Layer.provide(infrastructure),
			);
			const fileStore = ExecutionFileStore.layer.pipe(Layer.provide(infrastructure));
			const repository = Layer.succeed(SandboxRepository, {
				isPluginScript: () => Effect.succeed(true),
				resolveWorkflowCallScript: () => Effect.succeed(null),
				getScriptPin: (scriptId) =>
					Ref.get(installed).pipe(
						Effect.map((scripts) => {
							const script = scripts.get(scriptId);
							return script
								? {
										scriptId,
										providerId: null,
										metadata: script.compiled.manifest,
										pluginRevision: script.pluginRevision,
										scriptSlug: script.compiled.manifest.slug,
										contentHash: sha256Hex(script.compiled.javascript),
									}
								: null;
						}),
					),
				getScript: (scriptId) =>
					Ref.get(installed).pipe(
						Effect.map((scripts) => {
							const script = scripts.get(scriptId);
							return script
								? {
										id: scriptId,
										providerId: null,
										metadata: script.compiled.manifest,
										compiledFormat: script.compiled.format,
										compiledCode: script.compiled.javascript,
										contentHash: sha256Hex(script.compiled.javascript),
									}
								: null;
						}),
					),
			});
			const dispatcher = Layer.succeed(SandboxDurableHostDispatcher, {
				cancelInline: () => Effect.void,
				dispatch: () =>
					options.hostResult
						? Effect.succeed(options.hostResult)
						: Effect.die("Durable host dispatch is not expected"),
				settleInline: (requests) =>
					options.hostResult
						? Effect.succeed(requests.map(() => options.hostResult ?? null))
						: Effect.die("Inline host dispatch is not expected"),
			});
			const queue = PersistedQueue.layer.pipe(
				Layer.provide(
					fairQueueStoreLayer({
						prefix,
						pollInterval: "10 millis",
						flowOf: sandboxSchedulingKey,
						capacity: sandboxLaneCapacity(2),
					}),
				),
			);
			const workflowServices = Layer.mergeAll(
				mutationAdmissionTestLayer,
				repository,
				Layer.mock(SandboxPluginScriptResolver)({
					findActiveScriptById: () => Effect.succeed(null),
				}),
				Layer.mock(SandboxWorkflowReferenceRepository)({
					release: () => Effect.void,
					lockIngestionShared: () => Effect.void,
					registerInTransaction: () => Effect.succeed({ status: "registered" as const }),
				}),
			);
			const execution = implementWorkflow(ScriptExecutionWorkflow, runScriptExecutionWorkflow).pipe(
				Layer.provideMerge(
					SandboxExecutionQueueWorkerLive.pipe(
						Layer.provideMerge(compiledArtifactsLayer(repository)),
					),
				),
				Layer.provideMerge(
					Layer.mergeAll(
						dispatcher,
						unusedKernelWorkflowReferencesLayer,
						SandboxWorkflowPinning.layer,
					),
				),
				Layer.provideMerge(queue),
				Layer.provideMerge(workflowEngineTestLayer),
				Layer.provideMerge(workflowServices),
				Layer.provideMerge(fileStore),
				Layer.provideMerge(sandboxRuntime),
				Layer.provideMerge(infrastructure),
			);
			const scripts = Layer.effect(
				RealSandboxScripts,
				Effect.gen(function* () {
					const compiler = yield* SandboxCompiler;
					return {
						install: (source: string) =>
							Effect.gen(function* () {
								const compiled = yield* compiler.compile(source).pipe(Effect.orDie);
								const scriptId = SandboxScriptId.make(testExecutionId(compiled.manifest.slug));
								const contentHash = sha256Hex(compiled.javascript);
								const pluginRevision = makeUserPluginRevision({
									ownerId: realSandboxUserId,
									slug: testExecutionId("real-sandbox-plugin"),
									compiledHashes: { [compiled.manifest.slug]: contentHash },
								});
								yield* Ref.update(installed, (all) =>
									new Map(all).set(scriptId, { compiled, pluginRevision }),
								);
								return { scriptId, compiled, contentHash, pluginRevision };
							}),
					};
				}),
			).pipe(Layer.provide(sandboxRuntime));
			return Layer.mergeAll(ScriptExecutionService.layer, scripts).pipe(
				Layer.provideMerge(execution),
			);
		}),
	).pipe(Layer.provideMerge(BunServices.layer));
