import { Schema } from "effect";

import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunAttemptId,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";

const nonEmpty = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const natural = Schema.Number.pipe(
	Schema.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0)),
);
const positive = natural.pipe(Schema.check(Schema.isGreaterThan(0)));
const properties = Schema.Record(Schema.String, JsonValue);
const projectionName = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
const uniqueProjectionNames = Schema.Array(projectionName).pipe(
	Schema.check(
		Schema.makeFilter(
			(names) => new Set(names).size === names.length || "Expected unique projection names",
		),
	),
);

const compareProperty = strictStruct({
	property: projectionName,
	equality: Schema.Literals(["json", "unordered-array"]),
});
const uniqueCompareProperties = Schema.Array(compareProperty).pipe(
	Schema.check(
		Schema.makeFilter(
			(entries) =>
				new Set(entries.map(({ property }) => property)).size === entries.length ||
				"Expected unique compared properties",
		),
	),
);
const comparedPropertiesProjection = strictStruct({
	properties: uniqueProjectionNames,
	compareProperties: uniqueCompareProperties,
});
const projectionWithParentEntity = strictStruct({
	...comparedPropertiesProjection.fields,
	parentEntityProperties: uniqueProjectionNames,
});
const atLeastOneProjection = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	strictStruct(fields).pipe(
		Schema.check(
			Schema.makeFilter(
				(projection) =>
					Object.values(projection).some((value) => value !== undefined) ||
					"Expected at least one input projection resource",
			),
		),
	);

export const AutomationAfterInputProjection = atLeastOneProjection({
	entity: Schema.optional(projectionWithParentEntity),
	event: Schema.optional(comparedPropertiesProjection),
	relationship: Schema.optional(projectionWithParentEntity),
	providerEntityImport: Schema.optional(Schema.Literal(true)),
	signal: Schema.optional(strictStruct({ properties: uniqueProjectionNames })),
});
export type AutomationAfterInputProjection = typeof AutomationAfterInputProjection.Type;
const policyResourceProjection = strictStruct({ properties: uniqueProjectionNames });
export const AutomationPolicyInputProjection = atLeastOneProjection({
	event: Schema.optional(policyResourceProjection),
	entity: Schema.optional(policyResourceProjection),
	relationship: Schema.optional(policyResourceProjection),
});
export type AutomationPolicyInputProjection = typeof AutomationPolicyInputProjection.Type;

export const AutomationSource = Schema.Literals([
	"api",
	"import",
	"integration",
	"bootstrap",
	"provider-refresh",
	"automation",
]);
export type AutomationSource = typeof AutomationSource.Type;
export const AutomationInitiator = Schema.Union([
	strictStruct({ id: UserId, kind: Schema.Literal("user") }),
	strictStruct({ id: IntegrationId, kind: Schema.Literal("integration") }),
	strictStruct({ id: Schema.NullOr(nonEmpty), kind: Schema.Literal("system") }),
]);
export type AutomationInitiator = typeof AutomationInitiator.Type;
export const AutomationCausation = strictStruct({
	depth: natural,
	source: AutomationSource,
	initiator: AutomationInitiator,
	executionId: AutomationExecutionId,
	rootExecutionId: AutomationExecutionId,
	importRunId: Schema.optional(ImportRunId),
	parentRunId: Schema.NullOr(AutomationRunId),
	integrationId: Schema.optional(IntegrationId),
	parentTriggerId: Schema.NullOr(AutomationTriggerId),
	providerExecutionId: Schema.optional(AutomationExecutionId),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				((value.source !== "automation" ||
					(value.parentRunId !== null && value.parentTriggerId !== null && value.depth > 0)) &&
					(value.parentRunId === null || value.parentTriggerId !== null)) ||
				"Automation causation requires trusted parentage and positive depth",
		),
	),
);
export type AutomationCausation = typeof AutomationCausation.Type;

export const AutomationRetryPolicy = strictStruct({
	externalIdempotency: Schema.Literals(["none", "run-id"]),
	maxAttempts: positive.pipe(Schema.check(Schema.isLessThanOrEqualTo(10))),
	maxDelayMs: positive.pipe(Schema.check(Schema.isLessThanOrEqualTo(86_400_000))),
	initialDelayMs: positive.pipe(Schema.check(Schema.isLessThanOrEqualTo(3_600_000))),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(p) =>
				p.initialDelayMs <= p.maxDelayMs || "Initial retry delay must not exceed maximum delay",
		),
	),
);
export type AutomationRetryPolicy = typeof AutomationRetryPolicy.Type;
export const DEFAULT_AUTOMATION_RETRY_POLICY = {
	maxAttempts: 1,
	maxDelayMs: 60_000,
	initialDelayMs: 1_000,
	externalIdempotency: "none",
} as const satisfies AutomationRetryPolicy;

