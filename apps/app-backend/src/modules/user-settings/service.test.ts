import { expect, it } from "@effect/vitest";
import {
	type CachedUserPreferences,
	type CurrentUserValue,
	defaultUserPreferences,
} from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthService } from "#modules/auth/service";

import { UserSettingsService } from "./service";

const makeUser = (preferences: CachedUserPreferences): CurrentUserValue => ({
	image: null,
	preferences,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
});

type AuthSettingsOperations = {
	updateUserImage: (userId: UserId, image: string) => Effect.Effect<void>;
	updateUserPreferences: (
		userId: UserId,
		preferences: CachedUserPreferences,
	) => Effect.Effect<void>;
};

const makeServiceLayer = (operations: Partial<AuthSettingsOperations> = {}) =>
	UserSettingsService.layer.pipe(
		Layer.provide(
			Layer.succeed(
				AuthService,
				Object.assign(Object.create(null), {
					updateUserImage: () => Effect.void,
					updateUserPreferences: () => Effect.void,
					...operations,
				}),
			),
		),
	);

it.effect("returns the caller's current preferences when the body is empty", () =>
	Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const result = yield* service.updatePreferences(makeUser(defaultUserPreferences), {});

		expect(result).toEqual({ allowNsfw: false, language: null, disableIntegrations: false });
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("only overwrites the fields provided in the body", () =>
	Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const result = yield* service.updatePreferences(
			makeUser({ allowNsfw: true, language: "es", disableIntegrations: false }),
			{ disableIntegrations: true },
		);

		expect(result).toEqual({ allowNsfw: true, language: "es", disableIntegrations: true });
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("allows explicitly clearing the language preference", () =>
	Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const result = yield* service.updatePreferences(
			makeUser({ allowNsfw: false, language: "es", disableIntegrations: false }),
			{ language: null },
		);

		expect(result).toEqual({ allowNsfw: false, language: null, disableIntegrations: false });
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("persists merged preferences through better-auth", () => {
	const calls: unknown[] = [];
	const layer = makeServiceLayer({
		updateUserPreferences: (userId, preferences) =>
			Effect.sync(() => {
				calls.push({ userId, preferences });
			}),
	});

	return Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const user = makeUser(defaultUserPreferences);
		yield* service.updatePreferences(user, { allowNsfw: true });

		expect(calls).toEqual([
			{
				userId: user.id,
				preferences: { allowNsfw: true, language: null, disableIntegrations: false },
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("generates and persists a fresh avatar", () => {
	const calls: unknown[] = [];
	const layer = makeServiceLayer({
		updateUserImage: (userId, image) =>
			Effect.sync(() => {
				calls.push({ userId, image });
			}),
	});

	return Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const user = makeUser(defaultUserPreferences);
		const result = yield* service.refreshAvatar(user);

		expect(result.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
		expect(calls).toEqual([{ userId: user.id, image: result.image }]);
	}).pipe(Effect.provide(layer));
});
