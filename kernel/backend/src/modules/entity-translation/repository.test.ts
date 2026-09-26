import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";

const input = {
	language: "en",
	name: "Archived",
	properties: null,
	populatedAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	entityId: EntityId.make("entity-id"),
};

class TranslationInserts extends Context.Service<
	TranslationInserts,
	{ readonly conflictSuppressionRequested: Effect.Effect<boolean> }
>()("test/TranslationInserts") {}

const translationInsertLayer = (rows: ReadonlyArray<{ language: string }>) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const suppressed = yield* Ref.make(false);
			const db = {
				insert: () => ({
					values: () => ({
						returning: () => Effect.succeed(rows),
						onConflictDoNothing: () => ({
							returning: () => Ref.set(suppressed, true).pipe(Effect.as([])),
						}),
					}),
				}),
			};
			return Layer.merge(
				restorePersistenceWithDatabase(db),
				Layer.succeed(TranslationInserts, { conflictSuppressionRequested: Ref.get(suppressed) }),
			);
		}),
	);

layer(translationInsertLayer([{ language: input.language }]))((test) => {
	test.effect("inserts restored translations without suppressing conflicts", () =>
		Effect.gen(function* () {
			const persistence = yield* BackupRestorePersistence;
			expect(yield* persistence.restoreTranslation(input)).toBe(input.language);
			expect(yield* (yield* TranslationInserts).conflictSuppressionRequested).toBe(false);
		}),
	);
});

layer(translationInsertLayer([]))((test) => {
	test.effect("fails when a restored translation insert returns no row", () =>
		Effect.gen(function* () {
			const persistence = yield* BackupRestorePersistence;
			const error = yield* persistence.restoreTranslation(input).pipe(Effect.flip);
			expect(error).toBeInstanceOf(DbError);
		}),
	);
});
