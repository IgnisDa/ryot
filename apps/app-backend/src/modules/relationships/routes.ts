import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { badRequest, dieOnDbError, notFound } from "@ryot/contract/errors";
import type { EntitySchemaId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { RelationshipsService } from "./service";

export const RelationshipsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationships",
	(handlers) =>
		handlers.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const runWithDb = yield* DbRunner;
				const service = yield* RelationshipsService;
				const entitiesRepository = yield* EntitiesRepository;
				const schemasRepository = yield* RelationshipSchemasRepository;

				const schema = yield* runWithDb(
					schemasRepository.findById(payload.relationshipSchemaId, user.id),
				);
				if (!schema) {
					return yield* notFound("Relationship schema not found");
				}

				const [sourceScope, targetScope] = yield* Effect.all([
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
				if (!sourceScope || !targetScope) {
					return yield* notFound("Entity not found");
				}

				yield* validateSchemaTargets(
					schema,
					sourceScope.entitySchemaId,
					targetScope.entitySchemaId,
				);

				return yield* service.create({
					scope: "user",
					userId: user.id,
					onConflict: "replaceProperties",
					properties: payload.properties ?? {},
					sourceEntityId: payload.sourceEntityId,
					targetEntityId: payload.targetEntityId,
					propertiesSchema: schema.propertiesSchema,
					relationshipSchemaId: payload.relationshipSchemaId,
				});
			}).pipe(dieOnDbError),
		),
);

const validateSchemaTargets = (
	schema: {
		readonly sourceEntitySchemaId: EntitySchemaId | null;
		readonly targetEntitySchemaId: EntitySchemaId | null;
	},
	sourceEntitySchemaId: EntitySchemaId,
	targetEntitySchemaId: EntitySchemaId,
) => {
	if (schema.sourceEntitySchemaId && schema.sourceEntitySchemaId !== sourceEntitySchemaId) {
		return badRequest("Relationship source entity schema does not match");
	}
	if (schema.targetEntitySchemaId && schema.targetEntitySchemaId !== targetEntitySchemaId) {
		return badRequest("Relationship target entity schema does not match");
	}
	return Effect.void;
};
