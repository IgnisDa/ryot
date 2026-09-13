import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import { httpCallArgsSchema, sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowDurableCallRequest,
	type WorkflowDurableResult,
	workflowDurableResultSchema,
	workflowHostRequestSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Context, Effect, Option, Schema } from "effect";
import { Workflow } from "effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	bindSandboxHostFunctions,
	decodeSandboxHostArguments,
} from "#lib/infrastructure/sandbox-runtime/bridge-adapter";
import { isSandboxCapability } from "#lib/infrastructure/sandbox-runtime/capability-policy";
import {
	SandboxExecutionPrincipal,
	type SandboxExecutionPrincipal as SandboxExecutionPrincipalValue,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { SANDBOX_JSON_GRAPH_FACTOR } from "#lib/infrastructure/sandbox-runtime/json-bytes";
import { KiB, SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	requireSandboxCapabilityInput,
	sandboxLifecycleCommand,
	sandboxRunUserId,
} from "#lib/infrastructure/sandbox-runtime/shared";

import {
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

const failure = (message: string, data?: JsonValue): WorkflowDurableResult => ({
	state: "failure",
	error: data === undefined ? { message } : { data, message },
});

export type SandboxDurableHostDispatchStrategy =
	| "activity"
	| "diagnostic"
	| "event-workflow"
	| "service-workflow"
	| "lifecycle-workflow"
	| "notification-workflow";

export const SANDBOX_DURABLE_HOST_DISPATCH = {
	log: "diagnostic",
	span: "diagnostic",
	httpCall: "activity",
	executeRyotql: "activity",
	getCachedValue: "activity",
	setCachedValue: "activity",
	getPluginConfig: "activity",
	getUserSettings: "activity",
	getEntitySchemas: "activity",
	listEventSchemas: "activity",
	listIntegrations: "activity",
	getPersistentValue: "activity",
	createEvents: "event-workflow",
	getUserPreferences: "activity",
	emitSignal: "service-workflow",
	getOAuthAccessToken: "activity",
	claimPersistentValue: "activity",
	getCurrentIntegration: "activity",
	requestEventStreamWork: "activity",
	deleteEvents: "lifecycle-workflow",
	updateEvents: "lifecycle-workflow",
	invalidateOAuthAccessToken: "activity",
	ensureUserEntities: "service-workflow",
	sendNotification: "notification-workflow",
	upsertGlobalEntities: "lifecycle-workflow",
	changeUserRelationships: "lifecycle-workflow",
	upsertGlobalRelationships: "lifecycle-workflow",
} as const satisfies Record<keyof typeof sandboxHostContracts, SandboxDurableHostDispatchStrategy>;

// Retained backend memory of a capability's result, bounded before the result materializes; `null`
// marks results only the workflow body may hold.
export const SANDBOX_HOST_RESULT_BYTES = {
	log: KiB,
	span: KiB,
	emitSignal: null,
	createEvents: null,
	deleteEvents: null,
	updateEvents: null,
	setCachedValue: KiB,
	getPluginConfig: null,
	getUserSettings: null,
	getEntitySchemas: null,
	listEventSchemas: null,
	listIntegrations: null,
	sendNotification: null,
	getUserPreferences: KiB,
	ensureUserEntities: null,
	getOAuthAccessToken: null,
	upsertGlobalEntities: null,
	getCurrentIntegration: null,
	requestEventStreamWork: KiB,
	changeUserRelationships: null,
	upsertGlobalRelationships: null,
	invalidateOAuthAccessToken: KiB,
	httpCall: 2 * SANDBOX_LIMITS.http.responseBytes,
	executeRyotql: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.ryotqlResultBytes,
	getCachedValue: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.cache.valueBytes,
	getPersistentValue: SANDBOX_JSON_GRAPH_FACTOR * (SANDBOX_LIMITS.cache.valueBytes + KiB),
	claimPersistentValue: SANDBOX_JSON_GRAPH_FACTOR * (SANDBOX_LIMITS.cache.valueBytes + KiB),
} as const satisfies Record<keyof typeof sandboxHostContracts, number | null>;

export const sandboxDurableHostDispatchStrategy = (capability: SandboxHostCapability) => {
	if (capability === "artifact-read" || capability === "scratch") {
		return null;
	}
	return SANDBOX_DURABLE_HOST_DISPATCH[capability];
};

export const sandboxHostResultBytes = (capability: SandboxHostCapability) => {
	if (capability === "artifact-read" || capability === "scratch") {
		return null;
	}
	return SANDBOX_HOST_RESULT_BYTES[capability];
};

/**
 * Declared capabilities whose durable calls a live replay may settle inline: plain activities that
 * neither start workflows nor need another sandbox execution slot, with results bounded before they
 * materialize.
 */
export const sandboxInlineDurableCapabilities = (principal: SandboxExecutionPrincipalValue) =>
	(principal.metadata.capabilities ?? []).filter(
		(capability): capability is SandboxHostCapability =>
			isSandboxCapability(capability) &&
			sandboxDurableHostDispatchStrategy(capability) === "activity" &&
			sandboxHostResultBytes(capability) !== null,
	);

export const sandboxDurableHttpRequestUrl = (request: HostRequest) =>
	Option.getOrNull(
		Option.map(
			Schema.decodeUnknownOption(httpCallArgsSchema)(request.args.args),
			(args) => args[1],
		),
	);

const loadDispatchInput = Effect.fn("loadSandboxDurableHostDispatchInput")(function* (
	request: HostRequest,
	context: unknown,
	principal: SandboxExecutionPrincipalValue,
	lane: ExecutionLane,
	executionId: string,
	startedAt: string,
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
		compiledFormat: 1,
		workflowExecutionId: executionId,
		hostCallDiscriminator: request.index,
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

const loadPayloadDispatchInput = (
	request: HostRequest,
	payload: SandboxScriptWorkflowPayloadValue,
	principal: SandboxExecutionPrincipalValue,
	executionId: string,
	startedAt: string,
) => loadDispatchInput(request, payload.input, principal, payload.lane, executionId, startedAt);

export const dispatchSandboxHostActivity = Effect.fn("dispatchSandboxHostActivity")(function* (
	implementations: SandboxHostImplementations["Service"],
	request: HostRequest,
	context: unknown,
	principal: SandboxExecutionPrincipalValue,
	lane: ExecutionLane,
	executionId: string,
	startedAt: string,
) {
	const { input } = yield* loadDispatchInput(
		request,
		context,
		principal,
		lane,
		executionId,
		startedAt,
	);
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
		Effect.mapError(
			(error) => new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
		),
	);
	return result.success
		? ({ state: "success", value: result.data } as const)
		: failure(result.error, result.data);
});

export const prepareSandboxCreateEvents = Effect.fn("prepareSandboxCreateEvents")(function* (
	request: HostRequest,
	payload: SandboxScriptWorkflowPayloadValue,
	principal: SandboxExecutionPrincipalValue,
	executionId: string,
	startedAt: string,
) {
	const { input } = yield* loadPayloadDispatchInput(
		request,
		payload,
		principal,
		executionId,
		startedAt,
	);
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
		payload: SandboxScriptWorkflowPayloadValue,
		principal: SandboxExecutionPrincipalValue,
		executionId: string,
		startedAt: string,
	) {
		const { input } = yield* loadPayloadDispatchInput(
			request,
			payload,
			principal,
			executionId,
			startedAt,
		);
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
	function* (
		request: HostRequest,
		payload: SandboxScriptWorkflowPayloadValue,
		principal: SandboxExecutionPrincipalValue,
		executionId: string,
		startedAt: string,
	) {
		const { input } = yield* loadPayloadDispatchInput(
			request,
			payload,
			principal,
			executionId,
			startedAt,
		);
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

export const SandboxDurableHostServiceWorkflowPayload = Schema.Struct({
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
			payload.sandbox.input,
			payload.principal,
			payload.sandbox.lane,
			payload.parentExecutionId,
			payload.startedAt,
		);
	},
);

export const durableHostFailure = failure;

export type SandboxDurableHostDispatcherValue = {
	readonly dispatch: (
		request: HostRequest,
		payload: SandboxScriptWorkflowPayloadValue,
		principal: SandboxExecutionPrincipalValue,
		executionId: string,
	) => Effect.Effect<WorkflowDurableResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	/**
	 * Settles a whole batch of inline-eligible calls outside the workflow body, or returns `null`
	 * when any call must be dispatched durably instead (for example a rate-limited HTTP origin).
	 */
	readonly settleInline: (
		requests: ReadonlyArray<HostRequest>,
		context: unknown,
		principal: SandboxExecutionPrincipalValue,
		lane: ExecutionLane,
		executionId: string,
		startedAt: string,
	) => Effect.Effect<ReadonlyArray<WorkflowDurableResult> | null>;
};

export class SandboxDurableHostDispatcher extends Context.Service<
	SandboxDurableHostDispatcher,
	SandboxDurableHostDispatcherValue
>()("SandboxDurableHostDispatcher") {}
