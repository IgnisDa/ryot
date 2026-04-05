import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { EnqueueSandboxBody } from "@ryot/contract/modules/sandbox/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
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
				const resolvedPayload = yield* resolveSandboxExecutionPayload({
					context,
					authority: { type: "user", userId: executingUserId },
					executionId,
					scriptId: script.id,
				}).pipe(
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

			return {
				enqueue,
				getResult,
				getStoredScript,
				listStoredScripts: () => runWithDb(repository.listStoredScripts()),
			};
		}),
	},
) {}
