import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { SandboxHostCapability } from "@ryot/contract/modules/sandbox/wire";
import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { httpCallArgsSchema, sandboxHostContracts } from "@ryot/sandbox-sdk/core";
import { type JsonValue, jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import {
	type WorkflowDurableCallRequest,
	type WorkflowDurableResult,
	workflowDurableResultSchema,
	workflowHostRequestSchema,
} from "@ryot/sandbox-sdk/workflow";
import { Context, Effect, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import { bindSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/bridge-adapter";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";

import { SandboxRepository } from "./repository";
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
	error: data === undefined ? { message } : { message, data },
});

export type SandboxDurableHostDispatchStrategy =
	| "activity"
	| "diagnostic"
	| "event-workflow"
	| "service-workflow"
	| "notification-workflow";

export const SANDBOX_DURABLE_HOST_DISPATCH = {
	log: "diagnostic",
	span: "diagnostic",
	httpCall: "activity",
	executeRyotql: "activity",
	getCachedValue: "activity",
	setCachedValue: "activity",
	getPluginConfig: "activity",
	getSystemConfig: "activity",
	getEntitySchemas: "activity",
	listEventSchemas: "activity",
	listIntegrations: "activity",
	createEvents: "event-workflow",
	emitSignal: "service-workflow",
	getUserPreferences: "activity",
	claimPersistentValue: "activity",
	upsertGlobalEntities: "activity",
	getCurrentIntegration: "activity",
	changeUserRelationships: "activity",
	upsertGlobalRelationships: "activity",
	ensureUserEntities: "service-workflow",
	sendNotification: "notification-workflow",
} as const satisfies Record<keyof typeof sandboxHostContracts, SandboxDurableHostDispatchStrategy>;

export const sandboxDurableHostDispatchStrategy = (capability: SandboxHostCapability) => {
	if (capability === "artifact-read" || capability === "scratch") {
		return null;
	}
	return SANDBOX_DURABLE_HOST_DISPATCH[capability];
};

export const sandboxDurableHttpRequestUrl = (request: HostRequest) =>
	Option.getOrNull(
		Option.map(
			Schema.decodeUnknownOption(httpCallArgsSchema)(request.args.args),
			(args) => args[1],
		),
	);

const loadDispatchInput = Effect.fn("loadSandboxDurableHostDispatchInput")(function* (
	request: HostRequest,
	payload: SandboxScriptWorkflowPayloadValue,
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
	payload: SandboxScriptWorkflowPayloadValue,
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
	payload: SandboxScriptWorkflowPayloadValue,
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

export const prepareSandboxSendNotification = Effect.fn("prepareSandboxSendNotification")(
	function* (
		request: HostRequest,
		payload: SandboxScriptWorkflowPayloadValue,
		executionId: string,
		startedAt: string,
	) {
		yield* loadDispatchInput(request, payload, executionId, startedAt);
		const args = yield* Schema.decodeUnknownEffect(sandboxHostContracts.sendNotification.args)(
			request.args.args,
		).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({
						message: `Invalid sendNotification arguments: ${unknownToMessage(error)}`,
					}),
			),
		);
		if (payload.authority.type !== "subscription") {
			return yield* new SandboxRunError({
				message: "sendNotification requires a subscription authority",
			});
		}
		return {
			message: args[0],
			userId: payload.authority.userId,
			executionId: `${executionId}-send-notification-${request.index}`,
		};
	},
);

export const SandboxDurableHostServiceWorkflowPayload = Schema.Struct({
	startedAt: Schema.String,
	parentExecutionId: Schema.String,
	request: workflowHostRequestSchema,
	sandbox: SandboxScriptWorkflowPayload,
});

export const SandboxDurableHostServiceWorkflow = Workflow.make(
	"SandboxDurableHostServiceWorkflow",
	{
		error: SandboxRunError,
		success: workflowDurableResultSchema,
		payload: SandboxDurableHostServiceWorkflowPayload,
		idempotencyKey: ({ parentExecutionId, request }) =>
			`${parentExecutionId}-host-service-${request.index}`,
	},
);

export const runSandboxDurableHostServiceWorkflow = Effect.fn("SandboxDurableHostServiceWorkflow")(
	function* (payload: typeof SandboxDurableHostServiceWorkflowPayload.Type) {
		return yield* dispatchSandboxHostActivity(
			payload.request,
			payload.sandbox,
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
		executionId: string,
		requestIndex: number,
	) => Effect.Effect<WorkflowDurableResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

export class SandboxDurableHostDispatcher extends Context.Service<
	SandboxDurableHostDispatcher,
	SandboxDurableHostDispatcherValue
>()("SandboxDurableHostDispatcher") {}
