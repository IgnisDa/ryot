import { Schema } from "effect";

import {
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	PluginSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SignalId,
	SubscriptionRunId,
	UserId,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { SubscriptionRunStatus } from "../automations/schemas";
import { EnqueueSandboxBody, SandboxScriptMetadata } from "../sandbox/schemas";

export const TestSupportStoredSandboxScript = Schema.Struct({
	id: SandboxScriptId,
	slug: Schema.String,
	name: Schema.String,
	source: Schema.String,
	providerId: Schema.NullOr(SandboxProviderId),
	compiledCode: Schema.String,
	compiledFormat: Schema.Number,
	metadata: SandboxScriptMetadata,
});

export type TestSupportStoredSandboxScript = typeof TestSupportStoredSandboxScript.Type;

export const TestSupportEnqueueSandboxBody = strictStruct({
	...EnqueueSandboxBody.fields,
	executingUserId: UserId,
});

export type TestSupportEnqueueSandboxBody = typeof TestSupportEnqueueSandboxBody.Type;

export const TestSupportEnqueueSandboxResponse = Schema.Struct({
	jobId: Schema.String,
	executionId: Schema.String,
});

export const TestSupportSandboxReplayProjectionBody = Schema.Struct({
	executionId: Schema.String,
});

export const TestSupportTriggerPluginCronBody = strictStruct({
	pluginSlug: PluginSlug,
	cronSlug: Schema.String,
});

export type TestSupportTriggerPluginCronBody = typeof TestSupportTriggerPluginCronBody.Type;

export const TestSupportPluginCronResult = Schema.Union([
	Schema.Struct({
		pluginSlug: PluginSlug,
		cronSlug: Schema.String,
		status: Schema.Literal("notFound"),
	}),
	Schema.Struct({
		result: Schema.Unknown,
		pluginSlug: PluginSlug,
		cronSlug: Schema.String,
		executionId: Schema.String,
		status: Schema.Literals(["executed", "failed"]),
	}),
]);

export type TestSupportPluginCronResult = typeof TestSupportPluginCronResult.Type;

export const TestSupportStartWorkflowLoadGateBody = strictStruct({
	source: Schema.String,
	pluginSlug: PluginSlug,
	executingUserId: UserId,
	workflowSlug: Schema.String,
	providerId: SandboxProviderId,
	identifierPrefix: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	itemCount: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThan(0)),
		Schema.check(Schema.isLessThanOrEqualTo(1_001)),
	),
});

export type TestSupportStartWorkflowLoadGateBody = typeof TestSupportStartWorkflowLoadGateBody.Type;

export const TestSupportWorkflowLoadGateExecution = Schema.Struct({
	executionId: Schema.String,
	error: Schema.optional(Schema.String),
	output: Schema.optional(Schema.Unknown),
	status: Schema.Literals(["pending", "completed", "failed"]),
});

export const TestSupportWorkflowLoadGateRun = Schema.Struct({
	runId: ImportRunId,
	executionIds: Schema.Array(Schema.String),
});

export const TestSupportWorkflowLoadGateResult = Schema.Struct({
	runId: ImportRunId,
	executions: Schema.Array(TestSupportWorkflowLoadGateExecution),
});

export const TestSupportOperationalPressure = Schema.Struct({
	locks: Schema.Struct({ advisoryLocks: Schema.Number, waitingAdvisoryLocks: Schema.Number }),
	redis: Schema.Struct({
		maxHighWater: Schema.Number,
		projectionCount: Schema.Number,
		projectionErrors: Schema.Number,
	}),
	sandbox: Schema.Struct({
		totalExecutions: Schema.Number,
		activeExecutions: Schema.Number,
		maxActiveExecutions: Schema.Number,
	}),
	database: Schema.Struct({
		deadlocks: Schema.Number,
		totalConnections: Schema.Number,
		activeConnections: Schema.Number,
		lockWaitingConnections: Schema.Number,
		appPoolIdleConnections: Schema.Number,
		appPoolWaitingRequests: Schema.Number,
		appPoolTotalConnections: Schema.Number,
	}),
});

export const TestSupportGlobalRelationship = Schema.Struct({
	id: RelationshipId,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export const TestSupportSignal = Schema.Struct({
	id: SignalId,
	createdAt: Schema.String,
	actorUserId: Schema.NullOr(UserId),
	recipientUserIds: Schema.Array(UserId),
	subjectEntityId: Schema.NullOr(EntityId),
});

export const TestSupportSubscriptionRun = Schema.Struct({
	id: SubscriptionRunId,
	status: SubscriptionRunStatus,
});

export const TestSupportBuiltinEntitySchema = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	id: EntitySchemaSlug,
});

export const TestSupportEntityTranslation = Schema.Struct({
	language: Schema.String,
	populatedAt: Schema.String,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
});
