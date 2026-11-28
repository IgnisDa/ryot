import { describe, expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { WriteTransaction } from "#platform/db/write-transaction";

import { baseInput, relationshipDatabaseLayer } from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";

describe("RelationshipsRepository PostgreSQL", () => {
	layer(relationshipDatabaseLayer())((test) => {
		test.effect(
			"returns complete persisted snapshots and obeys the active transaction",
			() =>
				Effect.gen(function* () {
					const repository = yield* RelationshipsRepository;
					const session = yield* DatabaseSession;
					const created = yield* repository.createRelationship(new WriteTransaction(), baseInput);
					const found = yield* repository.findRelationship(baseInput);
					assert(found);
					expect(found).toEqual({
						id: created.id,
						properties: { rank: 1 },
						createdAt: created.createdAt,
						updatedAt: created.updatedAt,
						relationshipSchemaPluginId: null,
						sourceEntityId: baseInput.sourceEntityId,
						targetEntityId: baseInput.targetEntityId,
						relationshipSchemaSlug: baseInput.relationshipSchemaSlug,
					});
					yield* session
						.transaction(
							Effect.gen(function* () {
								yield* repository.lockRelationshipMutations([baseInput]);
								yield* repository.updateRelationshipsById([
									{
										id: created.id,
										properties: { rank: 5 },
										targetEntityId: created.targetEntityId,
									},
								]);
								expect((yield* repository.findRelationship(baseInput))?.properties).toEqual({
									rank: 5,
								});
								return yield* new DbError({ message: "Rollback fixture" });
							}),
						)
						.pipe(Effect.catchTag("DbError", () => Effect.void));
					expect(yield* repository.findRelationship(baseInput)).toEqual(found);
					const updated = yield* repository.updateRelationshipsById([
						{ id: found.id, properties: { rank: 7 }, targetEntityId: found.targetEntityId },
					]);
					expect(updated.get(found.id)?.properties).toEqual({ rank: 7 });
					expect(
						(yield* repository.deleteRelationshipsById([found.id])).get(found.id),
					).toMatchObject({ id: found.id, properties: { rank: 7 } });
					expect(yield* repository.findRelationship(baseInput)).toBeNull();
				}),
			testTimeout,
		);
	});
});
