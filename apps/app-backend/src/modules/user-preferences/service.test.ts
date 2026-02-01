import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { AuthService } from "#lib/auth";
import type { CurrentUserValue } from "#lib/auth-middleware";
import { defaultUserPreferences, type UserPreferences } from "#lib/builtins/bootstrap";
import { UserId } from "#lib/schema/brands";

import { UserPreferencesService } from "./service";

const makeUser = (preferences: UserPreferences): CurrentUserValue => ({
	preferences,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
});

type UpdateUserPreferences = (userId: UserId, preferences: UserPreferences) => Effect.Effect<void>;

const makeServiceLayer = (updateUserPreferences: UpdateUserPreferences = () => Effect.void) =>
	UserPreferencesService.Default.pipe(
		Layer.provide(
			Layer.succeed(AuthService, Object.assign(Object.create(null), { updateUserPreferences })),
		),
	);

it.effect("returns the caller's current preferences when the body is empty", () =>
	Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const result = yield* service.update(makeUser(defaultUserPreferences), {});

		expect(result).toEqual({ isNsfw: false, language: null, disableIntegrations: false });
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("only overwrites the fields provided in the body", () =>
	Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const result = yield* service.update(
			makeUser({ isNsfw: true, language: "es", disableIntegrations: false }),
			{ disableIntegrations: true },
		);

		expect(result).toEqual({ isNsfw: true, language: "es", disableIntegrations: true });
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("allows explicitly clearing the language preference", () =>
	Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const result = yield* service.update(
			makeUser({ isNsfw: false, language: "es", disableIntegrations: false }),
			{ language: null },
		);

		expect(result).toEqual({ isNsfw: false, language: null, disableIntegrations: false });
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("persists the merged preferences through better-auth", () => {
	const calls: unknown[] = [];
	const layer = makeServiceLayer((userId, preferences) =>
		Effect.sync(() => {
			calls.push({ userId, preferences });
		}),
	);

	return Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const user = makeUser(defaultUserPreferences);
		yield* service.update(user, { isNsfw: true });

		expect(calls).toEqual([
			{
				userId: user.id,
				preferences: { isNsfw: true, language: null, disableIntegrations: false },
			},
		]);
	}).pipe(Effect.provide(layer));
});
