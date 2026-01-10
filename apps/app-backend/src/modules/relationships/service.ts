import { badRequest, notFound } from "@ryot/contract/errors";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import {
	RelationshipsRepository,
	type GlobalRelationshipListInput,
	type RelationshipIdentityInput,
} from "./repository";

type CreateRelationshipInput = RelationshipIdentityInput & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

type UpdateRelationshipInput = RelationshipIdentityInput & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

export class RelationshipsService extends Effect.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipsRepository;

			const parseProperties = Effect.fn("RelationshipsService.parseProperties")(function* (input: {
				properties: unknown;
				propertiesSchema: AppSchema;
			}) {
				return yield* parseAppSchemaProperties({
					kind: "Relationship",
					properties: input.properties,
					propertiesSchema: input.propertiesSchema,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));
			});

			const create = Effect.fn("RelationshipsService.create")(function* (
				input: CreateRelationshipInput,
			) {
				const { propertiesSchema, ...saveInput } = input;
				const properties = yield* parseProperties({
					propertiesSchema,
					properties: input.properties,
				});

				return yield* runWithDb(repository.createRelationship({ ...saveInput, properties }));
			});

			const update = Effect.fn("RelationshipsService.update")(function* (
				input: UpdateRelationshipInput,
			) {
				const { propertiesSchema, ...updateInput } = input;
				const properties = yield* parseProperties({
					propertiesSchema,
					properties: input.properties,
				});
				const updated = yield* runWithDb(
					repository.updateRelationship({ ...updateInput, properties }),
				);
				if (!updated) {
					return yield* notFound("Relationship not found");
				}
				return updated;
			});

			const deleteRelationship = Effect.fn("RelationshipsService.delete")(function* (
				input: RelationshipIdentityInput,
			) {
				return yield* runWithDb(repository.deleteRelationship(input));
			});

			const listGlobal = Effect.fn("RelationshipsService.listGlobal")(function* (
				input: GlobalRelationshipListInput,
			) {
				return yield* runWithDb(repository.listGlobalRelationships(input));
			});

			return { create, update, listGlobal, delete: deleteRelationship };
		}),
	},
) {}
