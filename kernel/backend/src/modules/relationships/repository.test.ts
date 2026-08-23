import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import { DatabaseSession } from "#lib/infrastructure/db/session";

import { baseInput, relationshipDatabaseLayer } from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";

describe("RelationshipsRepository PostgreSQL", () => {
	layer(relationshipDatabaseLayer())((test) => {
		test.effect("returns complete persisted snapshots and obeys the active transaction", () =>
			Effect.gen(function* () {
				const repository = yield* RelationshipsRepository;
				const session = yield* DatabaseSession;
				const created = yield* repository.createRelationship(baseInput);
				const found = yield* repository.findRelationship(baseInput);
				assert(found);
				expect(found).toEqual({
					id: created.id,
					properties: { rank: 1 },
					createdAt: created.createdAt,
					updatedAt: created.updatedAt,
					sourceEntityId: baseInput.sourceEntityId,
					targetEntityId: baseInput.targetEntityId,
					relationshipSchemaSlug: baseInput.relationshipSchemaSlug,
				});
				yield* session
					.transaction(
						Effect.gen(function* () {
							yield* repository.lockRelationshipMutations([baseInput]);
							yield* repository.updateRelationship({ ...baseInput, properties: { rank: 5 } });
							expect((yield* repository.findRelationship(baseInput))?.properties).toEqual({
								rank: 5,
							});
							return yield* new DbError({ message: "Rollback fixture" });
						}),
					)
					.pipe(Effect.catchTag("DbError", () => Effect.void));
				expect(yield* repository.findRelationship(baseInput)).toEqual(found);
				const updated = yield* repository.updatePreparedRelationship({
					...baseInput,
					before: found,
					properties: { rank: 7 },
				});
				assert(updated);
				expect(updated.properties).toEqual({ rank: 7 });
				expect(
					yield* repository.deletePreparedRelationship({ ...baseInput, before: found }),
				).toBeNull();
				expect(
					yield* repository.deletePreparedRelationship({ ...baseInput, before: updated }),
				).toMatchObject({ id: found.id, properties: { rank: 7 } });
				expect(yield* repository.findRelationship(baseInput)).toBeNull();
			}),
		);
	});
});