export const AutomationEntityDraft = strictStruct({
	properties,
	name: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(IsoUtcString),
	providerId: Schema.NullOr(SandboxProviderId),
});
export type AutomationEntityDraft = typeof AutomationEntityDraft.Type;
export const AutomationEntitySnapshot = strictStruct({
	...AutomationEntityDraft.fields,
	id: EntityId,
	createdAt: IsoUtcString,
	updatedAt: IsoUtcString,
});
export type AutomationEntitySnapshot = typeof AutomationEntitySnapshot.Type;

export const AutomationPopulationContext = strictStruct({
	rootPreviouslyPopulated: Schema.Boolean,
	scopeEntity: strictStruct({
		id: AutomationEntitySnapshot.fields.id,
		name: AutomationEntitySnapshot.fields.name,
		entitySchemaSlug: AutomationEntitySnapshot.fields.entitySchemaSlug,
	}),
	batch: Schema.optional(
		strictStruct({
			id: nonEmpty,
			afterCount: natural,
			beforeCount: natural,
			createdCount: natural,
			deletedCount: natural,
			updatedCount: natural,
			isLeader: Schema.Boolean,
		}),
	),
	parentEntity: Schema.optional(
		strictStruct({
			name: AutomationEntitySnapshot.fields.name,
			properties: AutomationEntitySnapshot.fields.properties,
			entitySchemaSlug: AutomationEntitySnapshot.fields.entitySchemaSlug,
		}),
	),
});
export type AutomationPopulationContext = typeof AutomationPopulationContext.Type;
export const LifecycleCommand = strictStruct({
	itemIdentity: nonEmpty,
	occurredAt: IsoUtcString,
	causation: AutomationCausation,
	population: Schema.optional(AutomationPopulationContext),
});
export type LifecycleCommand = typeof LifecycleCommand.Type;
export const AutomationEventDraft = strictStruct({
	properties,
	entityId: EntityId,
	occurredAt: IsoUtcString,
	eventSchemaSlug: EventSchemaSlug,
	entitySchemaSlug: EntitySchemaSlug,
	sessionEntityId: Schema.NullOr(EntityId),
});
export type AutomationEventDraft = typeof AutomationEventDraft.Type;
export const AutomationEventSnapshot = strictStruct({
	...AutomationEventDraft.fields,
	id: EventId,
	createdAt: IsoUtcString,
	updatedAt: IsoUtcString,
});
export type AutomationEventSnapshot = typeof AutomationEventSnapshot.Type;
export const AutomationRelationshipDraft = strictStruct({
	properties,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});
export type AutomationRelationshipDraft = typeof AutomationRelationshipDraft.Type;
export const AutomationRelationshipSnapshot = strictStruct({
	...AutomationRelationshipDraft.fields,
	id: RelationshipId,
	createdAt: IsoUtcString,
	updatedAt: IsoUtcString,
});
export type AutomationRelationshipSnapshot = typeof AutomationRelationshipSnapshot.Type;

const mutationPayloads = <
	const Resource extends string,
	Draft extends Schema.Constraint,
	Snapshot extends Schema.Constraint,
>(
	resource: Resource,
	draft: Draft,
	snapshot: Snapshot,
) =>
	[
		strictStruct({
			draft,
			resource: Schema.Literal(resource),
			category: Schema.Literal("request"),
			operation: Schema.Literal("create"),
		}),
		strictStruct({
			draft,
			before: snapshot,
			resource: Schema.Literal(resource),
			category: Schema.Literal("request"),
			operation: Schema.Literal("update"),
		}),
		strictStruct({
			draft: snapshot,
			resource: Schema.Literal(resource),
			category: Schema.Literal("request"),
			operation: Schema.Literal("delete"),
		}),
		strictStruct({
			after: snapshot,
			category: Schema.Literal("change"),
			resource: Schema.Literal(resource),
			operation: Schema.Literal("create"),
		}),
		strictStruct({
			after: snapshot,
			before: snapshot,
			category: Schema.Literal("change"),
			resource: Schema.Literal(resource),
			operation: Schema.Literal("update"),
		}),
		strictStruct({
			before: snapshot,
			category: Schema.Literal("change"),
			resource: Schema.Literal(resource),
			operation: Schema.Literal("delete"),
		}),
	] as const;
