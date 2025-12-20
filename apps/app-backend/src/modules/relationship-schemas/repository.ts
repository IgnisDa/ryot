import { and, desc, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import { decodeStoredAppSchema } from "~/lib/schema";

import type { RelationshipSchemaScope } from "./schemas";

type Row = typeof schema.relationshipSchema.$inferSelect;

const toScope = (row: Row): Effect.Effect<RelationshipSchemaScope, DbError> =>
	Effect.gen(function* () {
		const propertiesSchema = yield* decodeStoredAppSchema(
			row.propertiesSchema,
			`Invalid propertiesSchema for relationship schema ${row.id}`,
		);

		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			propertiesSchema,
			isBuiltin: row.isBuiltin,
			sourceEntitySchemaId: row.sourceEntitySchemaId ?? null,
			targetEntitySchemaId: row.targetEntitySchemaId ?? null,
		};
	});

export class RelationshipSchemasRepository extends Effect.Service<RelationshipSchemasRepository>()(
	"RelationshipSchemasRepository",
	{
		sync: () => ({
			findBuiltinBySlug: (slug: string) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.relationshipSchema)
							.where(
								and(
									eq(schema.relationshipSchema.slug, slug),
									isNull(schema.relationshipSchema.userId),
									eq(schema.relationshipSchema.isBuiltin, true),
								),
							)
							.limit(1),
					);

					if (!row) {
						return null;
					}
					return yield* toScope(row);
				}),
			findGlobalBySchemaIds: (input: {
				sourceEntitySchemaId: string;
				targetEntitySchemaId: string;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.relationshipSchema)
							.where(
								and(
									isNull(schema.relationshipSchema.userId),
									eq(schema.relationshipSchema.sourceEntitySchemaId, input.sourceEntitySchemaId),
									eq(schema.relationshipSchema.targetEntitySchemaId, input.targetEntitySchemaId),
								),
							)
							.orderBy(desc(schema.relationshipSchema.isBuiltin))
							.limit(1),
					);

					if (!row) {
						return null;
					}
					return yield* toScope(row);
				}),
			findById: (id: string, userId: string | null) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.relationshipSchema)
							.where(
								and(
									eq(schema.relationshipSchema.id, id),
									userId !== null
										? or(
												isNull(schema.relationshipSchema.userId),
												eq(schema.relationshipSchema.userId, userId),
											)
										: isNull(schema.relationshipSchema.userId),
								),
							)
							.limit(1),
					);

					if (!row) {
						return null;
					}
					return yield* toScope(row);
				}),
		}),
	},
) {}
