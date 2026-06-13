import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import type { EntitySchemaId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { RelationshipsRepository } from "./repository";
import type { CreateRelationshipBody } from "./schemas";

const validateRelationshipSchemaTargets = (input: {
	sourceEntitySchemaId: EntitySchemaId;
	targetEntitySchemaId: EntitySchemaId;
	relationshipSchema: {
		readonly sourceEntitySchemaId: EntitySchemaId | null;
		readonly targetEntitySchemaId: EntitySchemaId | null;
	};
}) => {
	if (
		input.relationshipSchema.sourceEntitySchemaId &&
		input.relationshipSchema.sourceEntitySchemaId !== input.sourceEntitySchemaId
	) {
		return badRequest("Relationship source entity schema does not match");
	}
	if (
		input.relationshipSchema.targetEntitySchemaId &&
		input.relationshipSchema.targetEntitySchemaId !== input.targetEntitySchemaId
	) {
		return badRequest("Relationship target entity schema does not match");
	}
	return Effect.void;
};

export class RelationshipsService extends Effect.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipsRepository;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

			const create = Effect.fn("RelationshipsService.create")(function* (
				user: CurrentUserValue,
				payload: CreateRelationshipBody,
			) {
				const relationshipSchema = yield* runWithDb(
					relationshipSchemasRepository.findById(payload.relationshipSchemaId, user.id),
				);
				if (!relationshipSchema) {
					return yield* notFound("Relationship schema not found");
				}

				const [sourceEntityScope, targetEntityScope] = yield* Effect.all([
					runWithDb(
						entitiesRepository.getEntityScopeForUser({
							userId: user.id,
							entityId: payload.sourceEntityId,
						}),
					),
					runWithDb(
						entitiesRepository.getEntityScopeForUser({
							userId: user.id,
							entityId: payload.targetEntityId,
						}),
					),
				]);
				if (!sourceEntityScope || !targetEntityScope) {
					return yield* notFound("Entity not found");
				}

				yield* validateRelationshipSchemaTargets({
					relationshipSchema,
					sourceEntitySchemaId: sourceEntityScope.entitySchemaId,
					targetEntitySchemaId: targetEntityScope.entitySchemaId,
				});

				const properties = yield* parseAppSchemaProperties({
					kind: "Relationship",
					properties: payload.properties ?? {},
					propertiesSchema: relationshipSchema.propertiesSchema,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));

				return yield* runWithDb(
					repository.upsertRelationship({
						properties,
						userId: user.id,
						sourceEntityId: payload.sourceEntityId,
						targetEntityId: payload.targetEntityId,
						relationshipSchemaId: payload.relationshipSchemaId,
					}),
				);
			});

			return { create };
		}),
	},
) {}
