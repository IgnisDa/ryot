import { Activity, DurableQueue } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { withoutWorkflowParent } from "#lib/infrastructure/workflow";

import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import { RunSandboxWorkflow } from "./sandbox-run-workflow";

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export type SandboxExecutionResolutionMode = "active" | "exact";

export const resolveSandboxExecutionPayload = Effect.fn("resolveSandboxExecutionPayload")(
	function* (payload: SandboxExecutionPayload, mode: SandboxExecutionResolutionMode) {
		if (mode === "exact") {
			return payload;
		}
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const pluginScriptResolver = yield* SandboxPluginScriptResolver;
		const pluginOwned = yield* runWithDb(repository.isPluginScript(payload.scriptId));
		if (!pluginOwned) {
			return payload;
		}

		const activeScript = yield* runWithDb(
			pluginScriptResolver.findActiveScriptById(payload.scriptId),
		);
		if (!activeScript) {
			return yield* new SandboxRunError({ message: "Sandbox script not found" });
		}
		return { ...payload, scriptId: activeScript.id };
	},
);

export const makeSandboxExecutionResolutionActivity = (payload: SandboxExecutionPayload) =>
	Activity.make({
		error: SandboxRunError,
		success: SandboxExecutionPayload,
		name: `resolve-sandbox-execution-${payload.executionId}`,
		execute: resolveSandboxExecutionPayload(payload, "active").pipe(
			Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
		),
	});

export const processSandboxExecution = (payload: SandboxExecutionPayload) =>
	makeSandboxExecutionResolutionActivity(payload).pipe(
		Effect.flatMap((resolved) =>
			Effect.gen(function* () {
				const engine = yield* WorkflowEngine;
				return yield* engine
					.execute(RunSandboxWorkflow, { payload: resolved, executionId: resolved.executionId })
					.pipe(withoutWorkflowParent);
			}),
		),
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
	);

export const executeSandboxExecution = Effect.fn("executeSandboxExecution")(function* (
	payload: SandboxExecutionPayload,
) {
	yield* Effect.annotateCurrentSpan({
		scriptId: payload.scriptId,
		executionId: payload.executionId,
		...("userId" in payload.authority ? { userId: payload.authority.userId } : {}),
	});
	const runWithDb = yield* DbRunner;
	const repository = yield* SandboxRepository;
	const sandbox = yield* RuntimeSandboxService;

	const script = yield* runWithDb(repository.getScript(payload.scriptId));
	if (!script) {
		return yield* new SandboxRunError({ message: "Sandbox script not found" });
	}
	const scriptIsBuiltin = !(yield* runWithDb(repository.isPluginScript(payload.scriptId)));
	const workflowExecutionId =
		script.metadata.kind === "workflow"
			? /^(.*)-replay-\d+$/.exec(payload.executionId)?.[1]
			: undefined;

	const result = yield* sandbox.run({
		scriptIsBuiltin,
		scriptId: script.id,
		context: payload.context,
		metadata: script.metadata,
		authority: payload.authority,
		contentHash: script.contentHash,
		executionId: payload.executionId,
		compiledCode: script.compiledCode,
		compiledFormat: script.compiledFormat,
		cacheNamespace: script.providerId ?? script.id,
		...(payload.grants ? { grants: payload.grants } : {}),
		...(workflowExecutionId ? { workflowExecutionId } : {}),
		allowedHostFunctions: script.metadata.capabilities ?? [],
		providerId: script.providerId ? SandboxProviderId.make(script.providerId) : null,
	});

	return {
		logs: result.logs,
		error: result.error,
		value: result.value,
		timing: result.timing,
		harvest: result.harvest,
		status: "completed" as const,
	};
});

const makeSandboxExecutionQueueWorkerLive = (concurrency: number) =>
	DurableQueue.worker(
		SandboxExecutionQueue,
		(payload) =>
			executeSandboxExecution(payload).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
			),
		{ concurrency },
	);

export const SandboxExecutionQueueWorkerLive = Layer.unwrapEffect(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);
