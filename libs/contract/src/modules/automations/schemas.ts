import { Schema } from "effect";

import {
	AutomationRuleId,
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	ImportRunId,
	IntegrationId,
	RelationshipId,
	RelationshipSchemaId,
	SandboxScriptId,
	SignalId,
	SignalSchemaId,
	SubscriptionRunId,
	UserId,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";

export const AutomationOrigin = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("api") }),
	Schema.Struct({ kind: Schema.Literal("bootstrap") }),
	Schema.Struct({ kind: Schema.Literal("collection") }),
	Schema.Struct({ kind: Schema.Literal("provider_refresh") }),
	Schema.Struct({ kind: Schema.Literal("import"), importRunId: Schema.optional(ImportRunId) }),
	Schema.Struct({ kind: Schema.Literal("automation"), executionId: Schema.String }),
	Schema.Struct({
		integrationId: IntegrationId,
		kind: Schema.Literal("integration"),
		importRunId: Schema.optional(ImportRunId),
	}),
);

export type AutomationOrigin = typeof AutomationOrigin.Type;

export const AutomationPrincipal = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("system") }),
	Schema.Struct({ kind: Schema.Literal("user"), userId: UserId }),
);

export type AutomationPrincipal = typeof AutomationPrincipal.Type;

export const AutomationRuleKind = Schema.Literal("policy", "subscription");

export type AutomationRuleKind = typeof AutomationRuleKind.Type;

export const AutomationRuleOperation = Schema.Literal("create", "update", "delete", "signal");

export type AutomationRuleOperation = typeof AutomationRuleOperation.Type;

export const AutomationRuleTarget = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("entity"), id: EntitySchemaId }),
	Schema.Struct({ kind: Schema.Literal("event"), id: EventSchemaId }),
	Schema.Struct({ kind: Schema.Literal("relationship"), id: RelationshipSchemaId }),
	Schema.Struct({ kind: Schema.Literal("signal"), id: SignalSchemaId }),
);

export type AutomationRuleTarget = typeof AutomationRuleTarget.Type;

export const SubscriptionRunStatus = Schema.Literal(
	"queued",
	"running",
	"succeeded",
	"failed",
	"skipped",
);

export type SubscriptionRunStatus = typeof SubscriptionRunStatus.Type;

export const SignalAudiencePolicy = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("actor") }),
	Schema.Struct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaId: RelationshipSchemaId,
		subjectSide: Schema.Literal("source", "target"),
	}),
);

export type SignalAudiencePolicy = typeof SignalAudiencePolicy.Type;

export const SignalSchema = Schema.Struct({
	id: SignalSchemaId,
	slug: Schema.String,
	name: Schema.String,
	isBuiltin: Schema.Boolean,
	propertiesSchema: AppSchema,
	audiencePolicy: SignalAudiencePolicy,
	catalogState: Schema.Literal("active", "hidden"),
	archivedAt: Schema.NullOr(Schema.DateTimeUtc),
});

export type SignalSchema = typeof SignalSchema.Type;

export const SignalSnapshot = Schema.Struct({
	id: SignalId,
	origin: AutomationOrigin,
	occurredAt: Schema.DateTimeUtc,
	createdAt: Schema.DateTimeUtc,
	actorUserId: Schema.NullOr(UserId),
	subjectEntityId: Schema.NullOr(EntityId),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	schema: Schema.Struct({ id: SignalSchemaId, slug: Schema.String, name: Schema.String }),
});

export type SignalSnapshot = typeof SignalSnapshot.Type;

export const EntitySnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export const EventSnapshot = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	entityName: Schema.String,
	eventSchemaId: EventSchemaId,
	entitySchemaId: EntitySchemaId,
	eventSchemaSlug: Schema.String,
	occurredAt: Schema.DateTimeUtc,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.NullOr(EntityId),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const RelationshipEndpointSnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

