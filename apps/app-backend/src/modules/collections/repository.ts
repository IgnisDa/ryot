import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "../../lib/db";
import { DbError } from "../../lib/errors";
import type { CollectionResponse, MembershipRelationship } from "./schemas";

type CollectionEventSchema = Pick<typeof schema.eventSchema.$inferSelect, "id" | "name" | "slug">;

type CollectionSchema = {
	readonly id: (typeof schema.entitySchema.$inferSelect)["id"];
	readonly entitySchemaId: (typeof schema.entitySchema.$inferSelect)["id"];
	readonly propertiesSchema: Record<string, unknown>;
};

type EntityForMembership = Pick<typeof schema.entity.$inferSelect, "id" | "userId"> & {
	readonly entitySchemaSlug: (typeof schema.entitySchema.$inferSelect)["slug"];
};

type CollectionRow = Pick<
	typeof schema.entity.$inferSelect,
	"id" | "name" | "createdAt" | "updatedAt" | "properties" | "entitySchemaId"
>;

type MembershipRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
>;

type MembershipWithInsertedFlag = MembershipRelationship & {
	readonly wasInserted: boolean;
};

const collectionSelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	properties: schema.entity.properties,
	entitySchemaId: schema.entity.entitySchemaId,
};

const membershipSelection = {
	id: schema.relationship.id,
	createdAt: schema.relationship.createdAt,
	properties: schema.relationship.properties,
	sourceEntityId: schema.relationship.sourceEntityId,
	targetEntityId: schema.relationship.targetEntityId,
	relationshipSchemaId: schema.relationship.relationshipSchemaId,
	wasInserted: sql<boolean>`(xmax = '0'::xid)`,
};

const toCollectionResponse = (row: CollectionRow): CollectionResponse => ({
	id: row.id,
	name: row.name,
	properties: row.properties,
	entitySchemaId: row.entitySchemaId,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

const toMembershipRelationship = (row: MembershipRow): MembershipRelationship => ({
	id: row.id,
	properties: row.properties,
	sourceEntityId: row.sourceEntityId,
	targetEntityId: row.targetEntityId,
	createdAt: row.createdAt.toISOString(),
	relationshipSchemaId: row.relationshipSchemaId,
});

type CollectionsRepositoryShape = {
	readonly getBuiltinCollectionSchema: () => Effect.Effect<
		CollectionSchema | null,
		DbError,
		CurrentDb
	>;
	readonly createLibraryEntityForUser: (input: {
		userId: string;
		entitySchemaId: string;
	}) => Effect.Effect<{ id: string }, DbError, CurrentDb>;
	readonly getUserLibraryEntityId: (input: {
		userId: string;
	}) => Effect.Effect<string | null, DbError, CurrentDb>;
	readonly createCollectionForUser: (input: {
		name: string;
		userId: string;
		entitySchemaId: string;
		properties: Record<string, unknown>;
	}) => Effect.Effect<CollectionResponse, DbError, CurrentDb>;
	readonly getCollectionById: (
		collectionId: string,
		userId: string,
	) => Effect.Effect<CollectionResponse | null, DbError, CurrentDb>;
	readonly getEntityForMembership: (
		entityId: string,
		userId: string,
	) => Effect.Effect<EntityForMembership | null, DbError, CurrentDb>;
	readonly upsertMembership: (input: {
		userId: string;
		entityId: string;
		collectionId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	}) => Effect.Effect<MembershipWithInsertedFlag, DbError, CurrentDb>;
	readonly deleteMembership: (input: {
		userId: string;
		entityId: string;
		collectionId: string;
		relationshipSchemaId: string;
	}) => Effect.Effect<MembershipRelationship | null, DbError, CurrentDb>;
	readonly findBuiltinEventSchemaBySlug: (
		entitySchemaId: string,
		slug: string,
	) => Effect.Effect<CollectionEventSchema | null, DbError, CurrentDb>;
};

export class CollectionsRepository extends Effect.Service<CollectionsRepository>()(
	"CollectionsRepository",
	{
		sync: (): CollectionsRepositoryShape => ({
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

			createLibraryEntityForUser: (input: { userId: string; entitySchemaId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [existing] = yield* dbEffect(() =>
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

					if (existing) {
						return existing;
					}

					const [created] = yield* dbEffect(() =>
						db
							.insert(schema.entity)
							.values({
								properties: {},
								name: "Library",
								externalId: null,
								userId: input.userId,
								sandboxScriptId: null,
								entitySchemaId: input.entitySchemaId,
							})
							.returning({ id: schema.entity.id }),
					);

					if (!created) {
						return yield* new DbError({ message: "Library entity insert returned no row" });
					}

					return created;
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

			createCollectionForUser: (input: {
				name: string;
				userId: string;
				entitySchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.insert(schema.entity)
							.values({
								externalId: null,
								name: input.name,
								userId: input.userId,
								sandboxScriptId: null,
								properties: input.properties,
								entitySchemaId: input.entitySchemaId,
							})
							.returning(collectionSelection),
					);

					if (!row) {
						return yield* new DbError({ message: "Collection insert returned no row" });
					}

					return toCollectionResponse(row);
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

			upsertMembership: (input: {
				userId: string;
				entityId: string;
				collectionId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.insert(schema.relationship)
							.values({
								userId: input.userId,
								properties: input.properties,
								sourceEntityId: input.entityId,
								targetEntityId: input.collectionId,
								relationshipSchemaId: input.relationshipSchemaId,
							})
							.onConflictDoUpdate({
								set: { properties: input.properties },
								target: [
									schema.relationship.userId,
									schema.relationship.sourceEntityId,
									schema.relationship.targetEntityId,
									schema.relationship.relationshipSchemaId,
								],
							})
							.returning(membershipSelection),
					);

					if (!row) {
						return yield* new DbError({ message: "Membership upsert returned no row" });
					}

					return {
						...toMembershipRelationship(row),
						wasInserted: row.wasInserted,
					};
				}),

			deleteMembership: (input: {
				userId: string;
				entityId: string;
				collectionId: string;
				relationshipSchemaId: string;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.delete(schema.relationship)
							.where(
								and(
									eq(schema.relationship.userId, input.userId),
									eq(schema.relationship.sourceEntityId, input.entityId),
									eq(schema.relationship.targetEntityId, input.collectionId),
									eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
								),
							)
							.returning({
								id: schema.relationship.id,
								createdAt: schema.relationship.createdAt,
								properties: schema.relationship.properties,
								sourceEntityId: schema.relationship.sourceEntityId,
								targetEntityId: schema.relationship.targetEntityId,
								relationshipSchemaId: schema.relationship.relationshipSchemaId,
							}),
					);

					return row ? toMembershipRelationship(row) : null;
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
