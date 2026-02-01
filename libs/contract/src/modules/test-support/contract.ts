import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AdminMiddleware } from "../../auth-middleware";
import { Conflict, InternalError, NotFound, Unauthorized } from "../../errors";
import {
	EntityId,
	EntitySchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
	SignalId,
	TrackerId,
	UserId,
} from "../../schema/brands";
import { ListedEntity } from "../entities/schemas";
import { RelationshipScope } from "../relationships/schemas";
import { SandboxScriptMetadata } from "../sandbox/schemas";
import {
	TestSupportBuiltinEntitySchema,
	TestSupportEntityTranslation,
	TestSupportGlobalRelationship,
	TestSupportSignal,
	TestSupportStoredSandboxScript,
	TestSupportSubscriptionRun,
} from "./schemas";

const userIdParam = HttpApiSchema.param("userId", UserId);
const slugParam = HttpApiSchema.param("slug", Schema.String);
const entityIdParam = HttpApiSchema.param("entityId", EntityId);
const trackerIdParam = HttpApiSchema.param("trackerId", TrackerId);
const scriptIdParam = HttpApiSchema.param("scriptId", SandboxScriptId);
const properties = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const entitySchemaIdParam = HttpApiSchema.param("entitySchemaId", EntitySchemaId);

const PatchSandboxScriptBody = Schema.Struct({
	slug: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	source: Schema.optional(Schema.String),
	compiledCode: Schema.optional(Schema.String),
	compiledFormat: Schema.optional(Schema.Number),
	metadata: Schema.optional(SandboxScriptMetadata),
});

