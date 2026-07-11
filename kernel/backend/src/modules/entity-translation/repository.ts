import { DbError } from "@ryot-app/contract/errors";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type TranslationOverlayInput = {
	language: string;
	populatedAt: Date;
	entityId: EntityId;
	name: string | null;
	properties: Record<string, unknown> | null;
};

type RestoreTranslationInput = Pick<
	typeof schema.entityTranslation.$inferInsert,
	"id" | "name" | "entityId" | "language" | "properties" | "populatedAt" | "createdAt" | "updatedAt"
>;

const extractLanguage = (preferences: Record<string, unknown>): string | null => {
	const language = preferences["language"];
	return typeof language === "string" && language.length > 0 ? language : null;
};

export class TranslationsRepository extends Context.Service<TranslationsRepository>()(
	"TranslationsRepository",
	{
		make: Effect.sync(() => {
			const listForBackup = Effect.fn("TranslationsRepository.listForBackup")(function* (
				entityIds: ReadonlyArray<EntityId>,
			) {
				if (entityIds.length === 0) {
					return [];
				}
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.entityTranslation)
						.where(inArray(schema.entityTranslation.entityId, [...entityIds]))
						.orderBy(asc(schema.entityTranslation.entityId), asc(schema.entityTranslation.id)),
				);
			});

			const restoreTranslation = Effect.fn("TranslationsRepository.restoreTranslation")(function* (
				input: RestoreTranslationInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.entityTranslation)
						.values(input)
						.returning({ id: schema.entityTranslation.id }),
				);
				return row?.id ?? (yield* new DbError({ message: "Translation restore returned no row" }));
			});

			const upsertOverlay = Effect.fn("TranslationsRepository.upsertOverlay")(function* (
				input: TranslationOverlayInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.entityTranslation)
						.values({
							name: input.name,
							entityId: input.entityId,
							language: input.language,
							properties: input.properties,
							populatedAt: input.populatedAt,
						})
						.onConflictDoUpdate({
							target: [schema.entityTranslation.entityId, schema.entityTranslation.language],
							set: {
								updatedAt: sql`now()`,
								name: sql`excluded.name`,
								properties: sql`excluded.properties`,
								populatedAt: sql`excluded.populated_at`,
							},
						})
						.returning({ id: schema.entityTranslation.id }),
				);
				if (!row) {
					return yield* new DbError({ message: "Translation overlay upsert returned no row" });
				}
				return undefined;
			});

			const listByEntity = Effect.fn("TranslationsRepository.listByEntity")(function* (
				entityId: EntityId,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({
							name: schema.entityTranslation.name,
							language: schema.entityTranslation.language,
							properties: schema.entityTranslation.properties,
							populatedAt: schema.entityTranslation.populatedAt,
						})
						.from(schema.entityTranslation)
						.where(eq(schema.entityTranslation.entityId, entityId)),
				);
				return yield* Effect.forEach(rows, (row) =>
					row.populatedAt
						? Effect.succeed({ ...row, populatedAt: row.populatedAt.toISOString() })
						: Effect.fail(new DbError({ message: "Translation overlay has no populated date" })),
				);
			});

			const findUserLanguage = Effect.fn("TranslationsRepository.findUserLanguage")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ preferences: user.preferences })
						.from(user)
						.where(eq(user.id, userId))
						.limit(1),
				);

				return row ? extractLanguage(row.preferences) : null;
			});

			return { listByEntity, upsertOverlay, listForBackup, findUserLanguage, restoreTranslation };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
