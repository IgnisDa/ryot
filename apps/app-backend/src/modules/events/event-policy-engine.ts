import type { SandboxRunError } from "@ryot/contract/errors";
import { badRequest, unknownToMessage } from "@ryot/contract/errors";
import {
	AutomationPolicyResult,
	AutomationProperties,
	AutomationRuleMetadata,
} from "@ryot/contract/modules/automations/schemas";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import type { EntitySchemaSlug, EventSchemaSlug } from "@ryot/contract/schema/brands";
import {
	AutomationRuleId,
	EntityId,
	SandboxScriptId,
	SubscriptionRunId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import type { AutomationPolicyInput } from "@ryot/sandbox-sdk/automation";
import { Effect, Match, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";

import { EventCreateWorkflowError, type EventCreateWorkflowPayload } from "./event-create-workflow";
import { resolveEventCreateItemScopes } from "./event-creation";

const policyFailed = (detail: string) => badRequest(`Policy failed: ${detail}`);
const invalidPolicyResultShape = "Policy returned invalid shape";

export const EventPolicyDraft = Schema.Struct({
	occurredAt: Schema.String,
	properties: AutomationProperties,
	sessionEntityId: Schema.optional(EntityId),
});

export type EventPolicyDraft = typeof EventPolicyDraft.Type;

export const PreparedEventPolicy = Schema.Struct({
	id: AutomationRuleId,
	position: Schema.Finite,
	sandboxScriptId: SandboxScriptId,
	metadata: Schema.NullOr(AutomationRuleMetadata),
});

type PolicyPreparation = {
	entityId: EntityId;
	occurredAt: string;
	propertiesSchema: AppSchema;
	eventSchemaSlug: EventSchemaSlug;
	entitySchemaSlug: EntitySchemaSlug;
	sessionEntityId?: EntityId | undefined;
	properties: typeof AutomationProperties.Type;
	policies: ReadonlyArray<typeof PreparedEventPolicy.Type>;
};

type ExecuteSandboxScript = (
	payload: SandboxExecutionPayload,
) => Effect.Effect<SandboxExecutionResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;

export const decodeEventPolicyProperties = (properties: unknown) =>
	Schema.decodeUnknownEffect(AutomationProperties)(properties).pipe(
		Effect.mapError(() => badRequest("Event properties must be JSON-serializable")),
	);

const resolvePolicyOrigin = Effect.fn(function* (payload: EventCreateWorkflowPayload) {
	if (payload.lifecycleOrigin) {
		return payload.lifecycleOrigin;
	}
	return yield* Match.value(payload.origin).pipe(
		Match.when("api", () => Effect.succeed({ kind: "api" } as const)),
		Match.when("collection", () => Effect.succeed({ kind: "api" } as const)),
		Match.when("import", () =>
			Effect.succeed({
				kind: "import" as const,
				...(payload.importRunId ? { importRunId: payload.importRunId } : {}),
			}),
		),
		Match.when("sandbox", () =>
			Effect.succeed({ kind: "automation" as const, executionId: payload.executionId }),
		),
		Match.when("integration", () =>
			payload.integrationId
				? Effect.succeed({
						kind: "integration" as const,
						integrationId: payload.integrationId,
						...(payload.importRunId ? { importRunId: payload.importRunId } : {}),
					})
				: badRequest("integrationId is required for integration event creation"),
		),
		Match.exhaustive,
	);
});

const validateEventDraft = Effect.fn("validateEventPolicyDraft")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	stepId: string,
	prepared: PolicyPreparation,
	draft: { properties: unknown; occurredAt: string; sessionEntityId?: EntityId | undefined },
) {
	return yield* Activity.make({
		error: EventCreateWorkflowError satisfies DurableSchema,
		name: `validate-policy-draft-${itemIndex}-${stepId}`,
		success: EventPolicyDraft satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const scopes = yield* resolveEventCreateItemScopes({
				userId: payload.userId,
				item: {
					entityId: prepared.entityId,
					occurredAt: draft.occurredAt,
					properties: draft.properties,
					eventSchemaSlug: prepared.eventSchemaSlug,
					sessionEntityId: draft.sessionEntityId,
				},
			});
			const parsedProperties = yield* parseAppSchemaProperties({
				kind: "Event",
				properties: draft.properties,
				propertiesSchema: prepared.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));
			return {
				sessionEntityId: scopes.sessionEntityId,
				occurredAt: scopes.occurredAt.toISOString(),
				properties: yield* decodeEventPolicyProperties(parsedProperties),
			};
		}),
	});
});

export const runEventCreatePolicies = Effect.fn(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	prepared: PolicyPreparation,
	executeSandboxScript: ExecuteSandboxScript,
) {
	const { userId } = payload;
	const policyOrigin = yield* resolvePolicyOrigin(payload);
	const steps = [...prepared.policies].sort(
		(left, right) => left.position - right.position || left.id.localeCompare(right.id),
	);
	let draft: EventPolicyDraft = {
		properties: prepared.properties,
		occurredAt: prepared.occurredAt,
		sessionEntityId: prepared.sessionEntityId,
	};

	for (const step of steps) {
		const executionId = `${payload.executionId}-policy-${itemIndex}-${step.id}`;
		const policyContext = {
			automation: {
				ruleId: step.id,
				operation: "create",
				origin: policyOrigin,
				occurrenceId: `${payload.executionId}-lifecycle-${itemIndex}`,
				...(step.metadata !== null ? { ruleMetadata: step.metadata } : {}),
				source: {
					kind: "event",
					draft: {
						entityId: prepared.entityId,
						properties: draft.properties,
						occurredAt: draft.occurredAt,
						eventSchemaSlug: prepared.eventSchemaSlug,
						entitySchemaSlug: prepared.entitySchemaSlug,
						...(draft.sessionEntityId !== undefined
							? { sessionEntityId: draft.sessionEntityId }
							: {}),
					},
				},
			},
		} satisfies AutomationPolicyInput;
		const sandboxResult = yield* executeSandboxScript({
			executionId,
			context: policyContext,
			scriptId: step.sandboxScriptId,
			authority: {
				userId,
				type: "subscription",
				subscriptionRun: {
					origin: policyOrigin,
					occurredAt: draft.occurredAt,
					id: SubscriptionRunId.make(executionId),
				},
			},
		}).pipe(Effect.mapError((error) => policyFailed(unknownToMessage(error))));

		if (sandboxResult.error) {
			return yield* policyFailed(sandboxResult.error.message);
		}
		const result = yield* Schema.decodeUnknownEffect(AutomationPolicyResult)(
			sandboxResult.value,
		).pipe(Effect.mapError(() => badRequest(invalidPolicyResultShape)));
		if (result.action === "skip") {
			return { kind: "skipped" as const, reason: result.reason };
		}
		if (result.action === "replace") {
			let sessionEntityId = draft.sessionEntityId;
			if (result.body.sessionEntityId === null) {
				sessionEntityId = undefined;
			} else if (result.body.sessionEntityId !== undefined) {
				sessionEntityId = EntityId.make(result.body.sessionEntityId);
			}
			draft = yield* validateEventDraft(payload, itemIndex, step.id, prepared, {
				sessionEntityId,
				properties: result.body.properties ?? draft.properties,
				occurredAt: result.body.occurredAt ?? draft.occurredAt,
			});
		}
	}

	return { draft, kind: "ready" as const };
});
