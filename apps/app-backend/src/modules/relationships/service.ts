import { badRequest } from "@ryot/contract/errors";
import type { EntityId, RelationshipSchemaId, UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import { RelationshipsRepository } from "./repository";
import type {
	SaveRelationshipInput,
	SaveRelationshipInputBase,
	SyncGlobalRelationshipsInput,
} from "./repository-support";

// `validation: "prevalidated"` skips schema parsing for collection membership, whose properties are
// validated against the collection's own membershipPropertiesSchema; re-applying the member-of
// schema here would inject its `rank` default.
type RelationshipWriteInput = SaveRelationshipInputBase &
	(
		| { validation: "prevalidated"; properties: Record<string, unknown> }
		| { validation: "schema"; properties: unknown; propertiesSchema: AppSchema }
	);

export class RelationshipsService extends Effect.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipsRepository;

			const persist = (input: SaveRelationshipInput) =>
				runWithDb(repository.saveRelationship(input));

			const save = Effect.fn("RelationshipsService.save")(function* (
				input: RelationshipWriteInput,
			) {
				if (input.validation === "prevalidated") {
					const { validation: _validation, ...saveInput } = input;
					return yield* persist(saveInput);
				}
				const { validation: _validation, propertiesSchema, properties, ...base } = input;
				const parsed = yield* parseAppSchemaProperties({
					properties,
					propertiesSchema,
					kind: "Relationship",
				}).pipe(Effect.mapError((error) => badRequest(error.message)));
				return yield* persist({ ...base, properties: parsed });
			});

			const deleteUserRelationship = Effect.fn("RelationshipsService.deleteUserRelationship")(
				(input: {
					userId: UserId;
					sourceEntityId: EntityId;
					targetEntityId: EntityId;
					relationshipSchemaId: RelationshipSchemaId;
				}) => runWithDb(repository.deleteUserRelationship(input)),
			);

			const syncGlobal = Effect.fn("RelationshipsService.syncGlobal")(
				(input: SyncGlobalRelationshipsInput) =>
					runWithDb(repository.syncGlobalRelationships(input)),
			);

			return { save, syncGlobal, deleteUserRelationship };
		}),
	},
) {}
