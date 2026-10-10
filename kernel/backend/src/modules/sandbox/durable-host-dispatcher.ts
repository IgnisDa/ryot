import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/sandbox-compiler/protocol";
import { httpCallArgsSchema, sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import {
	hostFailure,
	hostSuccess,
	jsonValueSchema,
	type SandboxHostError,
} from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowDurableCallRequest,
	type WorkflowDurableResult,
	type WorkflowInlineRequest,
	workflowDurableResultSchema,
	workflowHostRequestSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Context, Effect, Option, Schema } from "effect";
import { Workflow } from "effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	bindSandboxHostFunctions,
	decodeSandboxHostArguments,
	normalizeOptionalNull,
} from "#lib/infrastructure/sandbox-runtime/bridge-adapter";
import { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import type { SandboxHttpProgress } from "#lib/infrastructure/sandbox-runtime/http-progress";
import type { SandboxInlineProgress } from "#lib/infrastructure/sandbox-runtime/inline-progress";
import {
	executeSandboxHttp,
	prepareSandboxHttpRequest,
	type SandboxHttpClassify,
	type SandboxHttpRedirect,
} from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";
import {
	requireSandboxCapabilityInput,
	sandboxLifecycleCommand,
	sandboxRunUserId,
} from "#lib/infrastructure/sandbox-runtime/shared";
import type { SandboxShortWait } from "#lib/infrastructure/sandbox-runtime/short-wait";
import type { PluginHttpRateLimitAuthority } from "#modules/plugins/http-rate-limit-authority";

import { infrastructureRunError } from "./run-error";
import {
	type PinnedSandboxScriptWorkflowPayload,
	SandboxScriptWorkflowPayload,
	type SandboxScriptWorkflowPayload as SandboxScriptWorkflowPayloadValue,
} from "./sandbox-script-workflow-payload";

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

export const sandboxDurableHttpRequestUrl = (request: HostRequest) =>
	Option.getOrNull(
		Option.map(
			Schema.decodeUnknownOption(httpCallArgsSchema)(normalizeOptionalNull(request.args.args, 2)),
			(args) => args[1],
		),
	);

export const sandboxHttpRedirectClassifier =
	(resolve: PluginHttpRateLimitAuthority["Service"]["resolve"]): SandboxHttpClassify =>
	(url) =>
		resolve(url).pipe(
			Effect.map((resolution) => (resolution.matched ? ("stop" as const) : ("follow" as const))),
			Effect.orElseSucceed(() => "stop" as const),
		);

export interface HostCallScope {
	readonly context: unknown;
	readonly executionId: string;
	readonly lane: ExecutionLane;
	readonly principal: SandboxExecutionPrincipal;
	readonly startedAt: string;
}

export const hostCallScopeOf = (
	payload: SandboxScriptWorkflowPayloadValue,
	principal: SandboxExecutionPrincipal,
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
		hostCallDiscriminator: request.index,
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
	implementations: SandboxHostImplementations["Service"],
	request: HostRequest,
	scope: HostCallScope,
) {
	const { input } = yield* loadDispatchInput(request, scope);
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

/**
 * Runs one durable network activity for a matched or proven-unmatched hop: the script's request
 * when `redirect` is null, otherwise the journaled redirect it continues from.
 */
export const dispatchSandboxHttpHop = Effect.fn("dispatchSandboxHttpHop")(function* (
	request: HostRequest,
	scope: HostCallScope,
	redirect: SandboxHttpRedirect | null,
	classify: SandboxHttpClassify,
) {
	yield* loadDispatchInput(request, scope);
	const outcome = yield* Effect.gen(function* () {
		const [method, url, options] = yield* decodeSandboxHostArguments(
			"httpCall",
			sandboxHostContracts.httpCall,
		)(normalizeOptionalNull(request.args.args, 2)).pipe(
			Effect.mapError((error): SandboxHostError => error),
		);
		const next =
			redirect === null
				? yield* prepareSandboxHttpRequest(method, url, options)
				: {
						url: redirect.url,
						method: redirect.method,
						headers: redirect.headers,
						...(redirect.body === undefined ? {} : { body: redirect.body }),
					};
		return yield* executeSandboxHttp(next, {
			classify,
			hop: redirect?.hop ?? 0,
			allowInsecureConnections: options?.allowInsecureConnections,
		});
	}).pipe(
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

export const prepareSandboxCreateEvents = Effect.fn("prepareSandboxCreateEvents")(function* (
	request: HostRequest,
	scope: HostCallScope,
) {
	const { input } = yield* loadDispatchInput(request, scope);
	const { principal } = scope;
	const args = yield* Schema.decodeUnknownEffect(sandboxHostContracts.createEvents.args)(
		request.args.args,
	).pipe(
		Effect.mapError(
			(error) =>
				new SandboxRunError({
					kind: "invalid-input",
					message: `Invalid createEvents arguments: ${unknownToMessage(error)}`,
				}),
		),
	);
	const userId = sandboxRunUserId(input);
	if (userId === null) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "createEvents requires a user subject",
		});
	}
	const command = yield* sandboxLifecycleCommand(
		input,
		principal.subject.type === "user" && principal.subject.integrationId ? "integration" : "api",
		"createEvents",
	).pipe(
		Effect.mapError(
			(error) => new SandboxRunError({ kind: "script-failure", message: error.message }),
		),
	);
	return { userId, command, payload: args[0] };
});

export const prepareSandboxLifecycleHostInput = Effect.fn("prepareSandboxLifecycleHostInput")(
	function* (
		{ lifecycle }: SandboxHostImplementations["Service"],
		request: HostRequest,
		scope: HostCallScope,
	) {
		const { input } = yield* loadDispatchInput(request, scope);
		const capability = request.args.capability;
		const validateLifecycleInput = Effect.fnUntraced(function* () {
			if (capability === "upsertGlobalEntities") {
				const [items, options] = yield* decodeSandboxHostArguments(
					capability,
					sandboxHostContracts[capability],
				)(request.args.args);
				return yield* lifecycle.upsertGlobalEntities.validate(input, items, options);
			}
			if (capability === "changeUserRelationships") {
				const [batches] = yield* decodeSandboxHostArguments(
					capability,
					sandboxHostContracts[capability],
				)(request.args.args);
				return yield* lifecycle.changeUserRelationships.validate(input, batches);
			}
			if (capability === "upsertGlobalRelationships") {
				const [groups] = yield* decodeSandboxHostArguments(
					capability,
					sandboxHostContracts[capability],
				)(request.args.args);
				return yield* lifecycle.upsertGlobalRelationships.validate(input, groups);
			}
			if (capability === "updateEvents") {
				const [items] = yield* decodeSandboxHostArguments(
					capability,
					sandboxHostContracts[capability],
				)(request.args.args);
				return yield* lifecycle.updateEvents.validate(input, items);
			}
			if (capability === "deleteEvents") {
				const [eventIds] = yield* decodeSandboxHostArguments(
					capability,
					sandboxHostContracts[capability],
				)(request.args.args);
				return yield* lifecycle.deleteEvents.validate(input, eventIds);
			}
			return yield* new SandboxRunError({
				kind: "script-failure",
				message: `Sandbox durable host capability is not lifecycle-dispatchable: ${capability}`,
			});
		});
		const validated = yield* Effect.result(validateLifecycleInput());
		if (validated._tag === "Success") {
			return validated.success;
		}
		if (validated.failure instanceof SandboxRunError) {
			return yield* validated.failure;
		}
		return { _tag: "Failure" as const, message: validated.failure.message };
	},
);

export const prepareSandboxSendNotification = Effect.fn("prepareSandboxSendNotification")(
	function* (request: HostRequest, scope: HostCallScope) {
		const { input } = yield* loadDispatchInput(request, scope);
		const { principal } = scope;
		const args = yield* Schema.decodeUnknownEffect(sandboxHostContracts.sendNotification.args)(
			request.args.args,
		).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({
						kind: "invalid-input",
						message: `Invalid sendNotification arguments: ${unknownToMessage(error)}`,
					}),
			),
		);
		if (principal.subject.type !== "automation-run" || principal.subject.executionUserId === null) {
			return yield* new SandboxRunError({
				kind: "script-failure",
				message: "sendNotification requires a user automation run",
			});
		}
		return {
			message: args[0],
			userId: principal.subject.executionUserId,
			executionId: `${principal.subject.runId}-host-${input.hostCallDiscriminator}-notification`,
		};
	},
);

