import { badRequest } from "@ryot/contract/errors";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import { RelationshipsRepository, type SaveRelationshipInputBase } from "./repository";

type CreateRelationshipInput = SaveRelationshipInputBase & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

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
