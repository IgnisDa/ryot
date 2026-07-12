import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware } from "../../auth-middleware";
import { BadRequest, Conflict, InternalError, NotFound, SandboxRunError } from "../../errors";
import {
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SignalId,
	UserId,
} from "../../schema/brands";
import { ListedEntity } from "../entities/schemas";
import { RelationshipScope } from "../relationships/schemas";
import { EnqueueResponse, SandboxRunResult } from "../sandbox/schemas";
import {
	TestSupportBuiltinEntitySchema,
	TestSupportEntityTranslation,
	TestSupportGlobalRelationship,
	TestSupportSignal,
	TestSupportEnqueueSandboxBody,
	TestSupportOperationalPressure,
	TestSupportPluginCronResult,
	TestSupportStartWorkflowLoadGateBody,
	TestSupportStoredSandboxScript,
	TestSupportSubscriptionRun,
	TestSupportTriggerPluginCronBody,
	TestSupportWorkflowLoadGateResult,
	TestSupportWorkflowLoadGateRun,
} from "./schemas";

const properties = Schema.Record(Schema.String, Schema.Unknown);

const CreateGlobalEntityBody = Schema.Struct({
	properties,
	name: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.optional(Schema.String),
	providerId: Schema.optional(SandboxProviderId),
	populatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const TriggerPluginBootResponse = Schema.Struct({ executionId: Schema.String });
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
			params: { scriptId: SandboxScriptId },
			success: TestSupportStoredSandboxScript,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Gets an installed sandbox script by ID"),
	)
	.add(
		HttpApiEndpoint.get("listSandboxScripts", "/test-support/sandbox-scripts", {
			query: {},
			success: Schema.Array(TestSupportStoredSandboxScript),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists installed sandbox scripts"),
	)
	.add(
		HttpApiEndpoint.post("enqueueSandbox", "/test-support/sandbox/enqueue", {
			payload: TestSupportEnqueueSandboxBody,
			success: EnqueueResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Enqueues an installed sandbox script for a user"),
	)
	.add(
		HttpApiEndpoint.get("getSandboxResult", "/test-support/sandbox/result/:jobId", {
			params: { jobId: Schema.String },
			query: { executingUserId: UserId },
			success: SandboxRunResult,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Returns an installed sandbox script execution result"),
	)
	.add(
		HttpApiEndpoint.post("startWorkflowLoadGate", "/test-support/operational-gate/workflow-load", {
			payload: TestSupportStartWorkflowLoadGateBody,
			success: TestSupportWorkflowLoadGateRun,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Starts a full-size workflow load operational gate"),
	)
	.add(
		HttpApiEndpoint.post(
			"getWorkflowLoadGateResult",
			"/test-support/operational-gate/workflow-load/result",
			{
				payload: WorkflowLoadGateResultBody,
				success: TestSupportWorkflowLoadGateResult,
				error: [BadRequest.pipe(HttpApiSchema.status(400))],
			},
		).annotate(OpenApi.Description, "Returns workflow load operational gate results"),
	)
	.add(
		HttpApiEndpoint.post("sampleOperationalPressure", "/test-support/operational-gate/pressure", {
			payload: OperationalPressureBody,
			success: TestSupportOperationalPressure,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Samples generic workflow infrastructure pressure"),
	)
	.add(
		HttpApiEndpoint.get(
			"countAutomationRules",
			"/test-support/users/:userId/automation-rules/count",
			{
				params: { userId: UserId },
				success: Schema.Struct({ count: Schema.Number }),
				error: [BadRequest.pipe(HttpApiSchema.status(400))],
			},
		).annotate(OpenApi.Description, "Counts automation rules for a user"),
	)
	.add(
		HttpApiEndpoint.post("createGlobalEntity", "/test-support/entities/global", {
			payload: CreateGlobalEntityBody,
			success: ListedEntity.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Creates a global entity for testing"),
	)
	.add(
		HttpApiEndpoint.post("deleteGlobalEntities", "/test-support/entities/global/delete", {
			payload: Schema.Struct({
				ids: Schema.Array(EntityId).pipe(Schema.check(Schema.isMinLength(1))),
			}),
			success: Schema.Struct({ deleted: Schema.Number }),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Deletes global entities by ID"),
	)
	.add(
		HttpApiEndpoint.put("upsertGlobalRelationship", "/test-support/relationships/global", {
			payload: Schema.Struct({
				sourceEntityId: EntityId,
				targetEntityId: EntityId,
				relationshipSchemaSlug: RelationshipSchemaSlug,
				properties: Schema.optional(properties),
			}),
			success: RelationshipScope,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Creates or updates a global relationship"),
	)
	.add(
		HttpApiEndpoint.post("listGlobalRelationships", "/test-support/relationships/global/list", {
			payload: GlobalRelationshipListBody,
			success: Schema.Array(TestSupportGlobalRelationship),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists global relationships for a requested scope"),
	)
	.add(
		HttpApiEndpoint.get("getBuiltinEntitySchema", "/test-support/entity-schemas/builtin/:slug", {
			params: { slug: Schema.String },
			success: TestSupportBuiltinEntitySchema,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Gets a built-in entity schema by slug"),
	)
	.add(
		HttpApiEndpoint.post("setEntityPopulatedAt", "/test-support/entities/:entityId/populated-at", {
			params: { entityId: EntityId },
			payload: Schema.Struct({ populatedAt: Schema.NullOr(Schema.String) }),
			success: ListedEntity,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Sets the population timestamp for an entity"),
	)
	.add(
		HttpApiEndpoint.put("upsertEntityTranslation", "/test-support/entity-translations", {
			payload: Schema.Struct({
				entityId: EntityId,
				language: Schema.String,
				name: Schema.NullOr(Schema.String),
				properties: Schema.NullOr(properties),
			}),
			success: Schema.Struct({ entityId: EntityId, language: Schema.String }),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Creates or updates an entity translation"),
	)
	.add(
		HttpApiEndpoint.get("listEntityTranslations", "/test-support/entity-translations/:entityId", {
			params: { entityId: EntityId },
			success: Schema.Array(TestSupportEntityTranslation),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists translations for an entity"),
	)
	.add(
		HttpApiEndpoint.post("linkAuthAccount", "/test-support/auth-accounts", {
			payload: Schema.Struct({
				userId: UserId,
				accountId: Schema.String,
				providerId: Schema.String,
			}),
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Links an authentication account to a user"),
	)
	.add(
		HttpApiEndpoint.post("triggerPluginCron", "/test-support/cron/plugin", {
			payload: TestSupportTriggerPluginCronBody,
			success: TestSupportPluginCronResult,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				SandboxRunError.pipe(HttpApiSchema.status(502)),
			],
		}).annotate(OpenApi.Description, "Triggers one active plugin cron"),
	)
	.add(
		HttpApiEndpoint.post("triggerPluginBoot", "/test-support/plugin-boot", {
			success: TriggerPluginBootResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Triggers all installed plugin boot drivers"),
	)
	.add(
		HttpApiEndpoint.post("setEntityInterest", "/test-support/entity-interest", {
			payload: Schema.Struct({
				userId: UserId,
				streamId: Schema.String,
				entityIds: Schema.Array(EntityId),
			}),
			success: Schema.Void,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Registers entity interest without reconciliation"),
	)
	.add(
		HttpApiEndpoint.post("listSignals", "/test-support/signals/list", {
			payload: Schema.Struct({
				schemaSlug: Schema.String,
				actorUserId: Schema.optional(UserId),
				subjectEntityId: Schema.optional(EntityId),
			}),
			success: Schema.Array(TestSupportSignal),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists signals matching test filters"),
	)
	.add(
		HttpApiEndpoint.post("listSubscriptionRuns", "/test-support/subscription-runs/list", {
			payload: Schema.Struct({ executionUserId: UserId, signalId: Schema.optional(SignalId) }),
			success: Schema.Array(TestSupportSubscriptionRun),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists subscription runs for an execution user"),
	)
	.middleware(AdminMiddleware);
