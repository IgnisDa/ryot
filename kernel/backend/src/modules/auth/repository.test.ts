import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { eq, sql } from "drizzle-orm";
import { Deferred, Effect, Layer } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";

import { AuthRepository } from "./repository";

const testLayer = AuthRepository.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("auth_prefs_test")),
);

layer(testLayer)((test) => {
	test.effect("preference consumers preserve missing users and reject malformed storage", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* AuthRepository;
			const translations = yield* TranslationsRepository.make;
			const integrations = yield* IntegrationsRepository.make;
			const id = UserId.make("read-user");
			const missing = UserId.make("missing-read-user");
			expect(yield* repository.getUserPreferences(missing)).toBeNull();
			expect(yield* translations.findUserLanguage(missing)).toBeNull();
			expect(yield* integrations.getUserDisableIntegrations({ userId: missing })).toBe(false);
			yield* session.run((db) =>
				db.insert(user).values({ id, name: "Reader", email: "read@example.test" }),
			);
			yield* repository.patchUserPreferences(id, { language: "fr", disableIntegrations: true });
			expect(yield* repository.getUserPreferences(id)).toEqual({
				...defaultUserPreferences,
				language: "fr",
				disableIntegrations: true,
			});
			expect(yield* translations.findUserLanguage(id)).toBe("fr");
			expect(yield* integrations.getUserDisableIntegrations({ userId: id })).toBe(true);
			const exit = yield* Effect.exit(
				session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db.execute(sql`alter table "user" drop constraint user_preferences_check`),
						);
						yield* session.run((db) =>
							db.execute(
								sql`update "user" set preferences = '{"allowNsfw":"yes"}'::jsonb where id = ${id}`,
							),
						);
						expect(
							(yield* Effect.flip(repository.getUserPreferences(id)).pipe(Effect.orDie)).message,
						).toContain("Invalid stored user preferences");
						expect(
							(yield* Effect.flip(translations.findUserLanguage(id)).pipe(Effect.orDie)).message,
						).toContain("Invalid stored user preferences");
						expect(
							(yield* Effect.flip(integrations.getUserDisableIntegrations({ userId: id })).pipe(
								Effect.orDie,
							)).message,
						).toContain("Invalid stored user preferences");
						return yield* new DbError({ message: "roll back malformed preferences" });
					}),
				),
			);
			assertExitFails(exit, new DbError({ message: "roll back malformed preferences" }));
		}),
	);

	test.effect("preference consumers capture a replacement auth repository at construction", () =>
		Effect.gen(function* () {
			const repository = yield* AuthRepository;
			const replacement = AuthRepository.of({
				...repository,
				getUserPreferences: () =>
					Effect.succeed({ ...defaultUserPreferences, language: "de", disableIntegrations: true }),
			});
			const translations = yield* TranslationsRepository.make.pipe(
				Effect.provideService(AuthRepository, replacement),
			);
			const integrations = yield* IntegrationsRepository.make.pipe(
				Effect.provideService(AuthRepository, replacement),
			);
			const id = UserId.make("not-in-database");
			expect(yield* translations.findUserLanguage(id)).toBe("de");
			expect(yield* integrations.getUserDisableIntegrations({ userId: id })).toBe(true);
		}),
	);
	test.effect("merges concurrent independent patches without lost updates", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* AuthRepository;
			const id = UserId.make("concurrent-user");
			yield* session.run((db) =>
				db.insert(user).values({ id, name: "User", email: "concurrent@example.test" }),
			);
			const ready = yield* Deferred.make<void>();
			const secondStarted = yield* Deferred.make<void>();
			const first = session.transaction(
				Effect.gen(function* () {
					yield* repository.patchUserPreferences(id, { allowNsfw: true });
					yield* Deferred.succeed(ready, undefined);
					yield* Deferred.await(secondStarted);
				}),
			);
			const second = Effect.gen(function* () {
				yield* Deferred.await(ready);
				yield* Deferred.succeed(secondStarted, undefined);
				yield* repository.patchUserPreferences(id, { disableIntegrations: true });
			});
			yield* Effect.all([first, second], { concurrency: 2 });
			const [stored] = yield* session.run((db) =>
				db.select({ preferences: user.preferences }).from(user).where(eq(user.id, id)),
			);
			expect(stored?.preferences).toEqual({
				...defaultUserPreferences,
				allowNsfw: true,
				disableIntegrations: true,
			});
		}),
	);

	test.effect("no-op does not touch the row; invalid persisted JSON fails decode", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* AuthRepository;
			const id = UserId.make("no-op-user");
			yield* session.run((db) =>
				db.insert(user).values({ id, name: "User", email: "noop@example.test" }),
			);
			const [before] = yield* session.run((db) =>
				db
					.select({ updatedAt: user.updatedAt, preferences: user.preferences })
					.from(user)
					.where(eq(user.id, id)),
			);
			expect(yield* repository.patchUserPreferences(id, {})).toEqual(defaultUserPreferences);
			const [after] = yield* session.run((db) =>
				db.select({ updatedAt: user.updatedAt }).from(user).where(eq(user.id, id)),
			);
			expect(after?.updatedAt).toEqual(before?.updatedAt);
			expect(
				(yield* Effect.flip(
					repository.patchUserPreferences(UserId.make("missing"), { allowNsfw: true }),
				)).message,
			).toContain("User not found");
			const invalid = yield* Effect.flip(
				session.run((db) =>
					db.execute(
						sql`update "user" set preferences = '{"allowNsfw":"yes"}'::jsonb where id = ${id}`,
					),
				),
			);
			expect(invalid.code).toBe("23514");
			const malformed = yield* Effect.exit(
				session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db.execute(sql`alter table "user" drop constraint user_preferences_check`),
						);
						yield* session.run((db) =>
							db.execute(
								sql`update "user" set preferences = '{"allowNsfw":"yes"}'::jsonb where id = ${id}`,
							),
						);
						expect((yield* Effect.flip(repository.patchUserPreferences(id, {}))).message).toContain(
							"Invalid stored user preferences",
						);
						return yield* new DbError({ message: "roll back malformed test row" });
					}),
				),
			);
			expect(malformed._tag).toBe("Failure");
		}),
	);

	test.effect("same-field patches have a valid last writer without changing unrelated fields", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* AuthRepository;
			const id = UserId.make("same-field-user");
			yield* session.run((db) =>
				db.insert(user).values({ id, name: "User", email: "same@example.test" }),
			);
			yield* repository.patchUserPreferences(id, { language: "en" });
			const locked = yield* Deferred.make<void>();
			const secondStarted = yield* Deferred.make<void>();
			yield* Effect.all(
				[
					session.transaction(
						Effect.gen(function* () {
							yield* repository.patchUserPreferences(id, { allowNsfw: true });
							yield* Deferred.succeed(locked, undefined);
							yield* Deferred.await(secondStarted);
						}),
					),
					Effect.gen(function* () {
						yield* Deferred.await(locked);
						yield* Deferred.succeed(secondStarted, undefined);
						yield* repository.patchUserPreferences(id, { allowNsfw: false });
					}),
				],
				{ concurrency: 2 },
			);
			const [stored] = yield* session.run((db) =>
				db.select({ preferences: user.preferences }).from(user).where(eq(user.id, id)),
			);
			expect(stored?.preferences).toEqual({ ...defaultUserPreferences, language: "en" });
		}),
	);
});
