import { Activity } from "@effect/workflow";
import { DbError, badRequest, notFound } from "@ryot/contract/errors";
import { RelationshipSnapshot } from "@ryot/contract/modules/automations/schemas";
import { RelationshipScope } from "@ryot/contract/modules/relationships/schemas";
import type { EntitySchemaId } from "@ryot/contract/schema/brands";
import { RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { dispatchLifecycleSubscriptions } from "#modules/automations/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import {
	RelationshipCreateWorkflow,
	RelationshipCreateWorkflowError,
	type RelationshipCreateWorkflowPayload,
} from "./relationship-create-workflow";
import { RelationshipsService } from "./service";

const WriteRelationshipResult = Schema.Struct({
	response: RelationshipScope,
	relationshipSchemaId: RelationshipSchemaId,
	after: Schema.optional(RelationshipSnapshot),
	before: Schema.optional(RelationshipSnapshot),
	operation: Schema.Literal("create", "update", "noop"),
});

const validateSchemaTargets = (
	relationshipSchema: {
		readonly sourceEntitySchemaId: EntitySchemaId | null;
		readonly targetEntitySchemaId: EntitySchemaId | null;
	},
	sourceEntitySchemaId: EntitySchemaId,
	targetEntitySchemaId: EntitySchemaId,
) => {
	if (
		relationshipSchema.sourceEntitySchemaId &&
		relationshipSchema.sourceEntitySchemaId !== sourceEntitySchemaId
	) {
		return badRequest("Relationship source entity schema does not match");
	}
	if (
		relationshipSchema.targetEntitySchemaId &&
		relationshipSchema.targetEntitySchemaId !== targetEntitySchemaId
	) {
		return badRequest("Relationship target entity schema does not match");
	}
	return Effect.void;
};

const writeRelationship = Effect.fn("writeRelationship")(function* (
	payload: RelationshipCreateWorkflowPayload,
) {
	const runWithDb = yield* DbRunner;
	const relationships = yield* RelationshipsService;
	const entitiesRepository = yield* EntitiesRepository;
	const schemasRepository = yield* RelationshipSchemasRepository;
	const { body, userId } = payload;

	const relationshipSchema = yield* runWithDb(
		schemasRepository.findById(body.relationshipSchemaId, userId),
	);
	if (!relationshipSchema) {
		return yield* notFound("Relationship schema not found");
	}

	const [sourceScope, targetScope] = yield* Effect.all([
		runWithDb(entitiesRepository.getEntityScopeForUser({ userId, entityId: body.sourceEntityId })),
		runWithDb(entitiesRepository.getEntityScopeForUser({ userId, entityId: body.targetEntityId })),
	]);
	if (!sourceScope || !targetScope) {
		return yield* notFound("Entity not found");
	}

	yield* validateSchemaTargets(
		relationshipSchema,
		sourceScope.entitySchemaId,
		targetScope.entitySchemaId,
	);

	const outcome = yield* relationships.save({
		validation: "schema",
		scope: "user",
		userId,
		onConflict: "replaceProperties",
		properties: body.properties ?? {},
		sourceEntityId: body.sourceEntityId,
		targetEntityId: body.targetEntityId,
		relationshipSchemaId: body.relationshipSchemaId,
		propertiesSchema: relationshipSchema.propertiesSchema,
	});

	return {
		operation: outcome.operation,
		response: outcome.relationship,
		relationshipSchemaId: relationshipSchema.id,
		...(outcome.after ? { after: outcome.after } : {}),
		...(outcome.before ? { before: outcome.before } : {}),
	};
});

export const runRelationshipCreateWorkflow = Effect.fn("runRelationshipCreateWorkflow")(function* (
	payload: RelationshipCreateWorkflowPayload,
) {
	const result = yield* Activity.make({
		name: "write-relationship",
		success: WriteRelationshipResult,
		execute: writeRelationship(payload),
		error: RelationshipCreateWorkflowError,
	});

	if (result.operation !== "noop") {
		const occurrenceId =
			result.operation === "create"
				? `relationship-create-${result.response.id}`
				: `${payload.executionId}-relationship-update-${result.response.id}`;
		yield* dispatchLifecycleSubscriptions({
			userId: payload.userId,
			correlationId: occurrenceId,
			target: { kind: "relationship", schemaId: result.relationshipSchemaId },
			automation: {
				occurrenceId,
				automationDepth: 1,
				origin: payload.origin,
				operation: result.operation,
				...(result.operation === "create"
					? { committedAt: DateTime.unsafeMake(result.response.createdAt) }
					: {}),
				source: {
					kind: "relationship",
					...(result.after ? { after: result.after } : {}),
					...(result.before ? { before: result.before } : {}),
				},
			},
		}).pipe(
			Effect.mapError(
				() => new DbError({ message: "Relationship create subscription dispatch failed" }),
			),
		);
	}

	return result.response;
});

export const RelationshipCreateWorkflowDefinitionsLive = RelationshipCreateWorkflow.toLayer(
	(payload) => runRelationshipCreateWorkflow(payload),
);
