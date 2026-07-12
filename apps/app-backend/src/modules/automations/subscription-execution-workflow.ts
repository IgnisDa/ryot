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
	EventId,
	RelationshipId,
	RelationshipSchemaSlug,
	SignalId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const SubscriptionExecutionWorkflowError = Schema.Union([
	DbError,
	NotFound,
	BadRequest,
	SandboxRunError,
]);

const EntityReference = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

const EntitySnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
	properties: AutomationProperties,
});

const EventSnapshot = Schema.Struct({
	id: EventId,
	subject: EntityReference,
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	properties: AutomationProperties,
});

const RelationshipSnapshot = Schema.Struct({
	id: RelationshipId,
	source: EntityReference,
	target: EntityReference,
	properties: AutomationProperties,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

const SignalSnapshot = Schema.Struct({
	id: SignalId,
	origin: AutomationOrigin,
	occurredAt: Schema.String,
	signalSchemaSlug: Schema.String,
	properties: AutomationProperties,
});

const AutomationSource = Schema.Union([
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
]);

const PopulationContext = Schema.Struct({
	rootPreviouslyPopulated: Schema.Boolean,
	parentEntity: Schema.optional(
		Schema.Struct({
			name: Schema.String,
			properties: AutomationProperties,
			entitySchemaSlug: Schema.String,
		}),
	),
	scopeEntity: Schema.Struct({
		id: EntityId,
		name: Schema.String,
		entitySchemaSlug: Schema.String,
	}),
	batch: Schema.optional(
		Schema.Struct({
			id: Schema.String,
			isLeader: Schema.Boolean,
			afterCount: Schema.Finite,
			beforeCount: Schema.Finite,
			createdCount: Schema.Finite,
			deletedCount: Schema.Finite,
			updatedCount: Schema.Finite,
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

export const SubscriptionExecutionWorkflow = Workflow.make("SubscriptionExecutionWorkflow", {
	error: SubscriptionExecutionWorkflowError satisfies DurableSchema,
	success: Schema.NullOr(SubscriptionRunId) satisfies DurableSchema,
	payload: SubscriptionExecutionWorkflowPayloadSchema satisfies DurableSchema,
	idempotencyKey: ({ occurrenceId, ruleId }) => `${occurrenceId}:${ruleId}`,
});
