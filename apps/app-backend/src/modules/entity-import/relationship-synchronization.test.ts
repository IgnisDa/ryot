import { assert, expect, it } from "@effect/vitest";
import { EntityId, RelationshipId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { synchronizeGlobalRelationships } from "./relationship-synchronization";

const anchorEntityId = EntityId.make("anchor");
const relationshipSchemaId = RelationshipSchemaId.make("credits");
const entityId = (value: string) => EntityId.make(value);
const assertRecord: (value: unknown) => asserts value is Record<string, unknown> = (value) => {
	assert(typeof value === "object" && value !== null && !Array.isArray(value));
};

const relationship = (input: {
	id: string;
	target: string;
	createdAt: string;
	wasInserted?: boolean;
	properties: Record<string, unknown>;
}) => ({
	relationshipSchemaId,
	createdAt: input.createdAt,
	properties: input.properties,
	sourceEntityId: anchorEntityId,
	id: RelationshipId.make(input.id),
	wasInserted: input.wasInserted ?? false,
	targetEntityId: entityId(input.target),
});

it.effect(
	"returns ordered create, update, delete, and noop outcomes with endpoint snapshots",
	() => {
		const updates: string[] = [];
		const existing = [
			relationship({
				id: "stale",
				target: "stale",
				properties: { roles: ["producer"] },
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
			relationship({
				id: "same",
				target: "same",
				properties: { roles: ["actor"] },
				createdAt: "2026-01-03T00:00:00.000Z",
			}),
			relationship({
				id: "changed",
				target: "changed",
				properties: { roles: ["actor"] },
				createdAt: "2026-01-02T00:00:00.000Z",
			}),
		];
		const stale = existing[0];
		assert(stale);
		const entitiesRepository = Layer.mock(EntitiesRepository)({
			_tag: "EntitiesRepository",
			listEntityReferencesByIds: (ids) =>
				Effect.succeed(
					ids.map((id) => ({
						id,
						name: id === anchorEntityId ? "Movie" : `Person ${id}`,
						entitySchemaSlug: id === anchorEntityId ? "movie" : "person",
					})),
				),
		});
		const relationshipsRepository = Layer.mock(RelationshipsRepository)({
			_tag: "RelationshipsRepository",
			listGlobalRelationships: () => Effect.succeed(existing),
		});
		const relationshipsService = Layer.mock(RelationshipsService)({
			_tag: "RelationshipsService",
			create: (input) => {
				assertRecord(input.properties);
				if (input.targetEntityId === "created") {
					return Effect.succeed(
						relationship({
							id: "created",
							target: "created",
							wasInserted: true,
							properties: input.properties,
							createdAt: "2026-01-04T00:00:00.000Z",
						}),
					);
				}
				const properties =
					input.targetEntityId === "conflict-update" ? { roles: ["actor"] } : input.properties;
				return Effect.succeed(
					relationship({
						properties,
						wasInserted: false,
						target: input.targetEntityId,
						createdAt: "2026-01-05T00:00:00.000Z",
						id: `relationship-${input.targetEntityId}`,
					}),
				);
			},
			update: (input) => {
				assertRecord(input.properties);
				updates.push(input.targetEntityId);
				return Effect.succeed(
					relationship({
						wasInserted: false,
						target: input.targetEntityId,
						properties: input.properties,
						id: `updated-${input.targetEntityId}`,
						createdAt: "2026-01-06T00:00:00.000Z",
					}),
				);
			},
			delete: () => Effect.succeed(stale),
		});
		const layer = Layer.mergeAll(
			dbRunnerLayer,
			entitiesRepository,
			relationshipsRepository,
			relationshipsService,
		);

		return Effect.gen(function* () {
			const outcomes = yield* synchronizeGlobalRelationships({
				anchorEntityId,
				relationshipSchemaId,
				direction: "outgoing",
				onConflict: "replaceProperties",
				synchronization: "authoritative",
				propertiesSchema: { fields: {} },
				relationshipSchemaSlug: "credits",
				entries: [
					{ entityId: entityId("created"), properties: { roles: ["actor"] } },
					{ entityId: entityId("same"), properties: { roles: ["actor"] } },
					{ entityId: entityId("changed"), properties: { roles: ["actor", "director"] } },
					{
						entityId: entityId("conflict-update"),
						properties: { roles: ["actor", "director"] },
					},
					{ entityId: entityId("conflict-noop"), properties: { roles: ["actor"] } },
				],
			});

			expect(outcomes.map((outcome) => outcome.operation)).toEqual([
				"create",
				"noop",
				"update",
				"update",
				"noop",
				"delete",
			]);
			expect(updates).toEqual(["changed", "conflict-update"]);
			expect(outcomes[0]?.after).toMatchObject({
				relationshipSchemaSlug: "credits",
				sourceEntity: { id: anchorEntityId, name: "Movie", entitySchemaSlug: "movie" },
				targetEntity: {
					name: "Person created",
					entitySchemaSlug: "person",
					id: entityId("created"),
				},
			});
			expect(outcomes[3]?.before?.properties).toEqual({ roles: ["actor"] });
			expect(outcomes[3]?.after?.properties).toEqual({ roles: ["actor", "director"] });
			const deleted = outcomes[5];
			assert(deleted?.operation === "delete");
			expect(deleted.before.id).toBe("stale");
			expect(deleted.after).toBeNull();
		}).pipe(Effect.provide(layer));
	},
);

it.effect("preserves different existing properties as a noop", () => {
	let updated = false;
	const current = relationship({
		id: "existing",
		target: "person",
		properties: { roles: ["actor"] },
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		Layer.mock(EntitiesRepository)({
			_tag: "EntitiesRepository",
			listEntityReferencesByIds: (ids) =>
				Effect.succeed(ids.map((id) => ({ id, name: `Entity ${id}`, entitySchemaSlug: "person" }))),
		}),
		Layer.mock(RelationshipsRepository)({
			_tag: "RelationshipsRepository",
			listGlobalRelationships: () => Effect.succeed([current]),
		}),
		Layer.mock(RelationshipsService)({
			_tag: "RelationshipsService",
			update: () =>
				Effect.sync(() => {
					updated = true;
					return current;
				}),
		}),
	);

	return Effect.gen(function* () {
		const outcomes = yield* synchronizeGlobalRelationships({
			anchorEntityId,
			relationshipSchemaId,
			direction: "outgoing",
			synchronization: "additive",
			onConflict: "preserveExisting",
			propertiesSchema: { fields: {} },
			relationshipSchemaSlug: "credits",
			entries: [{ entityId: entityId("person"), properties: { roles: ["director"] } }],
		});

		expect(outcomes).toHaveLength(1);
		expect(outcomes[0]?.operation).toBe("noop");
		expect(outcomes[0]?.before).toEqual(outcomes[0]?.after);
		expect(updated).toBe(false);
	}).pipe(Effect.provide(layer));
});