export const RelationshipSnapshot = Schema.Struct({
	id: RelationshipId,
	source: RelationshipEndpointSnapshot,
	target: RelationshipEndpointSnapshot,
	relationshipSchemaSlug: Schema.String,
	relationshipSchemaId: RelationshipSchemaId,
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type RelationshipSnapshot = typeof RelationshipSnapshot.Type;

export const AutomationContext = Schema.Struct({
	ruleId: AutomationRuleId,
	origin: AutomationOrigin,
	occurrenceId: Schema.String,
	operation: AutomationRuleOperation,
	committedAt: Schema.optional(Schema.DateTimeUtc),
	rootPreviouslyPopulated: Schema.optional(Schema.Boolean),
	automationDepth: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	source: Schema.Union(
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
	),
	scopeEntity: Schema.optional(
		Schema.Struct({
			id: EntityId,
			name: Schema.String,
			entitySchemaId: EntitySchemaId,
			entitySchemaSlug: Schema.String,
		}),
	),
	owningSeason: Schema.optional(
		Schema.Struct({ name: Schema.NullOr(Schema.String), number: Schema.NullOr(Schema.Number) }),
	),
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

export type AutomationContext = typeof AutomationContext.Type;

export const EmitSignalPayload = Schema.Struct({
	signalSchemaId: SignalSchemaId,
	subjectEntityId: Schema.optional(EntityId),
	effectKey: Schema.String.pipe(Schema.minLength(1)),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type EmitSignalPayload = typeof EmitSignalPayload.Type;

export const SendNotificationPayload = Schema.Struct({
	message: Schema.String.pipe(Schema.minLength(1)),
	effectKey: Schema.String.pipe(Schema.minLength(1)),
});

export type SendNotificationPayload = typeof SendNotificationPayload.Type;

export const SubscriptionExecutionPayload = Schema.Struct({
	runId: SubscriptionRunId,
	ruleId: AutomationRuleId,
	executionId: Schema.String,
	correlationId: Schema.String,
	automation: AutomationContext,
	executionUserId: Schema.NullOr(UserId),
});

export type SubscriptionExecutionPayload = typeof SubscriptionExecutionPayload.Type;

export const AutomationRuleSnapshot = Schema.Struct({
	name: Schema.String,
	kind: AutomationRuleKind,
	target: AutomationRuleTarget,
	sandboxScriptId: SandboxScriptId,
	operation: AutomationRuleOperation,
	effectiveHostFunctions: Schema.Array(Schema.String),
	metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type AutomationRuleSnapshot = typeof AutomationRuleSnapshot.Type;

const PublicSignalSchemaRef = Schema.Struct({
	id: SignalSchemaId,
	slug: Schema.String,
	name: Schema.String,
});

export const InstallNotificationRuleBody = Schema.Struct({
	signalSchemaId: SignalSchemaId,
});

export type InstallNotificationRuleBody = typeof InstallNotificationRuleBody.Type;

export const AutomationRuleView = Schema.Struct({
	name: Schema.String,
	id: AutomationRuleId,
	kind: AutomationRuleKind,
	isActive: Schema.Boolean,
	isBuiltin: Schema.Boolean,
	target: AutomationRuleTarget,
	createdAt: Schema.DateTimeUtc,
	updatedAt: Schema.DateTimeUtc,
	sandboxScriptId: SandboxScriptId,
	operation: AutomationRuleOperation,
	metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type AutomationRuleView = typeof AutomationRuleView.Type;

export const CreateRuleBody = Schema.Struct({
	target: AutomationRuleTarget,
	sandboxScriptId: SandboxScriptId,
	name: Schema.String.pipe(Schema.minLength(1)),
	metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type CreateRuleBody = typeof CreateRuleBody.Type;

export const UpdateRuleBody = Schema.Struct({
	isActive: Schema.optional(Schema.Boolean),
	name: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
	metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type UpdateRuleBody = typeof UpdateRuleBody.Type;

export const UserSignalSchemaView = Schema.Struct({
	id: SignalSchemaId,
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	createdAt: Schema.DateTimeUtc,
	updatedAt: Schema.DateTimeUtc,
	audiencePolicy: SignalAudiencePolicy,
	archivedAt: Schema.NullOr(Schema.DateTimeUtc),
});

export type UserSignalSchemaView = typeof UserSignalSchemaView.Type;

export const CreateSignalSchemaBody = Schema.Struct({
	propertiesSchema: AppSchema,
	slug: Schema.optional(Schema.String),
	name: Schema.String.pipe(Schema.minLength(1)),
});

export type CreateSignalSchemaBody = typeof CreateSignalSchemaBody.Type;

export const RecipientSignal = Schema.Struct({
	id: SignalId,
	createdAt: Schema.DateTimeUtc,
	schema: PublicSignalSchemaRef,
	occurredAt: Schema.DateTimeUtc,
	subjectEntityId: Schema.NullOr(EntityId),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type RecipientSignal = typeof RecipientSignal.Type;

export const SignalPage = Schema.Struct({
	items: Schema.Array(RecipientSignal),
	nextCursor: Schema.NullOr(Schema.String),
});

export type SignalPage = typeof SignalPage.Type;

export const SubscriptionRunView = Schema.Struct({
	id: SubscriptionRunId,
	value: Schema.Unknown,
	queuedAt: Schema.DateTimeUtc,
	status: SubscriptionRunStatus,
	originalRuleId: AutomationRuleId,
	operation: AutomationRuleOperation,
	logs: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	ruleId: Schema.NullOr(AutomationRuleId),
	startedAt: Schema.NullOr(Schema.DateTimeUtc),
	finishedAt: Schema.NullOr(Schema.DateTimeUtc),
	timing: Schema.NullOr(Schema.Struct({ totalMs: Schema.Number, executionMs: Schema.Number })),
	skippedReason: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type SubscriptionRunView = typeof SubscriptionRunView.Type;

export const SubscriptionRunPage = Schema.Struct({
	nextCursor: Schema.NullOr(Schema.String),
	items: Schema.Array(SubscriptionRunView),
});

export type SubscriptionRunPage = typeof SubscriptionRunPage.Type;

export const CatalogSignalSchema = Schema.Struct({
	id: SignalSchemaId,
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	catalogState: Schema.Literal("active"),
});

export type CatalogSignalSchema = typeof CatalogSignalSchema.Type;

export const ListSignalsParams = Schema.Struct({
	cursor: Schema.optional(Schema.String),
	signalSchemaId: Schema.optional(SignalSchemaId),
	pageSize: Schema.optionalWith(Schema.NumberFromString, { default: () => 50 }),
});

export type ListSignalsParams = typeof ListSignalsParams.Type;

export const ListRunsParams = Schema.Struct({
	cursor: Schema.optional(Schema.String),
	ruleId: Schema.optional(AutomationRuleId),
	status: Schema.optional(SubscriptionRunStatus),
	pageSize: Schema.optionalWith(Schema.NumberFromString, { default: () => 50 }),
});

export type ListRunsParams = typeof ListRunsParams.Type;
