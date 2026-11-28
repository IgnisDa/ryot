import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/plugin-backend-compiler/protocol";
import { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
import {
	hostFailure,
	hostSuccess,
	jsonValueSchema,
	type SandboxHostError,
} from "@ryot-app/plugin-backend-sdk/wire";
import type {
	WorkflowDurableCallRequest,
	WorkflowDurableResult,
	WorkflowHostRequest,
} from "@ryot-app/plugin-backend-sdk/workflow/protocol";
import {
	bindSandboxHostFunctions,
	decodeSandboxHostArguments,
	normalizeOptionalNull,
} from "@ryot-app/sandbox/host/bridge-adapter";
import type { SandboxInlineProgress } from "@ryot-app/sandbox/host/inline-progress";
import type { SandboxShortWait } from "@ryot-app/sandbox/host/short-wait";
import { Context, Effect, Schema } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { PluginHttpRateLimitAuthority } from "#modules/plugins/catalog/http-rate-limit-authority";
import { requireSandboxCapabilityInput } from "#modules/scripts/authorization/capabilities";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import type { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import type { SandboxHttpProgress } from "#modules/scripts/host/http-progress";
import {
	executeSandboxHttp,
	prepareSandboxHttpRequest,
	type SandboxHttpClassify,
	type SandboxHttpHop,
} from "#modules/scripts/host/runtime-host-functions";

import { infrastructureRunError } from "../executions/run-error";
import type {
	PinnedScriptExecutionWorkflowPayload,
	ScriptExecutionWorkflowPayload as ScriptExecutionWorkflowPayloadValue,
} from "../executions/workflow-payload";

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

export const durableHostFailure = (message: string, data?: JsonValue): WorkflowDurableResult => ({
	state: "failure",
	error: data === undefined ? { message } : { data, message },
});

export const sandboxHttpRedirectClassifier =
	(resolve: PluginHttpRateLimitAuthority["Service"]["resolve"]): SandboxHttpClassify =>
	(url) =>
		resolve(url).pipe(
			Effect.map((resolution) => (resolution.matched ? ("stop" as const) : ("follow" as const))),
			Effect.orElseSucceed(() => "stop" as const),
		);

export interface HostCallScope {
	readonly context: unknown;
	readonly startedAt: string;
	readonly executionId: string;
	readonly lane: ExecutionLane;
	readonly principal: ScriptExecutionPrincipal;
}

export const hostCallScopeOf = (
	payload: ScriptExecutionWorkflowPayloadValue,
	principal: ScriptExecutionPrincipal,
	executionId: string,
	startedAt: string,
): HostCallScope => ({
	principal,
	startedAt,
	executionId,
	lane: payload.lane,
	context: payload.input,
});

const loadDispatchInput = Effect.fn("loadSandboxDurableHostDispatchInput")(function* (
	request: HostRequest,
	{ lane, context, principal, startedAt, executionId }: HostCallScope,
) {
	if (
		request.name !== request.args.capability ||
		!(principal.metadata.capabilities ?? []).includes(request.args.capability)
	) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Sandbox durable host capability is not declared: ${request.args.capability}`,
		});
	}
	const input = {
		lane,
		context,
		startedAt,
		principal,
		compiledCode: "",
		workflowExecutionId: executionId,
		compiledFormat: SANDBOX_COMPILED_FORMAT,
		executionId: `${executionId}-host-${request.index}`,
	};
	yield* requireSandboxCapabilityInput(input, request.args.capability).pipe(
		Effect.mapError(
			(error) =>
				new SandboxRunError({
					kind: "script-failure",
					message: `Sandbox durable host denied: ${error.message}`,
				}),
		),
	);
	return { input };
});

export const dispatchSandboxHostActivity = Effect.fn("dispatchSandboxHostActivity")(function* (
	implementations: ScriptHostImplementations["Service"],
	request: HostRequest,
	scope: HostCallScope,
) {
	const { input } = yield* loadDispatchInput(request, scope);
	const boundFunctions = bindSandboxHostFunctions(
		{ ...implementations.runtime, ...implementations.additional },
		input,
	);
	const bound = Object.entries(boundFunctions).find(
		([capability]) => capability === request.args.capability,
	)?.[1];
	if (!bound) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Sandbox durable host capability is not bridge-callable: ${request.args.capability}`,
		});
	}
	const result = yield* bound(request.args.args).pipe(
		Effect.flatMap(decodeHostResult),
		Effect.mapError(infrastructureRunError),
	);
	return result.success
		? ({ state: "success", value: result.data } as const)
		: durableHostFailure(result.error, result.data);
});

const encodeHttpCallResult = Schema.encodeUnknownEffect(sandboxHostContracts.httpCall.result);

export const prepareSandboxDurableHttpHop = Effect.fn("prepareSandboxDurableHttpHop")(function* (
	request: HostRequest,
	scope: HostCallScope,
) {
	yield* loadDispatchInput(request, scope);
	return yield* Effect.gen(function* () {
		const [method, url, options] = yield* decodeSandboxHostArguments(
			"httpCall",
			sandboxHostContracts.httpCall,
		)(normalizeOptionalNull(request.args.args, 2)).pipe(
			Effect.mapError((error): SandboxHostError => error),
		);
		return yield* prepareSandboxHttpRequest(method, url, options);
	}).pipe(
		Effect.match({
			onSuccess: (current) => ({ current, _tag: "prepared" as const }),
			onFailure: (error) => ({
				_tag: "completed" as const,
				result: durableHostFailure(error.message, error.data),
			}),
		}),
	);
});

export const dispatchSandboxHttpHop = Effect.fn("dispatchSandboxHttpHop")(function* (
	request: HostRequest,
	scope: HostCallScope,
	current: SandboxHttpHop,
	classify: SandboxHttpClassify,
) {
	yield* loadDispatchInput(request, scope);
	const outcome = yield* executeSandboxHttp(current, classify).pipe(
		Effect.match({
			onFailure: (error) => hostFailure(error.message, error.data),
			onSuccess: (hop) => (hop._tag === "completed" ? hostSuccess(hop.result) : hop),
		}),
	);
	if ("_tag" in outcome) {
		return outcome;
	}
	const encoded = yield* encodeHttpCallResult(outcome).pipe(
		Effect.flatMap(decodeHostResult),
		Effect.mapError(infrastructureRunError),
	);
	return {
		_tag: "completed" as const,
		result: encoded.success
			? ({ state: "success", value: encoded.data } as const)
			: durableHostFailure(encoded.error, encoded.data),
	};
});

type SandboxDurableHostDispatcherValue = {
	readonly dispatch: (
		request: HostRequest,
		payload: PinnedScriptExecutionWorkflowPayload,
		principal: ScriptExecutionPrincipal,
		executionId: string,
		progress?: SandboxHttpProgress,
	) => Effect.Effect<WorkflowDurableResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	readonly settleInline: (
		requests: ReadonlyArray<WorkflowHostRequest>,
		context: unknown,
		principal: ScriptExecutionPrincipal,
		lane: ExecutionLane,
		executionId: string,
		startedAt: string,
		wait: SandboxShortWait,
		checkpoint: (progress: SandboxInlineProgress) => Effect.Effect<void>,
	) => Effect.Effect<null | ReadonlyArray<null | WorkflowDurableResult>>;
};

export class SandboxDurableHostDispatcher extends Context.Service<
	SandboxDurableHostDispatcher,
	SandboxDurableHostDispatcherValue
>()(
	"@ryot-app/kernel-backend/modules/scripts/host/durable-dispatcher/SandboxDurableHostDispatcher",
) {}
