import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";

type CollectionRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "externalId"
	| "properties"
	| "entitySchemaSlug"
	| "providerId"
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
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
	providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
});

export class CollectionsRepository extends Context.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const getBuiltinCollectionSchema = Effect.fn(
				"CollectionsRepository.getBuiltinCollectionSchema",
			)(function* () {
				const definition = yield* definitions.findGlobalEntitySchema("collection");
				return definition
					? {
							id: EntitySchemaSlug.make(definition.slug),
							propertiesSchema: definition.propertiesSchema,
							entitySchemaSlug: EntitySchemaSlug.make(definition.slug),
						}
					: null;
			});

			const findCollectionByNameForUser = Effect.fn(
				"CollectionsRepository.findCollectionByNameForUser",
			)(function* (input: { name: string; userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(collectionSelection)
						.from(schema.entity)
						.where(
							and(
								eq(schema.entity.name, input.name),
								eq(schema.entity.userId, input.userId),
								isNull(schema.entity.externalId),
								isNull(schema.entity.providerId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
							),
						)
						.limit(1),
				);

				return row ? toCollectionResponse(row) : null;
			});

			const getCollectionById = Effect.fn("CollectionsRepository.getCollectionById")(function* (
				collectionId: EntityId,
				userId: UserId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(collectionSelection)
						.from(schema.entity)
						.where(
							and(
								eq(schema.entity.id, collectionId),
								eq(schema.entity.userId, userId),
								eq(schema.entity.entitySchemaSlug, "collection"),
							),
						)
						.limit(1),
				);

				return row ? toCollectionResponse(row) : null;
			});

			const getEntityForMembership = Effect.fn("CollectionsRepository.getEntityForMembership")(
				function* (entityId: EntityId, userId: UserId) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({
								id: schema.entity.id,
								userId: schema.entity.userId,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
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
			)(function* (entitySchemaSlug: EntitySchemaSlug, slug: string) {
				const event = yield* definitions.findGlobalEventSchema(entitySchemaSlug, slug);
				return event ? { ...event, id: EventSchemaSlug.make(event.slug) } : null;
			});

			return {
				getCollectionById,
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