const entityPayloads = mutationPayloads("entity", AutomationEntityDraft, AutomationEntitySnapshot);
const eventPayloads = mutationPayloads("event", AutomationEventDraft, AutomationEventSnapshot);
const relationshipPayloads = mutationPayloads(
	"relationship",
	AutomationRelationshipDraft,
	AutomationRelationshipSnapshot,
);
export const AutomationOmittedHook = strictStruct({
	hookSlug: AutomationHookSlug,
	pluginId: Schema.NullOr(PluginId),
});
export type AutomationOmittedHook = typeof AutomationOmittedHook.Type;

const eventRequestPlanningFields = {
	excludedOncePerSubjectPolicies: Schema.optional(Schema.Array(AutomationOmittedHook)),
};
export const AutomationRequestPayload = Schema.Union([
	entityPayloads[0],
	entityPayloads[1],
	entityPayloads[2],
	strictStruct({ ...eventPayloads[0].fields, ...eventRequestPlanningFields }),
	strictStruct({ ...eventPayloads[1].fields, ...eventRequestPlanningFields }),
	strictStruct({ ...eventPayloads[2].fields, ...eventRequestPlanningFields }),
	relationshipPayloads[0],
	relationshipPayloads[1],
	relationshipPayloads[2],
]);
export type AutomationRequestPayload = typeof AutomationRequestPayload.Type;
const withPopulation = <Fields extends Schema.Struct.Fields>(member: Schema.Struct<Fields>) =>
	strictStruct({ ...member.fields, population: Schema.optional(AutomationPopulationContext) });
const entityChanges = [
	withPopulation(entityPayloads[3]),
	withPopulation(entityPayloads[4]),
	withPopulation(entityPayloads[5]),
] as const;
const eventChanges = [eventPayloads[3], eventPayloads[4], eventPayloads[5]] as const;
const relationshipChanges = [
	withPopulation(relationshipPayloads[3]),
	withPopulation(relationshipPayloads[4]),
	withPopulation(relationshipPayloads[5]),
] as const;
export const AutomationEntityChangePayload = Schema.Union(entityChanges);
export type AutomationEntityChangePayload = typeof AutomationEntityChangePayload.Type;
export const AutomationEventChangePayload = Schema.Union(eventChanges);
export type AutomationEventChangePayload = typeof AutomationEventChangePayload.Type;
export const AutomationRelationshipChangePayload = Schema.Union(relationshipChanges);
export type AutomationRelationshipChangePayload = typeof AutomationRelationshipChangePayload.Type;
const AutomationProviderImportChangePayload = strictStruct({
	userId: UserId,
	entityId: EntityId,
	externalId: nonEmpty,
	providerId: SandboxProviderId,
	category: Schema.Literal("change"),
	entitySchemaSlug: EntitySchemaSlug,
	operation: Schema.Literal("complete"),
	resource: Schema.Literal("provider-entity-import"),
});
const batchChange = <
	const Resource extends "entity" | "event" | "relationship",
	Items extends Schema.Top,
>(
	resource: Resource,
	items: Items,
) =>
	strictStruct({
		resource: Schema.Literal(resource),
		category: Schema.Literal("change"),
		operation: Schema.Literal("batch"),
		items: Schema.Array(items).pipe(Schema.check(Schema.isMinLength(1))),
	});
export const AutomationBatchChangePayload = Schema.Union([
	batchChange("entity", AutomationEntityChangePayload),
	batchChange("event", AutomationEventChangePayload),
	batchChange("relationship", AutomationRelationshipChangePayload),
]);
export type AutomationBatchChangePayload = typeof AutomationBatchChangePayload.Type;
export const AutomationChangePayload = Schema.Union([
	...entityChanges,
	...eventChanges,
	...relationshipChanges,
	AutomationProviderImportChangePayload,
	...AutomationBatchChangePayload.members,
]);
export type AutomationChangePayload = typeof AutomationChangePayload.Type;
export const AutomationSignalPayload = strictStruct({
	properties,
	operation: Schema.Literal("emit"),
	category: Schema.Literal("signal"),
	resource: Schema.Literal("signal"),
	signalSchemaSlug: SignalSchemaSlug,
	actorUserId: Schema.NullOr(UserId),
	subjectEntityId: Schema.optional(EntityId),
	signalSchemaPluginId: Schema.NullOr(PluginId),
});
export type AutomationSignalPayload = typeof AutomationSignalPayload.Type;
export const AutomationAfterPayload = Schema.Union([
	AutomationChangePayload,
	AutomationSignalPayload,
]);
export type AutomationAfterPayload = typeof AutomationAfterPayload.Type;

