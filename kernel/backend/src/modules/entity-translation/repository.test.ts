import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";

const input = {
	language: "en",
	name: "Archived",
	properties: null,
	populatedAt: null,
	id: "translation-id",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	entityId: EntityId.make("entity-id"),
};

it.effect("inserts restored translations without suppressing conflicts", () => {
	let conflictSuppressionRequested = false;
	const db = {
		insert: () => ({
			values: () => ({
				returning: () => Effect.succeed([{ id: input.id }]),
				onConflictDoNothing: () => {
					conflictSuppressionRequested = true;
					return { returning: () => Effect.succeed([]) };
				},
			}),
		}),
	};
	return Effect.gen(function* () {
		const persistence = yield* BackupRestorePersistence;
		expect(yield* persistence.restoreTranslation(input)).toBe(input.id);
		expect(conflictSuppressionRequested).toBe(false);
	}).pipe(Effect.provide(restorePersistenceWithDatabase(db)));
});

it.effect("fails when a restored translation insert returns no row", () => {
	const db = { insert: () => ({ values: () => ({ returning: () => Effect.succeed([]) }) }) };
	return Effect.gen(function* () {
		const persistence = yield* BackupRestorePersistence;
		const error = yield* persistence.restoreTranslation(input).pipe(Effect.flip);
		expect(error).toBeInstanceOf(DbError);
	}).pipe(Effect.provide(restorePersistenceWithDatabase(db)));
});
