import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { TranslationsRepository } from "./repository";

const input = {
	language: "en",
	name: "Archived",
	properties: null,
	populatedAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	sourceContentGeneration: 1,
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

layer(TranslationsRepository.layer.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
	test.effect("backs up only overlays from the current canonical generation", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const currentId = EntityId.make("translation-backup-current");
			const staleId = EntityId.make("translation-backup-stale");
			yield* session.run((db) =>
				db.insert(tables.entity).values([
					{ id: currentId, name: "Current", contentGeneration: 2, entitySchemaSlug: "record" },
					{ id: staleId, name: "Changed", contentGeneration: 2, entitySchemaSlug: "record" },
				]),
			);
			yield* session.run((db) =>
				db.insert(tables.entityTranslation).values([
					{ language: "es", name: "Actual", entityId: currentId, sourceContentGeneration: 2 },
					{ language: "es", name: "Anterior", entityId: staleId, sourceContentGeneration: 1 },
				]),
			);
			const rows = yield* (yield* TranslationsRepository).listForBackup([currentId, staleId]);
			expect(rows).toMatchObject([
				{ language: "es", name: "Actual", entityId: currentId, sourceContentGeneration: 2 },
			]);
			expect(rows).toHaveLength(1);
		}),
	);
});
