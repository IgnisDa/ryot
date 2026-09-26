import { expect, it } from "@effect/vitest";
import {
	type CachedUserPreferences,
	type CurrentUserValue,
	defaultUserPreferences,
} from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
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

it.effect("persists only the supplied preference changes through better-auth", () => {
	const calls: unknown[] = [];
	const layer = makeServiceLayer({
		updateUserPreferences: (userId, preferences) =>
			Effect.sync(() => {
				calls.push({ userId, preferences });
			}),
	});

	return Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const user = makeUser({ language: "es", allowNsfw: true, disableIntegrations: false });
		yield* service.updatePreferences(user, { disableIntegrations: true });
		yield* service.updatePreferences(user, { language: null });

		expect(calls).toEqual([
			{
				userId: user.id,
				preferences: { language: "es", allowNsfw: true, disableIntegrations: true },
			},
			{
				userId: user.id,
				preferences: { language: null, allowNsfw: true, disableIntegrations: false },
			},
		]);
	}).pipe(Effect.provide(layer));
});

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
				preferences: { language: null, allowNsfw: true, disableIntegrations: false },
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("generates and persists a fresh avatar", () => {
	const calls: Array<{ userId: UserId; image: string }> = [];
	const layer = makeServiceLayer({
		updateUserImage: (userId, image) =>
			Effect.sync(() => {
				calls.push({ image, userId });
			}),
	});

	return Effect.gen(function* () {
		const service = yield* UserSettingsService;
		const user = makeUser(defaultUserPreferences);
		yield* service.refreshAvatar(user);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.userId).toBe(user.id);
		expect(calls[0]?.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
	}).pipe(Effect.provide(layer));
});
