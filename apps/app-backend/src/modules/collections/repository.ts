import type { UserId } from "@ryot/contract/schema/brands";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type CollectionRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
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
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	externalId: schema.entity.externalId,
	properties: schema.entity.properties,
	entitySchemaId: schema.entity.entitySchemaId,
	sandboxScriptId: schema.entity.sandboxScriptId,
};

const toCollectionResponse = (row: CollectionRow) => ({
	name: row.name,
	properties: row.properties,
	externalId: row.externalId,
	id: EntityId.make(row.id),
	entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	sandboxScriptId: row.sandboxScriptId ? SandboxScriptId.make(row.sandboxScriptId) : null,
});

export class CollectionsRepository extends Effect.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		sync: () => {
			const getBuiltinCollectionSchema = Effect.fn(
				"CollectionsRepository.getBuiltinCollectionSchema",
			)(function* () {
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
			});

			const getUserLibraryEntityId = Effect.fn("CollectionsRepository.getUserLibraryEntityId")(
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
			);

			const findCollectionByNameForUser = Effect.fn(
				"CollectionsRepository.findCollectionByNameForUser",
			)(function* (input: { name: string; userId: UserId; entitySchemaId: EntitySchemaId }) {
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
			});

			const getEntityForMembership = Effect.fn("CollectionsRepository.getEntityForMembership")(
				function* (entityId: EntityId, userId: UserId) {
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
				},
			);

			const findBuiltinEventSchemaBySlug = Effect.fn(
				"CollectionsRepository.findBuiltinEventSchemaBySlug",
			)(function* (entitySchemaId: EntitySchemaId, slug: string) {
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
			});

			return {
				getBuiltinCollectionSchema,
				getUserLibraryEntityId,
				findCollectionByNameForUser,
				getCollectionById,
				getEntityForMembership,
				findBuiltinEventSchemaBySlug,
			};
		},
	},
) {}
