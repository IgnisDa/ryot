import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import { user } from "#lib/db/schema/auth";
import * as schema from "#lib/db/schema/tables";
import { DbError } from "#lib/errors";
import { isObjectRecord } from "#lib/predicates";
import type { EntityId, UserId } from "#lib/schema/brands";
import type { StoredEntityImage } from "#modules/entities/types";

import type { LanguagePreference } from "./language-resolution";

export type TranslationOverlayRow = {
	name: string | null;
	populatedAt: Date | null;
	description: string | null;
	image: StoredEntityImage | null;
};

export type UpsertOverlayInput = {
	language: string;
	populatedAt: Date;
	entityId: EntityId;
	name: string | null;
	description: string | null;
	image: StoredEntityImage | null;
};

const extractLanguagePreferences = (preferences: Record<string, unknown>): LanguagePreference[] => {
	const languages = preferences.languages;
	const providers = isObjectRecord(languages) ? languages.providers : undefined;
	if (!Array.isArray(providers)) {
		return [];
	}

	return providers.flatMap((provider) => {
		if (!isObjectRecord(provider)) {
			return [];
		}
		const { source, preferredLanguage } = provider;
		if (typeof source !== "string" || typeof preferredLanguage !== "string") {
			return [];
		}

		return [{ source, preferredLanguage }];
	});
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
							image: schema.entityTranslation.image,
							description: schema.entityTranslation.description,
							populatedAt: schema.entityTranslation.populatedAt,
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

			const upsertOverlay = Effect.fn("TranslationsRepository.upsertOverlay")(function* (
				input: UpsertOverlayInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.entityTranslation)
						.values({
							name: input.name,
							image: input.image,
							entityId: input.entityId,
							language: input.language,
							populatedAt: input.populatedAt,
							description: input.description,
						})
						.onConflictDoUpdate({
							target: [schema.entityTranslation.entityId, schema.entityTranslation.language],
							set: {
								name: input.name,
								image: input.image,
								populatedAt: input.populatedAt,
								description: input.description,
							},
						})
						.returning({ id: schema.entityTranslation.id }),
				);

				if (!row) {
					return yield* new DbError({ message: "Translation overlay upsert returned no row" });
				}

				return { id: row.id };
			});

			const findUserLanguagePreferences = Effect.fn(
				"TranslationsRepository.findUserLanguagePreferences",
			)(function* (userId: UserId) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ preferences: user.preferences })
						.from(user)
						.where(eq(user.id, userId))
						.limit(1),
				);

				return row ? extractLanguagePreferences(row.preferences) : [];
			});

			return { findOverlay, upsertOverlay, findUserLanguagePreferences };
		},
	},
) {}
