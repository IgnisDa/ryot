import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AdminMiddleware } from "../../auth-middleware";
import { EntityId, ImportRunId, PluginId, SandboxProviderId, UserId } from "../../schema/brands";
import { ListedEntity } from "../entities/schemas";
import { EntitySchemaReference, RelationshipSchemaReference } from "../plugins/references";
import { PluginConflictError, PluginNotFoundError, PluginRequestError } from "../plugins/schemas";
import { RelationshipScope } from "../relationships/schemas";
import { SandboxRunResult } from "../scripts/schemas";
import {
	TestSupportBadRequest,
	TestSupportConflict,
	TestSupportEnqueueSandboxBody,
	TestSupportEnqueueSandboxResponse,
	TestSupportInstallSystemPluginBodyBase64,
	TestSupportNotFound,
	TestSupportOperationalPressure,
	TestSupportOperationFailure,
	TestSupportPluginCronResult,
	TestSupportPluginWriteResult,
	TestSupportSandboxReplayProjectionBody,
	TestSupportStartWorkflowLoadGateBody,
	TestSupportTriggerPluginCronBody,
	TestSupportUpdateSystemPluginBodyBase64,
	TestSupportWorkflowLoadGateResult,
	TestSupportWorkflowLoadGateRun,
} from "./schemas";

const properties = Schema.Record(Schema.String, Schema.Unknown);
const testSupportErrors = [
	TestSupportBadRequest.pipe(HttpApiSchema.status(400)),
	TestSupportNotFound.pipe(HttpApiSchema.status(404)),
	TestSupportConflict.pipe(HttpApiSchema.status(409)),
	TestSupportOperationFailure.pipe(HttpApiSchema.status(500)),
];

const PopulationSeedLevel = Schema.Literals(["base", "full"]);

const CreateGlobalEntityBody = Schema.Struct({
	properties,
	name: Schema.String,
	entitySchema: EntitySchemaReference,
	externalId: Schema.optional(Schema.String),
	level: Schema.optional(PopulationSeedLevel),
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

export const TestSupportGroup = HttpApiGroup.make("testSupport")
	.annotate(OpenApi.Description, "Provides administrative operations used by integration tests")
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
		HttpApiEndpoint.post("createGlobalEntity", "/test-support/entities/global", {
			error: testSupportErrors,
			payload: CreateGlobalEntityBody,
			success: ListedEntity.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Creates a global entity for testing"),
	)
	.add(
		HttpApiEndpoint.post("deleteGlobalEntities", "/test-support/entities/global/delete", {
			error: testSupportErrors,
			success: Schema.Struct({ deleted: Schema.Finite }),
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
				relationshipSchema: RelationshipSchemaReference,
			}),
		}).annotate(OpenApi.Description, "Creates or updates a global relationship"),
	)
	.add(
		HttpApiEndpoint.post("setEntityPopulatedAt", "/test-support/entities/:entityId/populated-at", {
			success: ListedEntity,
			error: testSupportErrors,
			params: { entityId: EntityId },
			payload: Schema.Struct({
				populatedAt: Schema.NullOr(Schema.String),
				level: Schema.optional(PopulationSeedLevel),
			}),
		}).annotate(
			OpenApi.Description,
			"Sets the population timestamp for an entity; the full level (default) also stamps the related level",
		),
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
		HttpApiEndpoint.post("setEntityWatchMembership", "/test-support/entity-watches-membership", {
			success: Schema.Void,
			error: testSupportErrors,
			payload: Schema.Struct({ sessionId: Schema.String, entityIds: Schema.Array(EntityId) }),
		}).annotate(OpenApi.Description, "Sets entity interest membership without reconciliation"),
	)
	.add(
		HttpApiEndpoint.post("reconcileAutomations", "/test-support/automations/reconcile", {
			success: Schema.Void,
			error: testSupportErrors,
			payload: Schema.Struct({}),
		}).annotate(OpenApi.Description, "Reconciles queued automation runs"),
	)
	.add(
		HttpApiEndpoint.post("installSystemPlugin", "/test-support/system-plugins", {
			payload: TestSupportInstallSystemPluginBodyBase64,
			success: TestSupportPluginWriteResult.pipe(HttpApiSchema.status(201)),
			error: [
				...testSupportErrors,
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Installs a system-scope plugin for testing"),
	)
	.add(
		HttpApiEndpoint.put("updateSystemPlugin", "/test-support/system-plugins/:pluginId/package", {
			params: { pluginId: PluginId },
			success: TestSupportPluginWriteResult,
			payload: TestSupportUpdateSystemPluginBodyBase64,
			error: [
				...testSupportErrors,
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(
			OpenApi.Description,
			"Updates an exact system plugin after checking its active source hash",
		),
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
		HttpApiEndpoint.delete(
			"uninstallSystemPlugin",
			"/test-support/system-plugins/:pluginId/:activationId",
			{
				success: Schema.Struct({ pluginId: PluginId }),
				params: { pluginId: PluginId, activationId: Schema.String },
				error: [
					...testSupportErrors,
					PluginConflictError.pipe(HttpApiSchema.status(409)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Uninstalls a system plugin"),
	)
	.middleware(AdminMiddleware);
