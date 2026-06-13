import { Effect } from "effect";

import { DbRunner } from "#lib/db";
import { badRequest } from "#lib/errors";
import type { EntityId, RelationshipSchemaId, UserId } from "#lib/schema/brands";
import type { AppSchema } from "#lib/schema/property-schema";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";

import { RelationshipsRepository } from "./repository";

type CreateRelationshipInput = {
	properties: unknown;
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	propertiesSchema: AppSchema;
	relationshipSchemaId: RelationshipSchemaId;
	onConflict: "preserveExisting" | "replaceProperties";
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export class RelationshipsService extends Effect.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipsRepository;

			const create = Effect.fn("RelationshipsService.create")(function* (
				input: CreateRelationshipInput,
			) {
				const properties = yield* parseAppSchemaProperties({
					kind: "Relationship",
					properties: input.properties,
					propertiesSchema: input.propertiesSchema,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));

				if (input.scope === "user") {
					return yield* runWithDb(
						repository.saveRelationship({
							properties,
							scope: "user",
							userId: input.userId,
							onConflict: input.onConflict,
							sourceEntityId: input.sourceEntityId,
							targetEntityId: input.targetEntityId,
							relationshipSchemaId: input.relationshipSchemaId,
						}),
					);
				}

				return yield* runWithDb(
					repository.saveRelationship({
						properties,
						scope: "global",
						onConflict: input.onConflict,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaId: input.relationshipSchemaId,
					}),
				);
			});

			return { create };
		}),
	},
) {}
