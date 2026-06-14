import { badRequest } from "@ryot/contract/errors";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import { RelationshipsRepository, type SaveRelationshipInputBase } from "./repository";

type SaveRelationshipInput = SaveRelationshipInputBase & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

export class RelationshipsService extends Effect.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipsRepository;

			const save = Effect.fn("RelationshipsService.save")(function* (input: SaveRelationshipInput) {
				const { propertiesSchema, ...saveInput } = input;
				const properties = yield* parseAppSchemaProperties({
					kind: "Relationship",
					properties: input.properties,
					propertiesSchema,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));

				return yield* runWithDb(repository.saveRelationship({ ...saveInput, properties }));
			});

			return { save };
		}),
	},
) {}
