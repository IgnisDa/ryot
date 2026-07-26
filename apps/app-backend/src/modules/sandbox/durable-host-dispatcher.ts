import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { sandboxHostContracts } from "@ryot/sandbox-sdk/core";
import { type JsonValue, jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import type { WorkflowDurableCallRequest, WorkflowDurableResult } from "@ryot/sandbox-sdk/workflow";
import { Context, Effect, Schema } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import { bindSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/bridge-adapter";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";

import { SandboxRepository } from "./repository";
import type { SandboxScriptWorkflowPayload } from "./sandbox-script-workflow";

type HostRequest = Extract<WorkflowDurableCallRequest, { readonly kind: "host" }>;

const decodeHostResult = Schema.decodeUnknownEffect(
	Schema.Union([
		Schema.Struct({ data: jsonValueSchema, success: Schema.Literal(true) }),
		Schema.Struct({
			error: Schema.String,
			success: Schema.Literal(false),
			data: Schema.optional(jsonValueSchema),
		}),
	]),
);

const failure = (message: string, data?: JsonValue): WorkflowDurableResult => ({
	state: "failure",
	error: data === undefined ? { message } : { message, data },
});

const loadDispatchInput = Effect.fn("loadSandboxDurableHostDispatchInput")(function* (
	request: HostRequest,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	startedAt: string,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* SandboxRepository;
	const script = yield* runWithDb(repository.getScript(payload.scriptId)).pipe(
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
	);
	if (!script) {
		return yield* new SandboxRunError({ message: "Sandbox durable host script not found" });
	}
	if (
		request.name !== request.args.capability ||
		!(script.metadata.capabilities ?? []).includes(request.args.capability)
	) {
		return yield* new SandboxRunError({
			message: `Sandbox durable host capability is not declared: ${request.args.capability}`,
		});
	}
	return {
		input: {
			startedAt,
			scriptId: script.id,
			context: payload.input,
			metadata: script.metadata,
			authority: payload.authority,
			contentHash: script.contentHash,
			workflowExecutionId: executionId,
			compiledCode: script.compiledCode,
			compiledFormat: script.compiledFormat,
			executionId: `${executionId}-host-${request.index}`,
			allowedHostFunctions: script.metadata.capabilities ?? [],
			providerId: script.providerId ? SandboxProviderId.make(script.providerId) : null,
		},
		script,
	};
});

export const dispatchSandboxHostActivity = Effect.fn("dispatchSandboxHostActivity")(function* (
	request: HostRequest,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	startedAt: string,
) {
	const { input } = yield* loadDispatchInput(request, payload, executionId, startedAt);
	const implementations = yield* SandboxHostImplementations;
	const boundFunctions = bindSandboxHostFunctions(
		{
			...implementations.runtime,
			...implementations.additional,
			...implementations.automation,
			log: () => Effect.succeed(null),
			span: () => Effect.succeed(null),
		},
		input,
	);
	const bound = Object.entries(boundFunctions).find(
		([capability]) => capability === request.args.capability,
	)?.[1];
	if (!bound) {
		return yield* new SandboxRunError({
			message: `Sandbox durable host capability is not bridge-callable: ${request.args.capability}`,
		});
	}
	const result = yield* bound(request.args.args).pipe(
		Effect.flatMap(decodeHostResult),
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
	);
	return result.success
		? ({ state: "success", value: result.data } as const)
		: failure(result.error, result.data);
});

export const prepareSandboxCreateEvents = Effect.fn("prepareSandboxCreateEvents")(function* (
	request: HostRequest,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	startedAt: string,
) {
	yield* loadDispatchInput(request, payload, executionId, startedAt);
	const args = yield* Schema.decodeUnknownEffect(sandboxHostContracts.createEvents.args)(
		request.args.args,
	).pipe(
		Effect.mapError(
			(error) =>
				new SandboxRunError({
					message: `Invalid createEvents arguments: ${unknownToMessage(error)}`,
				}),
		),
	);
	if (!("userId" in payload.authority)) {
		return yield* new SandboxRunError({ message: "createEvents requires a user authority" });
	}
	return {
		payload: args[0],
		userId: payload.authority.userId,
		executionId: `${executionId}-create-events-${request.index}`,
	};
});

export const durableHostFailure = failure;

export type SandboxDurableHostDispatcherValue = {
	readonly dispatch: (
		request: HostRequest,
		payload: SandboxScriptWorkflowPayload,
		executionId: string,
		requestIndex: number,
	) => Effect.Effect<WorkflowDurableResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

export class SandboxDurableHostDispatcher extends Context.Service<
	SandboxDurableHostDispatcher,
	SandboxDurableHostDispatcherValue
>()("SandboxDurableHostDispatcher") {}
