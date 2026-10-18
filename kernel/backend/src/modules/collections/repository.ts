import type {
	EntitySchemaReference,
	EventSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

type CollectionRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "externalId"
	| "properties"
	| "providerId"
	| "entitySchemaSlug"
>;

const collectionSelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	externalId: schema.entity.externalId,
	properties: schema.entity.properties,
	providerId: schema.entity.providerId,
	entitySchemaSlug: schema.entity.entitySchemaSlug,
};

const toCollectionResponse = (row: CollectionRow) => ({
	name: row.name,
	id: EntityId.make(row.id),
	properties: row.properties,
	externalId: row.externalId,
	entitySchemaPluginId: null,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
	providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
});

const userCollectionWhere = (userId: UserId) =>
	and(
		eq(schema.entity.userId, userId),
		eq(schema.entity.entitySchemaSlug, "collection"),
		isNull(schema.entity.entitySchemaPluginId),
	);

const membershipWhere = (input: { userId: UserId; collectionId: EntityId }) =>
	and(
		eq(schema.relationship.userId, input.userId),
		eq(schema.relationship.targetEntityId, input.collectionId),
		eq(schema.relationship.relationshipSchemaSlug, "member-of"),
		isNull(schema.relationship.relationshipSchemaPluginId),
	);

export class CollectionsRepository extends Context.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const definitions = yield* DefinitionRepository;
			const getBuiltinCollectionSchema = Effect.fn(
				"CollectionsRepository.getBuiltinCollectionSchema",
			)(function* () {
				const definition = yield* definitions.findGlobalEntitySchema({
					owner: { kind: "kernel" },
					slug: EntitySchemaSlug.make("collection"),
				});
				return definition
					? {
							id: EntitySchemaSlug.make(definition.slug),
							propertiesSchema: definition.propertiesSchema,
							entitySchemaSlug: EntitySchemaSlug.make(definition.slug),
							entitySchema: {
								owner: { kind: "kernel" },
								slug: EntitySchemaSlug.make(definition.slug),
							} satisfies EntitySchemaReference,
						}
					: null;
			});

			const findCollectionByNameForUser = Effect.fn(
				"CollectionsRepository.findCollectionByNameForUser",
			)(function* (input: { name: string; userId: UserId }) {
				const [row] = yield* session.run((db) =>
					db
						.select(collectionSelection)
						.from(schema.entity)
						.where(and(eq(schema.entity.name, input.name), userCollectionWhere(input.userId)))
						.limit(1),
				);

				return row ? toCollectionResponse(row) : null;
			});

			const findMembership = Effect.fn("CollectionsRepository.findMembership")(function* (input: {
				userId: UserId;
				entityId: EntityId;
				collectionId: EntityId;
			}) {
				const [row] = yield* session.run((db) =>
					db
						.select({ id: schema.relationship.id, properties: schema.relationship.properties })
						.from(schema.relationship)
						.where(
							and(membershipWhere(input), eq(schema.relationship.sourceEntityId, input.entityId)),
						)
						.limit(1),
				);

				return row ? { ...row, id: RelationshipId.make(row.id) } : null;
			});

			const findLowestMemberRank = Effect.fn("CollectionsRepository.findLowestMemberRank")(
				function* (input: { userId: UserId; collectionId: EntityId }) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								rank: sql<
									null | number
								>`min(case when jsonb_typeof(${schema.relationship.properties} -> 'rank') = 'number' then (${schema.relationship.properties} ->> 'rank')::double precision end)`,
							})
							.from(schema.relationship)
							.where(membershipWhere(input)),
					);

					return row?.rank ?? null;
				},
			);

			const getCollectionById = Effect.fn("CollectionsRepository.getCollectionById")(function* (
				collectionId: EntityId,
				userId: UserId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select(collectionSelection)
						.from(schema.entity)
						.where(and(eq(schema.entity.id, collectionId), userCollectionWhere(userId)))
						.limit(1),
				);

				return row ? toCollectionResponse(row) : null;
			});

			const getEntityForMembership = Effect.fn("CollectionsRepository.getEntityForMembership")(
				function* (entityId: EntityId, userId: UserId) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								id: schema.entity.id,
								userId: schema.entity.userId,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.id, entityId),
									or(isNull(schema.entity.userId), eq(schema.entity.userId, userId)),
								),
							)
							.limit(1),
					);

					return row ? { ...row, id: EntityId.make(row.id) } : null;
				},
			);

			const findBuiltinEventSchemaBySlug = Effect.fn(
				"CollectionsRepository.findBuiltinEventSchemaBySlug",
			)(function* (reference: EventSchemaReference) {
				const event = yield* definitions.findGlobalEventSchema(reference);
				return event ? { ...event, id: EventSchemaSlug.make(event.slug) } : null;
			});

			return {
				findMembership,
				getCollectionById,
				findLowestMemberRank,
				getEntityForMembership,
				getBuiltinCollectionSchema,
				findCollectionByNameForUser,
				findBuiltinEventSchemaBySlug,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