const CreateGlobalEntityBody = Schema.Struct({
	properties,
	name: Schema.String,
	entitySchemaId: EntitySchemaId,
	externalId: Schema.optional(Schema.String),
	sandboxScriptId: Schema.optional(SandboxScriptId),
	populatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const TriggerInfrequentCronResponse = Schema.Struct({ executionId: Schema.String });

const GlobalRelationshipListBody = Schema.Union(
	Schema.Struct({ type: Schema.Literal("self"), relationshipSchemaId: RelationshipSchemaId }),
	Schema.Struct({
		anchorEntityId: EntityId,
		type: Schema.Literal("anchored"),
		relationshipSchemaId: RelationshipSchemaId,
		direction: Schema.Literal("incoming", "outgoing"),
	}),
);

export const TestSupportGroup = HttpApiGroup.make("testSupport")
	.annotate(OpenApi.Description, "Provides administrative operations used by integration tests")
	.addError(Unauthorized, { status: 401 })
	.middleware(AdminMiddleware)
	.add(
		HttpApiEndpoint.get("getSandboxScript")`/test-support/sandbox-scripts/${scriptIdParam}`
			.addSuccess(TestSupportStoredSandboxScript)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Gets a stored sandbox script by ID"),
	)
	.add(
		HttpApiEndpoint.get("listSandboxScripts", "/test-support/sandbox-scripts")
			.setUrlParams(Schema.Struct({ userId: Schema.optional(UserId) }))
			.addSuccess(Schema.Array(TestSupportStoredSandboxScript))
			.annotate(OpenApi.Description, "Lists stored sandbox scripts with an optional user filter"),
	)
	.add(
		HttpApiEndpoint.get(
			"countAutomationRules",
		)`/test-support/users/${userIdParam}/automation-rules/count`
			.addSuccess(Schema.Struct({ count: Schema.Number }))
			.annotate(OpenApi.Description, "Counts automation rules for a user"),
	)
	.add(
		HttpApiEndpoint.get("trackerExists")`/test-support/trackers/${trackerIdParam}/exists`
			.addSuccess(Schema.Struct({ exists: Schema.Boolean }))
			.annotate(OpenApi.Description, "Checks whether a tracker exists"),
	)
	.add(
		HttpApiEndpoint.patch("patchSandboxScript")`/test-support/sandbox-scripts/${scriptIdParam}`
			.setPayload(PatchSandboxScriptBody)
			.addSuccess(TestSupportStoredSandboxScript)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Updates fields on a stored sandbox script"),
	)
	.add(
		HttpApiEndpoint.post(
			"promoteSandboxScript",
		)`/test-support/sandbox-scripts/${scriptIdParam}/promote`
			.addSuccess(TestSupportStoredSandboxScript)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Promotes a stored sandbox script"),
	)
	.add(
		HttpApiEndpoint.del("deleteSandboxScript")`/test-support/sandbox-scripts/${scriptIdParam}`
			.addSuccess(Schema.Struct({ id: SandboxScriptId }))
			.annotate(OpenApi.Description, "Deletes a stored sandbox script"),
	)
	.add(
		HttpApiEndpoint.put(
			"linkSandboxScriptToEntitySchema",
		)`/test-support/entity-schemas/${entitySchemaIdParam}/sandbox-scripts/${scriptIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.annotate(OpenApi.Description, "Links a sandbox script to an entity schema"),
	)
	.add(
		HttpApiEndpoint.post("createGlobalEntity", "/test-support/entities/global")
			.setPayload(CreateGlobalEntityBody)
			.addSuccess(ListedEntity, { status: 201 })
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Creates a global entity for testing"),
	)
	.add(
		HttpApiEndpoint.post("deleteGlobalEntities", "/test-support/entities/global/delete")
			.setPayload(Schema.Struct({ ids: Schema.Array(EntityId).pipe(Schema.minItems(1)) }))
			.addSuccess(Schema.Struct({ deleted: Schema.Number }))
			.annotate(OpenApi.Description, "Deletes global entities by ID"),
	)
	.add(
		HttpApiEndpoint.put("upsertGlobalRelationship", "/test-support/relationships/global")
			.setPayload(
				Schema.Struct({
					sourceEntityId: EntityId,
					targetEntityId: EntityId,
					relationshipSchemaId: RelationshipSchemaId,
					properties: Schema.optional(properties),
				}),
			)
			.addSuccess(RelationshipScope)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Creates or updates a global relationship"),
	)
	.add(
		HttpApiEndpoint.post("listGlobalRelationships", "/test-support/relationships/global/list")
			.setPayload(GlobalRelationshipListBody)
			.addSuccess(Schema.Array(TestSupportGlobalRelationship))
			.annotate(OpenApi.Description, "Lists global relationships for a requested scope"),
	)
	.add(
		HttpApiEndpoint.get("getBuiltinEntitySchema")`/test-support/entity-schemas/builtin/${slugParam}`
			.addSuccess(TestSupportBuiltinEntitySchema)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Gets a built-in entity schema by slug"),
	)
	.add(
		HttpApiEndpoint.post(
			"setEntityPopulatedAt",
		)`/test-support/entities/${entityIdParam}/populated-at`
			.setPayload(Schema.Struct({ populatedAt: Schema.NullOr(Schema.String) }))
			.addSuccess(ListedEntity)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Sets the population timestamp for an entity"),
	)
	.add(
		HttpApiEndpoint.put("upsertEntityTranslation", "/test-support/entity-translations")
			.setPayload(
				Schema.Struct({
					entityId: EntityId,
					language: Schema.String,
					name: Schema.NullOr(Schema.String),
					properties: Schema.NullOr(properties),
				}),
			)
			.addSuccess(Schema.Struct({ entityId: EntityId, language: Schema.String }))
			.addError(NotFound, { status: 404 })
			.addError(Conflict, { status: 409 })
			.annotate(OpenApi.Description, "Creates or updates an entity translation"),
	)
	.add(
		HttpApiEndpoint.get(
			"listEntityTranslations",
		)`/test-support/entity-translations/${entityIdParam}`
			.addSuccess(Schema.Array(TestSupportEntityTranslation))
			.annotate(OpenApi.Description, "Lists translations for an entity"),
	)
	.add(
		HttpApiEndpoint.post("linkAuthAccount", "/test-support/auth-accounts")
			.setPayload(
				Schema.Struct({
					userId: UserId,
					accountId: Schema.String,
					providerId: Schema.String,
				}),
			)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 })
			.addError(InternalError, { status: 500 })
			.annotate(OpenApi.Description, "Links an authentication account to a user"),
	)
	.add(
		HttpApiEndpoint.post("triggerInfrequentCron", "/test-support/cron/infrequent")
			.addSuccess(TriggerInfrequentCronResponse)
			.annotate(OpenApi.Description, "Triggers the infrequent cron job"),
	)
	.add(
		HttpApiEndpoint.post("setEntityInterest", "/test-support/entity-interest")
			.setPayload(
				Schema.Struct({
					userId: UserId,
					streamId: Schema.String,
					entityIds: Schema.Array(EntityId),
				}),
			)
			.addSuccess(Schema.Void)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Registers entity interest without reconciliation"),
	)
	.add(
		HttpApiEndpoint.post("listSignals", "/test-support/signals/list")
			.setPayload(
				Schema.Struct({
					schemaSlug: Schema.String,
					actorUserId: Schema.optional(UserId),
					subjectEntityId: Schema.optional(EntityId),
				}),
			)
			.addSuccess(Schema.Array(TestSupportSignal))
			.annotate(OpenApi.Description, "Lists signals matching test filters"),
	)
	.add(
		HttpApiEndpoint.post("listSubscriptionRuns", "/test-support/subscription-runs/list")
			.setPayload(
				Schema.Struct({
					executionUserId: UserId,
					signalId: Schema.optional(SignalId),
				}),
			)
			.addSuccess(Schema.Array(TestSupportSubscriptionRun))
			.annotate(OpenApi.Description, "Lists subscription runs for an execution user"),
	);
