import type { UserId } from "@ryot/contract/schema/brands";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	SandboxProviderId,
} from "@ryot/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";

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
	entitySchemaSlug: schema.entity.entitySchemaSlug,
	providerId: schema.entity.providerId,
};

const toCollectionResponse = (row: CollectionRow) => ({
	name: row.name,
	properties: row.properties,
	externalId: row.externalId,
	id: EntityId.make(row.id),
	entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
});

export class CollectionsRepository extends Effect.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		effect: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const getBuiltinCollectionSchema = Effect.fn(
				"CollectionsRepository.getBuiltinCollectionSchema",
			)(() => {
				const definition = definitions.getEntitySchema("collection");
				return Effect.succeed(
					definition
						? {
								id: EntitySchemaSlug.make(definition.slug),
								entitySchemaSlug: EntitySchemaSlug.make(definition.slug),
								propertiesSchema: definition.propertiesSchema,
							}
						: null,
				);
			});

			const findLibraryEntityForUser = Effect.fn("CollectionsRepository.findLibraryEntityForUser")(
				function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									isNull(schema.entity.externalId),
									isNull(schema.entity.providerId),
								),
							)
							.limit(1),
					);

					return row ? { id: EntityId.make(row.id) } : null;
				},
			);

			const getUserLibraryEntityId = Effect.fn("CollectionsRepository.getUserLibraryEntityId")(
				function* (input: { userId: UserId }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.entitySchemaSlug, "library"),
								),
							)
							.limit(1),
					);

					return row ? EntityId.make(row.id) : null;
				},
			);

			const findCollectionByNameForUser = Effect.fn(
				"CollectionsRepository.findCollectionByNameForUser",
			)(function* (input: { name: string; userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
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
			)((entitySchemaSlug: EntitySchemaSlug, slug: string) => {
				const event = definitions.getEventSchema(entitySchemaSlug, slug);
				return Effect.succeed(event ? { ...event, id: EventSchemaSlug.make(event.slug) } : null);
			});

			return {
				getBuiltinCollectionSchema,
				findLibraryEntityForUser,
				getUserLibraryEntityId,
				findCollectionByNameForUser,
				getCollectionById,
				getEntityForMembership,
				findBuiltinEventSchemaBySlug,
			};
		}),
	},
) {}