const SandboxDurableHostServiceWorkflowPayload = Schema.Struct({
	startedAt: Schema.String,
	parentExecutionId: Schema.String,
	request: workflowHostRequestSchema,
	principal: SandboxExecutionPrincipal,
	sandbox: SandboxScriptWorkflowPayload,
});

export const SandboxDurableHostServiceWorkflow = Workflow.make(
	"SandboxDurableHostServiceWorkflow",
	{
		error: SandboxRunError,
		success: workflowDurableResultSchema,
		payload: SandboxDurableHostServiceWorkflowPayload,
		idempotencyKey: ({ request, parentExecutionId }) =>
			`${parentExecutionId}-host-service-${request.index}`,
	},
);

export const runSandboxDurableHostServiceWorkflow = Effect.fn("SandboxDurableHostServiceWorkflow")(
	function* (payload: typeof SandboxDurableHostServiceWorkflowPayload.Type) {
		return yield* dispatchSandboxHostActivity(
			yield* SandboxHostImplementations,
			payload.request,
			hostCallScopeOf(
				payload.sandbox,
				payload.principal,
				payload.parentExecutionId,
				payload.startedAt,
			),
		);
	},
);

type SandboxDurableHostDispatcherValue = {
	readonly dispatch: (
		request: HostRequest,
		payload: PinnedSandboxScriptWorkflowPayload,
		principal: SandboxExecutionPrincipal,
		executionId: string,
		progress?: SandboxHttpProgress,
	) => Effect.Effect<WorkflowDurableResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	readonly settleInline: (
		requests: ReadonlyArray<WorkflowInlineRequest>,
		context: unknown,
		principal: SandboxExecutionPrincipal,
		lane: ExecutionLane,
		executionId: string,
		startedAt: string,
		wait: SandboxShortWait,
		checkpoint: (progress: SandboxInlineProgress) => Effect.Effect<void>,
	) => Effect.Effect<ReadonlyArray<WorkflowDurableResult | null> | null>;
	readonly cancelInline: (
		executionId: string,
		progress: ReadonlyArray<SandboxInlineProgress>,
	) => Effect.Effect<void>;
};

export class SandboxDurableHostDispatcher extends Context.Service<
	SandboxDurableHostDispatcher,
	SandboxDurableHostDispatcherValue
>()("SandboxDurableHostDispatcher") {}
