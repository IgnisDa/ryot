import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware } from "../../auth-middleware";
import {
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	PluginSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "../../schema/brands";
import {
	AutomationRun,
	AutomationRunAttempt,
	AutomationTrigger,
	AutomationTriggerRecipient,
} from "../automations/lifecycle";
import { ListedEntity } from "../entities/schemas";
import {
	InstallPluginBody,
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
	UpdatePrivatePluginBody,
} from "../plugins/schemas";
import { RelationshipScope } from "../relationships/schemas";
import { SandboxRunResult } from "../sandbox/schemas";
import {
	TestSupportBuiltinEntitySchema,
	TestSupportEntityTranslation,
	TestSupportInstallSystemPluginBodyBase64,
	TestSupportListAutomationRunAttemptsBody,
	TestSupportListAutomationRunsBody,
	TestSupportListAutomationTriggerRecipientsBody,
	TestSupportListAutomationTriggersBody,
	TestSupportSystemPlugin,
	TestSupportGlobalRelationship,
	TestSupportEnqueueSandboxBody,
	TestSupportEnqueueSandboxResponse,
	TestSupportOperationalPressure,
	BenchmarkProfileToken,
	TestSupportArmSandboxProfileBody,
	TestSupportBackendCheckpoint,
	TestSupportBackendProfileBody,
	TestSupportProviderImportPhaseSegments,
	TestSupportSandboxProfileStatus,
	TestSupportSandboxRuntimeMetrics,
	TestSupportSandboxRuntimeQuery,
	TestSupportPluginCronResult,
	TestSupportSandboxReplayProjectionBody,
	TestSupportStartWorkflowLoadGateBody,
	TestSupportStoredSandboxScript,
	TestSupportTriggerPluginCronBody,
	TestSupportWorkflowLoadGateResult,
	TestSupportWorkflowLoadGateRun,
	TestSupportBadRequest,
	TestSupportConflict,
	TestSupportNotFound,
	TestSupportOperationFailure,
} from "./schemas";

const properties = Schema.Record(Schema.String, Schema.Unknown);
const testSupportErrors = [
	TestSupportBadRequest.pipe(HttpApiSchema.status(400)),
	TestSupportNotFound.pipe(HttpApiSchema.status(404)),
	TestSupportConflict.pipe(HttpApiSchema.status(409)),
	TestSupportOperationFailure.pipe(HttpApiSchema.status(500)),
];

const CreateGlobalEntityBody = Schema.Struct({
	properties,
	name: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.optional(Schema.String),
	providerId: Schema.optional(SandboxProviderId),
	populatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const WorkflowLoadGateResultBody = Schema.Struct({
	runId: ImportRunId,
	executionIds: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
	itemCount: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThan(0)),
		Schema.check(Schema.isLessThanOrEqualTo(1_001)),
	),
});
const OperationalPressureBody = Schema.Struct({
	executionIds: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
});

const GlobalRelationshipListBody = Schema.Union([
	Schema.Struct({ type: Schema.Literal("self"), relationshipSchemaSlug: RelationshipSchemaSlug }),
	Schema.Struct({
		anchorEntityId: EntityId,
		type: Schema.Literal("anchored"),
		relationshipSchemaSlug: RelationshipSchemaSlug,
		direction: Schema.Literals(["incoming", "outgoing"]),
	}),
]);

export const TestSupportGroup = HttpApiGroup.make("testSupport")
	.annotate(OpenApi.Description, "Provides administrative operations used by integration tests")
	.add(
		HttpApiEndpoint.get("getSandboxScript", "/test-support/sandbox-scripts/:scriptId", {
			error: testSupportErrors,
			params: { scriptId: SandboxScriptId },
			success: TestSupportStoredSandboxScript,
		}).annotate(OpenApi.Description, "Gets an installed sandbox script by ID"),
	)
	.add(
		HttpApiEndpoint.get("listSandboxScripts", "/test-support/sandbox-scripts", {
			query: {},
			error: testSupportErrors,
			success: Schema.Array(TestSupportStoredSandboxScript),
		}).annotate(OpenApi.Description, "Lists installed sandbox scripts"),
	)
	.add(
		HttpApiEndpoint.post("enqueueSandbox", "/test-support/sandbox/enqueue", {
			error: testSupportErrors,
			payload: TestSupportEnqueueSandboxBody,
			success: TestSupportEnqueueSandboxResponse,
		}).annotate(OpenApi.Description, "Enqueues an installed sandbox script for a user"),
	)
	.add(
		HttpApiEndpoint.get("getSandboxResult", "/test-support/sandbox/result/:jobId", {
			error: testSupportErrors,
			success: SandboxRunResult,
			params: { jobId: Schema.String },
			query: { executingUserId: UserId },
		}).annotate(OpenApi.Description, "Returns an installed sandbox script execution result"),
	)
	.add(
		HttpApiEndpoint.post(
			"deleteSandboxReplayProjection",
			"/test-support/sandbox/replay-projection/delete",
			{
				error: testSupportErrors,
				payload: TestSupportSandboxReplayProjectionBody,
				success: Schema.Struct({ deleted: Schema.Boolean }),
			},
		).annotate(OpenApi.Description, "Deletes a sandbox workflow Redis replay projection"),
	)
	.add(
		HttpApiEndpoint.post("startWorkflowLoadGate", "/test-support/operational-gate/workflow-load", {
			error: testSupportErrors,
			success: TestSupportWorkflowLoadGateRun,
			payload: TestSupportStartWorkflowLoadGateBody,
		}).annotate(OpenApi.Description, "Starts a full-size workflow load operational gate"),
	)
	.add(
		HttpApiEndpoint.post(
			"getWorkflowLoadGateResult",
			"/test-support/operational-gate/workflow-load/result",
			{
				error: testSupportErrors,
				payload: WorkflowLoadGateResultBody,
				success: TestSupportWorkflowLoadGateResult,
			},
		).annotate(OpenApi.Description, "Returns workflow load operational gate results"),
	)
	.add(
		HttpApiEndpoint.post("sampleOperationalPressure", "/test-support/operational-gate/pressure", {
			error: testSupportErrors,
			payload: OperationalPressureBody,
			success: TestSupportOperationalPressure,
		}).annotate(OpenApi.Description, "Samples generic workflow infrastructure pressure"),
	)
	.add(
		HttpApiEndpoint.get("sampleSandboxRuntime", "/test-support/sandbox/runtime", {
			error: testSupportErrors,
			query: TestSupportSandboxRuntimeQuery,
			success: TestSupportSandboxRuntimeMetrics,
		}).annotate(OpenApi.Description, "Samples sandbox process memory and lifecycle metrics"),
	)
	.add(
		HttpApiEndpoint.get(
			"listProviderImportPhaseSegments",
			"/test-support/provider-imports/phase-segments",
			{
				error: testSupportErrors,
				success: TestSupportProviderImportPhaseSegments,
				query: { afterSequence: Schema.NumberFromString },
			},
		).annotate(OpenApi.Description, "Lists process-local provider import phase attempts"),
	)
	.add(
		HttpApiEndpoint.post("armSandboxProfile", "/test-support/benchmark/sandbox-profile", {
			error: testSupportErrors,
			success: TestSupportSandboxProfileStatus,
			payload: TestSupportArmSandboxProfileBody,
		}).annotate(OpenApi.Description, "Arms benchmark profiling for the next matching executions"),
	)
	.add(
		HttpApiEndpoint.get(
			"getSandboxProfileStatus",
			"/test-support/benchmark/sandbox-profile/:token",
			{
				error: testSupportErrors,
				params: { token: BenchmarkProfileToken },
				success: TestSupportSandboxProfileStatus,
			},
		).annotate(OpenApi.Description, "Reports benchmark sandbox profile capture status"),
	)
	.add(
		HttpApiEndpoint.post(
			"disarmSandboxProfiles",
			"/test-support/benchmark/sandbox-profile/disarm",
			{ error: testSupportErrors, success: Schema.Struct({ disarmed: Schema.Number }) },
		).annotate(OpenApi.Description, "Removes every pending benchmark sandbox profile selection"),
	)
	.add(
		HttpApiEndpoint.post("captureBackendProfile", "/test-support/benchmark/backend-profile", {
			error: testSupportErrors,
			success: TestSupportBackendCheckpoint,
			payload: TestSupportBackendProfileBody,
		}).annotate(OpenApi.Description, "Captures a benchmark-only backend memory or CPU profile"),
	)
	.add(
		HttpApiEndpoint.get(
			"countAutomationRules",
			"/test-support/users/:userId/automation-rules/count",
			{
				error: testSupportErrors,
				params: { userId: UserId },
				success: Schema.Struct({ count: Schema.Number }),
			},
		).annotate(OpenApi.Description, "Counts automation rules for a user"),
	)
	.add(
		HttpApiEndpoint.post("createGlobalEntity", "/test-support/entities/global", {
			error: testSupportErrors,
			payload: CreateGlobalEntityBody,
			success: ListedEntity.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Creates a global entity for testing"),
	)
	.add(
		HttpApiEndpoint.post("deleteGlobalEntities", "/test-support/entities/global/delete", {
			error: testSupportErrors,
			success: Schema.Struct({ deleted: Schema.Number }),
			payload: Schema.Struct({
				ids: Schema.Array(EntityId).pipe(Schema.check(Schema.isMinLength(1))),
			}),
		}).annotate(OpenApi.Description, "Deletes global entities by ID"),
	)
	.add(
		HttpApiEndpoint.put("upsertGlobalRelationship", "/test-support/relationships/global", {
			error: testSupportErrors,
			success: RelationshipScope,
			payload: Schema.Struct({
				sourceEntityId: EntityId,
				targetEntityId: EntityId,
				properties: Schema.optional(properties),
				relationshipSchemaSlug: RelationshipSchemaSlug,
			}),
		}).annotate(OpenApi.Description, "Creates or updates a global relationship"),
	)
	.add(
		HttpApiEndpoint.post("listGlobalRelationships", "/test-support/relationships/global/list", {
			error: testSupportErrors,
			payload: GlobalRelationshipListBody,
			success: Schema.Array(TestSupportGlobalRelationship),
		}).annotate(OpenApi.Description, "Lists global relationships for a requested scope"),
	)
	.add(
		HttpApiEndpoint.get("getBuiltinEntitySchema", "/test-support/entity-schemas/builtin/:slug", {
			error: testSupportErrors,
			params: { slug: Schema.String },
			success: TestSupportBuiltinEntitySchema,
		}).annotate(OpenApi.Description, "Gets a built-in entity schema by slug"),
	)
	.add(
		HttpApiEndpoint.post("setEntityPopulatedAt", "/test-support/entities/:entityId/populated-at", {
			success: ListedEntity,
			error: testSupportErrors,
			params: { entityId: EntityId },
			payload: Schema.Struct({ populatedAt: Schema.NullOr(Schema.String) }),
		}).annotate(OpenApi.Description, "Sets the population timestamp for an entity"),
	)
	.add(
		HttpApiEndpoint.put("upsertEntityTranslation", "/test-support/entity-translations", {
			error: testSupportErrors,
			success: Schema.Struct({ entityId: EntityId, language: Schema.String }),
			payload: Schema.Struct({
				entityId: EntityId,
				language: Schema.String,
				name: Schema.NullOr(Schema.String),
				properties: Schema.NullOr(properties),
			}),
		}).annotate(OpenApi.Description, "Creates or updates an entity translation"),
	)
	.add(
		HttpApiEndpoint.get("listEntityTranslations", "/test-support/entity-translations/:entityId", {
			error: testSupportErrors,
			params: { entityId: EntityId },
			success: Schema.Array(TestSupportEntityTranslation),
		}).annotate(OpenApi.Description, "Lists translations for an entity"),
	)
	.add(
		HttpApiEndpoint.post("linkAuthAccount", "/test-support/auth-accounts", {
			error: testSupportErrors,
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
			payload: Schema.Struct({
				userId: UserId,
				accountId: Schema.String,
				providerId: Schema.String,
			}),
		}).annotate(OpenApi.Description, "Links an authentication account to a user"),
	)
	.add(
		HttpApiEndpoint.post("triggerPluginCron", "/test-support/cron/plugin", {
			error: testSupportErrors,
			success: TestSupportPluginCronResult,
			payload: TestSupportTriggerPluginCronBody,
		}).annotate(OpenApi.Description, "Triggers one active plugin cron"),
	)
	.add(
		HttpApiEndpoint.post(
			"setEntityInterestMembership",
			"/test-support/entity-interest-membership",
			{
				success: Schema.Void,
				error: testSupportErrors,
				payload: Schema.Struct({ sessionId: Schema.String, entityIds: Schema.Array(EntityId) }),
			},
		).annotate(OpenApi.Description, "Sets entity interest membership without reconciliation"),
	)
	.add(
		HttpApiEndpoint.post("listAutomationTriggers", "/test-support/automations/triggers/list", {
			error: testSupportErrors,
			success: Schema.Array(AutomationTrigger),
			payload: TestSupportListAutomationTriggersBody,
		}).annotate(OpenApi.Description, "Lists automation triggers matching exact test filters"),
	)
	.add(
		HttpApiEndpoint.post(
			"listAutomationTriggerRecipients",
			"/test-support/automations/trigger-recipients/list",
			{
				error: testSupportErrors,
				success: Schema.Array(AutomationTriggerRecipient),
				payload: TestSupportListAutomationTriggerRecipientsBody,
			},
		).annotate(OpenApi.Description, "Lists recipients for an automation trigger"),
	)
	.add(
		HttpApiEndpoint.post("listAutomationRuns", "/test-support/automations/runs/list", {
			error: testSupportErrors,
			success: Schema.Array(AutomationRun),
			payload: TestSupportListAutomationRunsBody,
		}).annotate(OpenApi.Description, "Lists pinned automation runs matching exact test filters"),
	)
	.add(
		HttpApiEndpoint.post("reconcileAutomations", "/test-support/automations/reconcile", {
			success: Schema.Void,
			error: testSupportErrors,
			payload: Schema.Struct({}),
		}).annotate(OpenApi.Description, "Reconciles queued automation runs"),
	)
	.add(
		HttpApiEndpoint.post(
			"listAutomationRunAttempts",
			"/test-support/automations/run-attempts/list",
			{
				error: testSupportErrors,
				success: Schema.Array(AutomationRunAttempt),
				payload: TestSupportListAutomationRunAttemptsBody,
			},
		).annotate(OpenApi.Description, "Lists retained attempts for an automation run"),
	)
	.add(
		HttpApiEndpoint.post("installSystemPlugin", "/test-support/system-plugins", {
			payload: TestSupportInstallSystemPluginBodyBase64,
			success: TestSupportSystemPlugin.pipe(HttpApiSchema.status(201)),
			error: [
				...testSupportErrors,
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Installs a system-scope plugin for testing"),
	)
	.add(
		HttpApiEndpoint.post("installPrivatePlugin", "/test-support/users/:userId/plugins", {
			payload: InstallPluginBody,
			params: { userId: UserId },
			success: TestSupportSystemPlugin.pipe(HttpApiSchema.status(201)),
			error: [
				...testSupportErrors,
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Installs a private plugin for an E2E fixture owner"),
	)
	.add(
		HttpApiEndpoint.put("updatePrivatePlugin", "/test-support/users/:userId/plugins/:pluginSlug", {
			payload: UpdatePrivatePluginBody,
			success: TestSupportSystemPlugin,
			params: { userId: UserId, pluginSlug: PluginSlug },
			error: [
				...testSupportErrors,
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Updates a private plugin for an E2E fixture owner"),
	)
	.add(
		HttpApiEndpoint.post(
			"reconcilePluginInstallations",
			"/test-support/plugin-installations/reconcile",
			{ success: Schema.Void, error: testSupportErrors },
		).annotate(
			OpenApi.Description,
			"Reconciles system plugin installations and dispatches pending lifecycles",
		),
	)
	.add(
		HttpApiEndpoint.get("listSystemPlugins", "/test-support/system-plugins", {
			error: testSupportErrors,
			success: Schema.Array(TestSupportSystemPlugin),
		}).annotate(OpenApi.Description, "Lists active system plugins"),
	)
	.add(
		HttpApiEndpoint.delete("uninstallSystemPlugin", "/test-support/system-plugins/:pluginSlug", {
			success: TestSupportSystemPlugin,
			params: { pluginSlug: PluginSlug },
			error: [
				...testSupportErrors,
				PluginConflictError.pipe(HttpApiSchema.status(409)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Uninstalls a system plugin"),
	)
	.middleware(AdminMiddleware);
