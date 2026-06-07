import { and, desc, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import type { UserId } from "#lib/schema/brands";
import { EntitySchemaId, RelationshipSchemaId } from "#lib/schema/brands";
import { decodeStoredAppSchema } from "#lib/schema/core";

type Row = typeof schema.relationshipSchema.$inferSelect;

const toScope = Effect.fn(function* (row: Row) {
	const propertiesSchema = yield* decodeStoredAppSchema(
		row.propertiesSchema,
		`Invalid propertiesSchema for relationship schema ${row.id}`,
	);

	return {
		id: RelationshipSchemaId.make(row.id),
		slug: row.slug,
		name: row.name,
		propertiesSchema,
		isBuiltin: row.isBuiltin,
		sourceEntitySchemaId: row.sourceEntitySchemaId
			? EntitySchemaId.make(row.sourceEntitySchemaId)
			: null,
		targetEntitySchemaId: row.targetEntitySchemaId
			? EntitySchemaId.make(row.targetEntitySchemaId)
			: null,
	};
});

export class RelationshipSchemasRepository extends Effect.Service<RelationshipSchemasRepository>()(
	"RelationshipSchemasRepository",
	{
		sync: () => ({
			findBuiltinBySlug: Effect.fn("RelationshipSchemasRepository.findBuiltinBySlug")(function* (
				slug: string,
			) {
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
			findGlobalBySchemaIds: Effect.fn("RelationshipSchemasRepository.findGlobalBySchemaIds")(
				function* (input: {
					sourceEntitySchemaId: EntitySchemaId;
					targetEntitySchemaId: EntitySchemaId;
				}) {
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
				},
			),
			findById: Effect.fn("RelationshipSchemasRepository.findById")(function* (
				id: RelationshipSchemaId,
				userId: UserId | null,
			) {
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
