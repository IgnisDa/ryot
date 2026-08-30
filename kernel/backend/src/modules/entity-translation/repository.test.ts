import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { TranslationsRepository } from "./repository";

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
				onConflictDoNothing: () => {
					conflictSuppressionRequested = true;
					return { returning: () => Effect.succeed([]) };
				},
				returning: () => Effect.succeed([{ id: input.id }]),
			}),
		}),
	};
	return Effect.gen(function* () {
		const repository = yield* TranslationsRepository;
		expect(yield* repository.restoreTranslation(input)).toBe(input.id);
		expect(conflictSuppressionRequested).toBe(false);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				TranslationsRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});

it.effect("fails when a restored translation insert returns no row", () => {
	const db = { insert: () => ({ values: () => ({ returning: () => Effect.succeed([]) }) }) };
	return Effect.gen(function* () {
		const repository = yield* TranslationsRepository;
		const error = yield* repository.restoreTranslation(input).pipe(Effect.flip);
		expect(error).toBeInstanceOf(DbError);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				TranslationsRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});
