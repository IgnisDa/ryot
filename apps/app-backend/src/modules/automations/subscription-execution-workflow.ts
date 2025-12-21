import { Workflow } from "@effect/workflow";
import { BadRequest, DbError, NotFound, SandboxRunError } from "@ryot/contract/errors";
import {
	AutomationOperation,
	AutomationOrigin,
	AutomationProperties,
	SubscriptionRunSourceKind,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	RelationshipId,
	RelationshipSchemaId,
	SignalId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const SubscriptionExecutionWorkflowError = Schema.Union(
	DbError,
	NotFound,
	BadRequest,
	SandboxRunError,
);

const EntityReference = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

const EntitySnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	properties: AutomationProperties,
});

const EventSnapshot = Schema.Struct({
	id: EventId,
	subject: EntityReference,
	occurredAt: Schema.String,
	eventSchemaId: EventSchemaId,
	eventSchemaSlug: Schema.String,
	properties: AutomationProperties,
});

const RelationshipSnapshot = Schema.Struct({
	id: RelationshipId,
	source: EntityReference,
	target: EntityReference,
	properties: AutomationProperties,
	relationshipSchemaSlug: Schema.String,
	relationshipSchemaId: RelationshipSchemaId,
});

const SignalSnapshot = Schema.Struct({
	id: SignalId,
	origin: AutomationOrigin,
	occurredAt: Schema.String,
	signalSchemaSlug: Schema.String,
	properties: AutomationProperties,
});

const AutomationSource = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("signal"), signal: SignalSnapshot }),
	Schema.Struct({
		kind: Schema.Literal("entity"),
		after: Schema.optional(EntitySnapshot),
		before: Schema.optional(EntitySnapshot),
	}),
	Schema.Struct({
		kind: Schema.Literal("event"),
		after: Schema.optional(EventSnapshot),
		before: Schema.optional(EventSnapshot),
	}),
	Schema.Struct({
		kind: Schema.Literal("relationship"),
		after: Schema.optional(RelationshipSnapshot),
		before: Schema.optional(RelationshipSnapshot),
	}),
);

const PopulationContext = Schema.Struct({
	rootPreviouslyPopulated: Schema.Boolean,
	owningSeason: Schema.optional(
		Schema.Struct({ number: Schema.NullOr(Schema.Number), name: Schema.NullOr(Schema.String) }),
	),
	scopeEntity: Schema.Struct({
		id: EntityId,
		name: Schema.String,
		entitySchemaId: EntitySchemaId,
		entitySchemaSlug: Schema.String,
	}),
	batch: Schema.optional(
		Schema.Struct({
			id: Schema.String,
			isLeader: Schema.Boolean,
			afterCount: Schema.Number,
			beforeCount: Schema.Number,
			createdCount: Schema.Number,
			deletedCount: Schema.Number,
			updatedCount: Schema.Number,
		}),
	),
});

const SubscriptionExecutionWorkflowPayloadSchema = Schema.Struct({
	ruleId: AutomationRuleId,
	origin: AutomationOrigin,
	source: AutomationSource,
	occurredAt: Schema.String,
	occurrenceId: Schema.String,
	operation: AutomationOperation,
	sourceKind: SubscriptionRunSourceKind,
	rowUserId: Schema.NullOr(UserId),
	signalId: Schema.optional(SignalId),
	recordId: Schema.optional(Schema.String),
	population: Schema.optional(PopulationContext),
});

export type SubscriptionExecutionWorkflowPayload =
	typeof SubscriptionExecutionWorkflowPayloadSchema.Type;

export const SubscriptionExecutionWorkflow = Workflow.make({
	name: "SubscriptionExecutionWorkflow",
	error: SubscriptionExecutionWorkflowError,
	success: Schema.NullOr(SubscriptionRunId),
	payload: SubscriptionExecutionWorkflowPayloadSchema,
	idempotencyKey: ({ occurrenceId, ruleId }) => `${occurrenceId}:${ruleId}`,
});
