import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { user } from "#lib/db/schema/tables/auth";
import { isObjectRecord } from "#lib/predicates";
import type { EntityId, UserId } from "#lib/schema/brands";

import type { LanguagePreference } from "./language-resolution";

type UpsertOverlayInput = {
	language: string;
	populatedAt: Date;
	entityId: EntityId;
	name: string | null;
	properties: Record<string, unknown> | null;
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

			const upsertOverlay = Effect.fn("TranslationsRepository.upsertOverlay")(function* (
				input: UpsertOverlayInput,
			) {
				const db = yield* CurrentDb;
				yield* dbEffect(() =>
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
								name: input.name,
								properties: input.properties,
								populatedAt: input.populatedAt,
							},
						}),
				);
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
