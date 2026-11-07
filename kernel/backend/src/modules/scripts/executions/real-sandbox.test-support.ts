import { BunServices } from "@effect/platform-bun";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableResult } from "@ryot-app/plugin-backend-sdk/workflow";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { SandboxStateStore } from "@ryot-app/sandbox/host/state-store";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, FileSystem, Layer, Ref } from "effect";
import { Reactivity } from "effect/reactivity";

import {
	emptySchemaScope,
	makeUserPluginRevision,
} from "#modules/scripts/authorization/principal.test-support";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { unusedSandboxHostImplementations } from "#modules/scripts/host/host-implementations.test-support";
import {
	SandboxHostCallScopeLive,
	SandboxHostConfigLive,
	SandboxHostFunctionsLive,
} from "#modules/scripts/host/sandbox-host-live";
import { SandboxCompiler } from "#modules/scripts/registry/compiler";
import { Broadcast } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { JobHandlers, JobWorkerLive } from "#platform/jobs/worker";
import { ServerRun } from "#platform/server-run";
import { implementWorkflow } from "#platform/workflow/scope";
import { user } from "#schema/tables/auth";
import { makeAppConfigLayer, testExecutionId, workflowEngineTestLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import { SandboxPluginScriptResolver } from "../registry/plugin-script-resolver";
import { SandboxRepository } from "../registry/repository";
import { SandboxWorkflowReferenceRepository } from "../registry/workflow-references";
import {
	compiledArtifactsLayer,
	unusedKernelWorkflowReferencesLayer,
} from "./fixtures.test-support";
import { SandboxReplayJobsLive } from "./queues";
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
			readonly compiled: CompiledSource;
			readonly scriptId: SandboxScriptId;
			readonly pluginRevision: ReturnType<typeof makeUserPluginRevision>;
		}>;
	}
>()(
	"@ryot-app/kernel-backend/modules/scripts/executions/real-sandbox.test-support/RealSandboxScripts",
) {}

export const realSandboxLayer = (options: { readonly hostResult?: WorkflowDurableResult } = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const temporaryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-real-sandbox-" });
			const root = yield* fs.realPath(temporaryRoot);
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
					Layer.mergeAll(
						SandboxHostConfigLive,
						SandboxHostCallScopeLive,
						SandboxStateStore.memoryLayer,
					),
				),
				Layer.provideMerge(
					Layer.succeed(ServerRun, { id: testExecutionId("real-sandbox-server") }),
				),
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
				getSchemaScope: () => Effect.succeed(emptySchemaScope),
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
				dispatch: () =>
					options.hostResult
						? Effect.succeed(options.hostResult)
						: Effect.die("Durable host dispatch is not expected"),
				settleInline: (requests) =>
					options.hostResult
						? Effect.succeed(requests.map(() => options.hostResult ?? null))
						: Effect.die("Inline host dispatch is not expected"),
			});
			const database = Layer.effectDiscard(
				Effect.flatMap(DatabaseSession, (session) =>
					session.run((db) =>
						db
							.insert(user)
							.values({
								id: realSandboxUserId,
								name: realSandboxUserId,
								email: `${realSandboxUserId}@example.test`,
							})
							.onConflictDoNothing(),
					),
				).pipe(Effect.orDie),
			).pipe(Layer.provideMerge(isolatedDatabaseLayer("real_sandbox")), Layer.provide(appConfig));
			const jobs = Layer.mergeAll(JobQueue.layer, Layer.effect(Broadcast, Broadcast.make)).pipe(
				Layer.provideMerge(database),
				Layer.provide(appConfig),
			);
			const workflowServices = Layer.mergeAll(
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
					JobWorkerLive.pipe(
						Layer.provideMerge(SandboxReplayJobsLive),
						Layer.provideMerge(JobHandlers.layer),
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
				Layer.provideMerge(workflowEngineTestLayer),
				Layer.provideMerge(workflowServices),
				Layer.provideMerge(jobs),
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
