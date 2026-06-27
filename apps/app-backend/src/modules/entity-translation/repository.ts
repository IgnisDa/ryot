import { conflict } from "@ryot/contract/errors";
import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export type TranslationOverlayInput = {
	language: string;
	populatedAt: Date;
	entityId: EntityId;
	name: string | null;
	properties: Record<string, unknown> | null;
};

const extractLanguage = (preferences: Record<string, unknown>): string | null => {
	const language = preferences["language"];
	return typeof language === "string" && language.length > 0 ? language : null;
};

export class TranslationsRepository extends Effect.Service<TranslationsRepository>()(
	"TranslationsRepository",
	{
		sync: () => {
			const findOverlay = Effect.fn("TranslationsRepository.findOverlay")(function* (input: {
				language: string;
				entityId: EntityId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							name: schema.entityTranslation.name,
							properties: schema.entityTranslation.properties,
						})
						.from(schema.entityTranslation)
						.where(
							and(
								eq(schema.entityTranslation.entityId, input.entityId),
								eq(schema.entityTranslation.language, input.language),
							),
						)
						.limit(1),
				);

				return row ?? null;
			});

			const createOverlay = Effect.fn("TranslationsRepository.createOverlay")(function* (
				input: TranslationOverlayInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.entityTranslation)
						.values({
							name: input.name,
							entityId: input.entityId,
							language: input.language,
							properties: input.properties,
							populatedAt: input.populatedAt,
						})
						.onConflictDoNothing({
							target: [schema.entityTranslation.entityId, schema.entityTranslation.language],
						})
						.returning({ id: schema.entityTranslation.id }),
				);

				if (!row) {
					return yield* conflict("Translation overlay already exists");
				}
				return undefined;
			});

			const updateOverlay = Effect.fn("TranslationsRepository.updateOverlay")(function* (
				input: TranslationOverlayInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.entityTranslation)
						.set({
							name: input.name,
							properties: input.properties,
							populatedAt: input.populatedAt,
						})
						.where(
							and(
								eq(schema.entityTranslation.entityId, input.entityId),
								eq(schema.entityTranslation.language, input.language),
							),
						)
						.returning({ id: schema.entityTranslation.id }),
				);

				return row?.id ?? null;
			});

			const findUserLanguage = Effect.fn("TranslationsRepository.findUserLanguage")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ preferences: user.preferences })
						.from(user)
						.where(eq(user.id, userId))
						.limit(1),
				);

				return row ? extractLanguage(row.preferences) : null;
			});

			return { findOverlay, createOverlay, updateOverlay, findUserLanguage };
		},
	},
) {}