const projectedMutationPayloads = <
	const Resource extends string,
	Draft extends Schema.Constraint,
	Snapshot extends Schema.Constraint,
>(
	resource: Resource,
	draft: Draft,
	snapshot: Snapshot,
) => {
	const payloads = mutationPayloads(resource, draft, snapshot);
	return [
		payloads[0],
		strictStruct({ ...payloads[1].fields, changedProperties: uniqueProjectionNames }),
		payloads[2],
		payloads[3],
		strictStruct({ ...payloads[4].fields, changedProperties: uniqueProjectionNames }),
		payloads[5],
	] as const;
};
const projectedEntityPayloads = projectedMutationPayloads(
	"entity",
	AutomationEntityDraft,
	AutomationEntitySnapshot,
);
const projectedEventPayloads = projectedMutationPayloads(
	"event",
	AutomationEventDraft,
	AutomationEventSnapshot,
);
const projectedRelationshipPayloads = projectedMutationPayloads(
	"relationship",
	AutomationRelationshipDraft,
	AutomationRelationshipSnapshot,
);
const projectedEventRequests = [
	strictStruct({ ...projectedEventPayloads[0].fields, ...eventRequestPlanningFields }),
	strictStruct({ ...projectedEventPayloads[1].fields, ...eventRequestPlanningFields }),
	strictStruct({ ...projectedEventPayloads[2].fields, ...eventRequestPlanningFields }),
] as const;
export const AutomationProjectedRequestPayload = Schema.Union([
	...projectedEntityPayloads.slice(0, 3),
	...projectedEventRequests,
	...projectedRelationshipPayloads.slice(0, 3),
]);
export type AutomationProjectedRequestPayload = typeof AutomationProjectedRequestPayload.Type;
const projectedEntityChanges = [
	withPopulation(projectedEntityPayloads[3]),
	withPopulation(projectedEntityPayloads[4]),
	withPopulation(projectedEntityPayloads[5]),
] as const;
const projectedEventChanges = [
	projectedEventPayloads[3],
	projectedEventPayloads[4],
	projectedEventPayloads[5],
] as const;
const projectedRelationshipChanges = [
	withPopulation(projectedRelationshipPayloads[3]),
	withPopulation(projectedRelationshipPayloads[4]),
	withPopulation(projectedRelationshipPayloads[5]),
] as const;
const projectedChanges = [
	...projectedEntityChanges,
	...projectedEventChanges,
	...projectedRelationshipChanges,
] as const;
export const AutomationProjectedBatchChangePayload = Schema.Union([
	batchChange("entity", Schema.Union(projectedEntityChanges)),
	batchChange("event", Schema.Union(projectedEventChanges)),
	batchChange("relationship", Schema.Union(projectedRelationshipChanges)),
]);
export type AutomationProjectedBatchChangePayload =
	typeof AutomationProjectedBatchChangePayload.Type;
export const AutomationProjectedAfterPayload = Schema.Union([
	...projectedChanges,
	AutomationProviderImportChangePayload,
	...AutomationProjectedBatchChangePayload.members,
	AutomationSignalPayload,
]);
export type AutomationProjectedAfterPayload = typeof AutomationProjectedAfterPayload.Type;
export const AutomationTriggerPayload = Schema.Union([
	AutomationRequestPayload,
	AutomationChangePayload,
	AutomationSignalPayload,
]);
export type AutomationTriggerPayload = typeof AutomationTriggerPayload.Type;

export const AutomationTriggerKind = Schema.Union([
	strictStruct({
		category: Schema.Literals(["request", "change"]),
		operation: Schema.Literals(["create", "update", "delete"]),
		resource: Schema.Literals(["entity", "event", "relationship"]),
	}),
	strictStruct({
		category: Schema.Literal("change"),
		operation: Schema.Literal("batch"),
		resource: Schema.Literals(["entity", "event", "relationship"]),
	}),
	strictStruct({
		category: Schema.Literal("change"),
		operation: Schema.Literal("complete"),
		resource: Schema.Literal("provider-entity-import"),
	}),
	strictStruct({
		operation: Schema.Literal("emit"),
		category: Schema.Literal("signal"),
		resource: Schema.Literal("signal"),
	}),
]);
export type AutomationTriggerKind = typeof AutomationTriggerKind.Type;

