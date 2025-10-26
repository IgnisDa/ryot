import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import type { UserId } from "#lib/schema/brands";
import { EntityId, EntitySchemaId, EventSchemaId, SandboxScriptId } from "#lib/schema/brands";

type CollectionRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "image"
	| "createdAt"
	| "updatedAt"
	| "externalId"
	| "properties"
	| "entitySchemaId"
	| "sandboxScriptId"
>;

const collectionSelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	image: schema.entity.image,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	externalId: schema.entity.externalId,
	properties: schema.entity.properties,
	entitySchemaId: schema.entity.entitySchemaId,
	sandboxScriptId: schema.entity.sandboxScriptId,
};

const toCollectionResponse = (row: CollectionRow) => ({
	id: EntityId.make(row.id),
	name: row.name,
	image: row.image,
	properties: row.properties,
	externalId: row.externalId,
	entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	sandboxScriptId: row.sandboxScriptId ? SandboxScriptId.make(row.sandboxScriptId) : null,
});

export class CollectionsRepository extends Effect.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		sync: () => ({
			getBuiltinCollectionSchema: Effect.fn("CollectionsRepository.getBuiltinCollectionSchema")(
				function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({
								id: schema.entitySchema.id,
								entitySchemaId: schema.entitySchema.id,
								propertiesSchema: schema.entitySchema.propertiesSchema,
							})
							.from(schema.entitySchema)
							.where(
								and(
									eq(schema.entitySchema.slug, "collection"),
									eq(schema.entitySchema.isBuiltin, true),
									isNull(schema.entitySchema.userId),
								),
							)
							.limit(1),
					);

					return row
						? {
								id: EntitySchemaId.make(row.id),
								entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
								propertiesSchema: row.propertiesSchema,
							}
						: null;
				},
			),

			findLibraryEntityForUser: Effect.fn("CollectionsRepository.findLibraryEntityForUser")(
				function* (input: { userId: UserId; entitySchemaId: EntitySchemaId }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.entitySchemaId, input.entitySchemaId),
									isNull(schema.entity.externalId),
									isNull(schema.entity.sandboxScriptId),
								),
							)
							.limit(1),
					);

					return row ? { id: EntityId.make(row.id) } : null;
				},
			),

			getUserLibraryEntityId: Effect.fn("CollectionsRepository.getUserLibraryEntityId")(
				function* (input: { userId: UserId }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.innerJoin(
								schema.entitySchema,
								eq(schema.entity.entitySchemaId, schema.entitySchema.id),
							)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entitySchema.slug, "library"),
									isNull(schema.entitySchema.userId),
								),
							)
							.limit(1),
					);

					return row ? EntityId.make(row.id) : null;
				},
			),

			findCollectionByNameForUser: Effect.fn("CollectionsRepository.findCollectionByNameForUser")(
				function* (input: { name: string; userId: UserId; entitySchemaId: EntitySchemaId }) {
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
									isNull(schema.entity.sandboxScriptId),
									eq(schema.entity.entitySchemaId, input.entitySchemaId),
								),
							)
							.limit(1),
					);

					return row ? toCollectionResponse(row) : null;
				},
			),

			getCollectionById: Effect.fn("CollectionsRepository.getCollectionById")(function* (
				collectionId: EntityId,
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(collectionSelection)
						.from(schema.entity)
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(
							and(
								eq(schema.entity.id, collectionId),
								eq(schema.entity.userId, userId),
								eq(schema.entitySchema.slug, "collection"),
								eq(schema.entitySchema.isBuiltin, true),
							),
						)
						.limit(1),
				);

				return row ? toCollectionResponse(row) : null;
			}),

			getEntityForMembership: Effect.fn("CollectionsRepository.getEntityForMembership")(function* (
				entityId: EntityId,
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							id: schema.entity.id,
							userId: schema.entity.userId,
							entitySchemaSlug: schema.entitySchema.slug,
						})
						.from(schema.entity)
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(
							and(
								eq(schema.entity.id, entityId),
								or(isNull(schema.entity.userId), eq(schema.entity.userId, userId)),
								or(isNull(schema.entitySchema.userId), eq(schema.entitySchema.userId, userId)),
							),
						)
						.limit(1),
				);

				return row ? { ...row, id: EntityId.make(row.id) } : null;
			}),

			findBuiltinEventSchemaBySlug: Effect.fn("CollectionsRepository.findBuiltinEventSchemaBySlug")(
				function* (entitySchemaId: EntitySchemaId, slug: string) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({
								id: schema.eventSchema.id,
								name: schema.eventSchema.name,
								slug: schema.eventSchema.slug,
							})
							.from(schema.eventSchema)
							.where(
								and(
									eq(schema.eventSchema.entitySchemaId, entitySchemaId),
									eq(schema.eventSchema.slug, slug),
									isNull(schema.eventSchema.userId),
								),
							)
							.limit(1),
					);

					return row ? { ...row, id: EventSchemaId.make(row.id) } : null;
				},
			),
		}),
	},
) {}
