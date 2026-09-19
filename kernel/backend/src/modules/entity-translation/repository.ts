import { DbError } from "@ryot-app/contract/errors";
import { EntityId, type UserId } from "@ryot-app/contract/schema/brands";
import { UserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

export type TranslationOverlayInput = {
	language: string;
	populatedAt: Date;
	entityId: EntityId;
	name: string | null;
	properties: Record<string, unknown> | null;
};

export class TranslationsRepository extends Context.Service<TranslationsRepository>()(
	"TranslationsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const listForBackup = Effect.fn("TranslationsRepository.listForBackup")(function* (
				entityIds: ReadonlyArray<EntityId>,
			) {
				if (entityIds.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.entityTranslation)
						.where(inArray(schema.entityTranslation.entityId, [...entityIds]))
						.orderBy(
							asc(schema.entityTranslation.entityId),
							asc(schema.entityTranslation.language),
						),
				);
			});

			const upsertOverlay = Effect.fn("TranslationsRepository.upsertOverlay")(function* (
				input: TranslationOverlayInput,
			) {
				const [row] = yield* session.run((db) =>
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
						.returning({
							entityId: schema.entityTranslation.entityId,
							language: schema.entityTranslation.language,
						}),
				);
				if (!row) {
					return yield* new DbError({ message: "Translation overlay upsert returned no row" });
				}
				return { language: row.language, entityId: EntityId.make(row.entityId) };
			});

			const findUserLanguage = Effect.fn("TranslationsRepository.findUserLanguage")(function* (
				userId: UserId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({ preferences: user.preferences })
						.from(user)
						.where(eq(user.id, userId))
						.limit(1),
				);

				return row
					? (yield* Schema.decodeEffect(UserPreferences)(row.preferences).pipe(
							Effect.mapError(
								(error) =>
									new DbError({ message: `Invalid stored user preferences: ${error.message}` }),
							),
						)).language
					: null;
			});

			return { upsertOverlay, listForBackup, findUserLanguage };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
