import { and, eq, isNull, or } from "drizzle-orm";
import { Context, Effect, Either, Layer, Schema } from "effect";

import { CurrentDb, dbEffect, schema } from "../../lib/db";
import { DbError } from "../../lib/errors";
import { AppSchema } from "../../lib/schema";
import type { RelationshipSchemaScope } from "./schemas";

type Row = typeof schema.relationshipSchema.$inferSelect;

const toScope = (row: Row): Effect.Effect<RelationshipSchemaScope, DbError> =>
	Effect.gen(function* () {
		const decoded = Schema.decodeUnknownEither(AppSchema)(row.propertiesSchema);
		if (Either.isLeft(decoded)) {
			return yield* new DbError({
				message: `Invalid propertiesSchema for relationship schema ${row.id}`,
			});
		}

		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			isBuiltin: row.isBuiltin,
			propertiesSchema: decoded.right,
			sourceEntitySchemaId: row.sourceEntitySchemaId ?? null,
			targetEntitySchemaId: row.targetEntitySchemaId ?? null,
		};
	});

export class RelationshipSchemasRepository extends Context.Tag("RelationshipSchemasRepository")<
	RelationshipSchemasRepository,
	{
		readonly findBuiltinBySlug: (
			slug: string,
		) => Effect.Effect<RelationshipSchemaScope | null, DbError, CurrentDb>;
		readonly findById: (
			id: string,
			userId: string | null,
		) => Effect.Effect<RelationshipSchemaScope | null, DbError, CurrentDb>;
	}
>() {}

export const RelationshipSchemasRepositoryLive = Layer.succeed(RelationshipSchemasRepository, {
	findBuiltinBySlug: (slug) =>
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
	findById: (id, userId) =>
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
});
