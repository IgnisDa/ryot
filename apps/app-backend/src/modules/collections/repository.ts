import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "#lib/db";

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
	id: row.id,
	name: row.name,
	image: row.image,
	properties: row.properties,
	externalId: row.externalId,
	entitySchemaId: row.entitySchemaId,
	sandboxScriptId: row.sandboxScriptId,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

export class CollectionsRepository extends Effect.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		sync: () => ({
			getBuiltinCollectionSchema: () =>
				Effect.gen(function* () {
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

					return row ?? null;
				}),

			findLibraryEntityForUser: (input: { userId: string; entitySchemaId: string }) =>
				Effect.gen(function* () {
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

					return row ?? null;
				}),

			getUserLibraryEntityId: (input: { userId: string }) =>
				Effect.gen(function* () {
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

					return row?.id ?? null;
				}),

			findCollectionByNameForUser: (input: {
				name: string;
				userId: string;
				entitySchemaId: string;
			}) =>
				Effect.gen(function* () {
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
				}),

			getCollectionById: (collectionId: string, userId: string) =>
				Effect.gen(function* () {
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

			getEntityForMembership: (entityId: string, userId: string) =>
				Effect.gen(function* () {
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

					return row ?? null;
				}),

			findBuiltinEventSchemaBySlug: (entitySchemaId: string, slug: string) =>
				Effect.gen(function* () {
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

					return row ?? null;
				}),
		}),
	},
) {}
