import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { badRequest, notFound, SandboxRunError } from "@ryot/contract/errors";
import type {
	EnqueueSandboxBody,
	ExecutionAuthority,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId, type UserId } from "@ryot/contract/schema/brands";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { generateId } from "better-auth";
import { Effect, Redacted } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/shared/job-id";
import { trimToNull } from "#lib/shared/validation";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { resolveSandboxExecutionPayload } from "./durable-queues";
import { SandboxRepository } from "./repository";
import { RunSandboxWorkflow } from "./sandbox-run-workflow";
import { SandboxScriptWorkflow } from "./sandbox-script-workflow";
import { toSandboxRunResult } from "./sandbox-workflow-live";

const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";

export class SandboxExecutionService extends Effect.Service<SandboxExecutionService>()(
	"SandboxExecutionService",
	{
		effect: Effect.gen(function* () {
			const config = yield* AppConfig;
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* SandboxRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);

			const enqueue = Effect.fn("SandboxExecutionService.enqueue")(function* (
				executingUserId: UserId,
				payload: EnqueueSandboxBody,
			) {
				const scriptId = trimToNull(payload.scriptId);
				if (!scriptId) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				const context = payload.context ?? {};
				const contextError = sandboxContextError(context);
				if (contextError) {
					return yield* badRequest(contextError);
				}

				const script = yield* runWithDb(repository.getScript(payload.scriptId));
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				const executionId = generateId();
				const resolvedPayload = yield* resolveSandboxExecutionPayload(
					{
						context,
						authority: { type: "user", userId: executingUserId },
						executionId,
						scriptId: script.id,
					},
					"active",
				).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.catchTag("SandboxRunError", () => notFound(sandboxScriptNotFoundError)),
				);
				yield* engine
					.execute(RunSandboxWorkflow, {
						executionId,
						discard: true,
						payload: resolvedPayload,
					})
					.pipe(Effect.orDie);

				return { jobId: createWorkflowJobId(jobIdSecret, executionId, executingUserId) };
			});

			const getResult = Effect.fn("SandboxExecutionService.getResult")(function* (
				executingUserId: UserId,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				if (!resolvedJobId) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				const executionId = resolveWorkflowExecutionId(jobIdSecret, executingUserId, resolvedJobId);
				if (!executionId) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				return toSandboxRunResult(yield* engine.poll(RunSandboxWorkflow, executionId));
			});

			const getStoredScript = Effect.fn("SandboxExecutionService.getStoredScript")(function* (
				scriptId: Parameters<typeof repository.getStoredScript>[0],
			) {
				const script = yield* runWithDb(repository.getStoredScript(scriptId));
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				return script;
			});

			const resolveWorkflowScript = Effect.fn("SandboxExecutionService.resolveWorkflowScript")(
				function* (input: { pluginSlug: string; workflowSlug: string; executionId: string }) {
					return yield* Activity.make({
						error: SandboxRunError,
						success: SandboxScriptId,
						name: `resolve-plugin-workflow-${input.executionId}`,
						execute: runWithDb(
							pluginRuntime.findActiveWorkflowScript({
								pluginSlug: input.pluginSlug,
								workflowSlug: input.workflowSlug,
							}),
						).pipe(
							Effect.flatMap((script) =>
								script
									? Effect.succeed(script.id)
									: new SandboxRunError({
											message: `Plugin workflow not found: ${input.pluginSlug}/${input.workflowSlug}`,
										}),
							),
							Effect.mapError((error) =>
								error instanceof SandboxRunError
									? error
									: new SandboxRunError({ message: String(error) }),
							),
						),
					});
				},
			);

			const executeWorkflow = Effect.fn("SandboxExecutionService.executeWorkflow")(
				function* (input: {
					input: JsonValue;
					executionId: string;
					scriptId: SandboxScriptId;
					authority: ExecutionAuthority;
				}) {
					const contextError = sandboxContextError(input.input, { kind: "workflow" });
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}
					return yield* engine.execute(SandboxScriptWorkflow, {
						executionId: input.executionId,
						payload: {
							input: input.input,
							resolutionMode: "exact",
							scriptId: input.scriptId,
							authority: input.authority,
							executionId: input.executionId,
						},
					});
				},
			);

			return {
				enqueue,
				getResult,
				executeWorkflow,
				getStoredScript,
				resolveWorkflowScript,
				listStoredScripts: () => runWithDb(repository.listStoredScripts()),
			};
		}),
	},
) {}
