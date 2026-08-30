import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
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
import { PluginManifest } from "../plugins/manifest";
import { EnqueueSandboxBody, SandboxScriptMetadata } from "../sandbox/schemas";

const TestSupportDiagnosticReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("invalid-request"), diagnostic: Schema.String }),
	Schema.Struct({ code: Schema.Literal("operation-failed"), diagnostic: Schema.String }),
	Schema.Struct({ code: Schema.Literal("resource-conflict"), diagnostic: Schema.String }),
	Schema.Struct({ code: Schema.Literal("resource-not-found"), diagnostic: Schema.String }),
]);

export class TestSupportBadRequest extends Schema.TaggedError<TestSupportBadRequest>()(
	"TestSupportBadRequest",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportNotFound extends Schema.TaggedError<TestSupportNotFound>()(
	"TestSupportNotFound",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportConflict extends Schema.TaggedError<TestSupportConflict>()(
	"TestSupportConflict",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportOperationFailure extends Schema.TaggedError<TestSupportOperationFailure>()(
	"TestSupportOperationFailure",
	{ reason: TestSupportDiagnosticReason },
) {}

export const TestSupportInstallSystemPluginBodyBase64 = Schema.Struct({
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, CanonicalBase64),
});

export type TestSupportInstallSystemPluginBodyBase64 =
	typeof TestSupportInstallSystemPluginBodyBase64.Type;

export const TestSupportSystemPlugin = Schema.Struct({
	slug: PluginSlug,
	icon: Schema.String,
	name: Schema.String,
	version: Schema.String,
	sourceHash: Schema.String,
	description: Schema.String,
});

export type TestSupportSystemPlugin = typeof TestSupportSystemPlugin.Type;

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

export const TestSupportSandboxReplayProjectionBody = Schema.Struct({ executionId: Schema.String });

export const TestSupportTriggerPluginCronBody = strictStruct({
	pluginSlug: PluginSlug,
	cronSlug: Schema.String,
});

export type TestSupportTriggerPluginCronBody = typeof TestSupportTriggerPluginCronBody.Type;

export const TestSupportTriggerPluginBootBody = strictStruct({
	pluginSlug: PluginSlug,
	bootSlug: Schema.String,
});

export type TestSupportTriggerPluginBootBody = typeof TestSupportTriggerPluginBootBody.Type;

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
	}),
});

export const TestSupportSandboxRuntimeMetrics = Schema.Struct({
	totalSpawned: Schema.Number,
	totalCompleted: Schema.Number,
	workerRssBytes: Schema.Number,
	backendRssBytes: Schema.Number,
	activeProcessCount: Schema.Number,
	workers: Schema.Array(Schema.Struct({ pid: Schema.Number, rssBytes: Schema.Number })),
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