export const AutomationBlockedReason = strictStruct({
	hasRequiredHooks: Schema.Boolean,
	code: Schema.Literal("automation-limit-reached"),
	omittedHooks: Schema.Array(AutomationOmittedHook).pipe(Schema.check(Schema.isMaxLength(100))),
});
export type AutomationBlockedReason = typeof AutomationBlockedReason.Type;
export const AutomationWarning = Schema.Union([
	strictStruct({
		runId: AutomationRunId,
		hookSlug: AutomationHookSlug,
		code: Schema.Literals(["required-hook-failed", "required-hook-pending"]),
	}),
	strictStruct({ ...AutomationBlockedReason.fields, triggerId: AutomationTriggerId }),
]);
export type AutomationWarning = typeof AutomationWarning.Type;
export const AutomationTrigger = strictStruct({
	id: AutomationTriggerId,
	createdAt: IsoUtcString,
	occurredAt: IsoUtcString,
	kind: AutomationTriggerKind,
	causation: AutomationCausation,
	scopeUserId: Schema.NullOr(UserId),
	payloadPrunedAt: Schema.NullOr(IsoUtcString),
	payload: Schema.NullOr(AutomationTriggerPayload),
	blockedReason: Schema.NullOr(AutomationBlockedReason),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(trigger) =>
				trigger.payload === null ||
				(trigger.kind.category === trigger.payload.category &&
					trigger.kind.resource === trigger.payload.resource &&
					trigger.kind.operation === trigger.payload.operation) ||
				"Trigger summary must match its retained payload",
		),
	),
);
export type AutomationTrigger = typeof AutomationTrigger.Type;
export const AutomationTriggerRecipient = strictStruct({
	userId: UserId,
	triggerId: AutomationTriggerId,
});
export type AutomationTriggerRecipient = typeof AutomationTriggerRecipient.Type;
export const AutomationRunStatus = Schema.Literals([
	"queued",
	"running",
	"succeeded",
	"failed",
	"rejected",
	"skipped",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;
export const AutomationFailureKind = Schema.Literals([
	"sandbox-timeout",
	"sandbox-infrastructure",
	"resource-unavailable",
	"invalid-input",
	"invalid-output",
	"missing-artifact",
	"business-failure",
	"external-uncertain-outcome",
]);
export type AutomationFailureKind = typeof AutomationFailureKind.Type;
const automationDurationMs = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
export const AutomationRunTiming = strictStruct({
	totalMs: automationDurationMs,
	executionMs: automationDurationMs,
});
export type AutomationRunTiming = typeof AutomationRunTiming.Type;
export const AutomationRunSkipReason = strictStruct({
	code: Schema.Literals(["user-disabled", "policy-chain-stopped"]),
});
export type AutomationRunSkipReason = typeof AutomationRunSkipReason.Type;
const runFields = {
	id: AutomationRunId,
	scriptSlug: nonEmpty,
	attemptCount: natural,
	queuedAt: IsoUtcString,
	hookName: Schema.String,
	scriptContentHash: nonEmpty,
	status: AutomationRunStatus,
	hookSlug: AutomationHookSlug,
	triggerId: AutomationTriggerId,
	artifactsExpireAt: IsoUtcString,
	executionUserId: Schema.NullOr(UserId),
	startedAt: Schema.NullOr(IsoUtcString),
	finishedAt: Schema.NullOr(IsoUtcString),
	nextAttemptAt: Schema.NullOr(IsoUtcString),
	sandboxScriptId: Schema.NullOr(SandboxScriptId),
	skipReason: Schema.NullOr(AutomationRunSkipReason),
};
const runVariants = <Ownership extends Schema.Struct.Fields>(ownership: Ownership) =>
	[
		strictStruct({
			...runFields,
			...ownership,
			retryPolicy: Schema.Null,
			nextAttemptAt: Schema.Null,
			stage: Schema.Literal("before"),
			delivery: Schema.Literal("policy"),
			attemptCount: natural.pipe(Schema.check(Schema.isLessThanOrEqualTo(1))),
		}),
		strictStruct({
			...runFields,
			...ownership,
			stage: Schema.Literal("after"),
			retryPolicy: AutomationRetryPolicy,
			delivery: Schema.Literals(["required", "async"]),
		}),
	] as const;
export const AutomationRun = Schema.Union([
	...runVariants({
		pluginId: PluginId,
		pluginRevisionId: PluginRevisionId,
		pluginConfigRevisionId: PluginConfigRevisionId,
	}),
	...runVariants({
		pluginId: Schema.Null,
		pluginRevisionId: Schema.Null,
		pluginConfigRevisionId: Schema.Null,
	}),
]).pipe(
	Schema.check(
		Schema.makeFilter(
			(run) =>
				run.sandboxScriptId !== null ||
				(run.status !== "queued" && run.status !== "running" && run.nextAttemptAt === null) ||
				"Pending execution requires the exact script artifact",
		),
	),
);
export type AutomationRun = typeof AutomationRun.Type;
export const AutomationRunAttempt = strictStruct({
	runId: AutomationRunId,
	attemptNumber: positive,
	startedAt: IsoUtcString,
	retryable: Schema.Boolean,
	id: AutomationRunAttemptId,
	returnedValue: Schema.NullOr(JsonValue),
	finishedAt: Schema.NullOr(IsoUtcString),
	workflowExecutionId: AutomationExecutionId,
	timing: Schema.NullOr(AutomationRunTiming),
	artifactsPrunedAt: Schema.NullOr(IsoUtcString),
	failureKind: Schema.NullOr(AutomationFailureKind),
	status: Schema.Literals(["running", "succeeded", "failed"]),
	error: Schema.NullOr(strictStruct({ code: nonEmpty, message: Schema.String })),
	logs: Schema.NullOr(
		Schema.Array(
			strictStruct({
				message: Schema.String,
				attributes: Schema.optional(properties),
				level: Schema.Literals(["debug", "info", "warning", "error"]),
			}),
		),
	),
});
export type AutomationRunAttempt = typeof AutomationRunAttempt.Type;

export const AutomationInvocationFields = {
	runId: AutomationRunId,
	occurredAt: IsoUtcString,
	hookSlug: AutomationHookSlug,
	triggerId: AutomationTriggerId,
	causation: AutomationCausation,
	executionUserId: Schema.NullOr(UserId),
	hookMetadata: Schema.optional(JsonValue),
};
export const AutomationInput = strictStruct({
	automation: strictStruct({
		...AutomationInvocationFields,
		payload: AutomationProjectedAfterPayload,
	}),
});
export type AutomationInput = typeof AutomationInput.Type;
export const AutomationPolicyInput = strictStruct({
	automation: strictStruct({
		...AutomationInvocationFields,
		payload: AutomationProjectedRequestPayload,
	}),
});
export type AutomationPolicyInput = typeof AutomationPolicyInput.Type;
export const AutomationOutput = JsonValue;
export type AutomationOutput = typeof AutomationOutput.Type;
const policyPropertiesPatch = strictStruct({
	remove: uniqueProjectionNames,
	set: Schema.Record(projectionName, JsonValue),
}).pipe(
	Schema.check(
		Schema.makeFilter((patch) => {
			const setProperties = Object.keys(patch.set);
			if (setProperties.length === 0 && patch.remove.length === 0) {
				return "Expected a non-empty property patch";
			}
			return (
				patch.remove.every((property) => !Object.hasOwn(patch.set, property)) ||
				"Property patch set and remove entries must not overlap"
			);
		}),
	),
);
const policyDraft = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	strictStruct(fields).pipe(
		Schema.check(
			Schema.makeFilter(
				(draft) =>
					Object.values(draft).some((value) => value !== undefined) ||
					"Expected a non-empty policy draft patch",
			),
		),
	);
export const AutomationPolicyPatch = Schema.Union([
	strictStruct({
		resource: Schema.Literal("entity"),
		draft: policyDraft({
			properties: Schema.optional(policyPropertiesPatch),
			name: Schema.optional(AutomationEntityDraft.fields.name),
		}),
	}),
	strictStruct({
		resource: Schema.Literal("event"),
		draft: policyDraft({
			properties: Schema.optional(policyPropertiesPatch),
			sessionEntityId: Schema.optional(AutomationEventDraft.fields.sessionEntityId),
		}),
	}),
	strictStruct({
		resource: Schema.Literal("relationship"),
		draft: policyDraft({ properties: Schema.optional(policyPropertiesPatch) }),
	}),
]);
export type AutomationPolicyPatch = typeof AutomationPolicyPatch.Type;
export const AutomationPolicyOutput = Schema.Union([
	strictStruct({ action: Schema.Literal("allow") }),
	strictStruct({ reason: nonEmpty, action: Schema.Literal("reject") }),
	strictStruct({ patch: AutomationPolicyPatch, action: Schema.Literal("transform") }),
]);
export type AutomationPolicyOutput = typeof AutomationPolicyOutput.Type;
