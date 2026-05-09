import { and, asc, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError, schema } from "#lib/db";
import { entitySchemaAccessScopeSelection } from "#lib/db/schema";
import { DbError, conflict } from "#lib/errors";
import type { AppSchema } from "#lib/schema/core";
import { decodeStoredAppSchema } from "#lib/schema/core";

import type { ListedEventSchema } from "./schemas";

type ListedEventSchemaRow = Pick<
	typeof schema.eventSchema.$inferSelect,
	"id" | "name" | "slug" | "entitySchemaId" | "propertiesSchema"
>;

const eventSchemaUserEntitySchemaSlugConstraint = "event_schema_user_entity_schema_slug_unique";

const listedEventSchemaSelection = {
	id: schema.eventSchema.id,
	name: schema.eventSchema.name,
	slug: schema.eventSchema.slug,
	entitySchemaId: schema.eventSchema.entitySchemaId,
	propertiesSchema: schema.eventSchema.propertiesSchema,
};

const toListedEventSchema = (
	row: ListedEventSchemaRow,
): Effect.Effect<ListedEventSchema, DbError> =>
	Effect.gen(function* () {
		const propertiesSchema = yield* decodeStoredAppSchema(
			row.propertiesSchema,
			"Invalid properties schema in database",
		);

		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			propertiesSchema,
			entitySchemaId: row.entitySchemaId,
		};
	});

export class EventSchemasRepository extends Effect.Service<EventSchemasRepository>()(
	"EventSchemasRepository",
	{
		sync: () => ({
			getEntitySchemaScopeById: (input: { entitySchemaId: string; userId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select(entitySchemaAccessScopeSelection)
							.from(schema.entitySchema)
							.where(
								and(
									eq(schema.entitySchema.id, input.entitySchemaId),
									or(
										isNull(schema.entitySchema.userId),
										eq(schema.entitySchema.userId, input.userId),
									),
								),
							)
							.limit(1),
					);

					return row ?? null;
				}),
			getScopeForUser: (input: { eventSchemaId: string; userId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select(listedEventSchemaSelection)
							.from(schema.eventSchema)
							.where(
								and(
									eq(schema.eventSchema.id, input.eventSchemaId),
									or(
										isNull(schema.eventSchema.userId),
										eq(schema.eventSchema.userId, input.userId),
									),
								),
							)
							.limit(1),
					);

					if (!row) {
						return null;
					}

					return yield* toListedEventSchema(row);
				}),
			getBuiltinBySlug: (input: { entitySchemaId: string; slug: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({
								id: schema.eventSchema.id,
								propertiesSchema: schema.eventSchema.propertiesSchema,
							})
							.from(schema.eventSchema)
							.where(
								and(
									eq(schema.eventSchema.slug, input.slug),
									isNull(schema.eventSchema.userId),
									eq(schema.eventSchema.isBuiltin, true),
									eq(schema.eventSchema.entitySchemaId, input.entitySchemaId),
								),
							)
							.limit(1),
					);
					if (!row) {
						return null;
					}
					const propertiesSchema = yield* decodeStoredAppSchema(
						row.propertiesSchema,
						"Invalid event properties schema in database",
					);
					return { id: row.id, propertiesSchema };
				}),
			createEventSchema: (input: {
				name: string;
				slug: string;
				userId: string;
				entitySchemaId: string;
				propertiesSchema: AppSchema;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const result = yield* dbEffect(() =>
						db
							.insert(schema.eventSchema)
							.values({
								isBuiltin: false,
								name: input.name,
								slug: input.slug,
								userId: input.userId,
								entitySchemaId: input.entitySchemaId,
								propertiesSchema: input.propertiesSchema,
							})
							.returning(listedEventSchemaSelection),
					).pipe(
						Effect.mapError((error) =>
							isUniqueConstraintError(eventSchemaUserEntitySchemaSlugConstraint)(error)
								? conflict("Event schema slug already exists")
								: error,
						),
					);

					const row = result[0];
					if (!row) {
						return yield* new DbError({ message: "Event schema insert returned no row" });
					}

					return yield* toListedEventSchema(row);
				}),
			findBySlugForUser: (input: { entitySchemaId: string; slug: string; userId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.eventSchema.id })
							.from(schema.eventSchema)
							.where(
								and(
									eq(schema.eventSchema.userId, input.userId),
									eq(schema.eventSchema.entitySchemaId, input.entitySchemaId),
									eq(schema.eventSchema.slug, input.slug),
								),
							)
							.limit(1),
					);

					return row ?? null;
				}),
			listByEntitySchemaForUser: (input: { entitySchemaId: string; userId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select(listedEventSchemaSelection)
							.from(schema.eventSchema)
							.where(
								and(
									or(
										isNull(schema.eventSchema.userId),
										eq(schema.eventSchema.userId, input.userId),
									),
									eq(schema.eventSchema.entitySchemaId, input.entitySchemaId),
								),
							)
							.orderBy(asc(schema.eventSchema.name), asc(schema.eventSchema.createdAt)),
					);

					return yield* Effect.forEach(rows, toListedEventSchema);
				}),
		}),
	},
) {}
