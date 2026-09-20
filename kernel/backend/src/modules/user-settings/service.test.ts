import { expect, layer } from "@effect/vitest";
import {
	type CachedUserPreferences,
	type CurrentUserValue,
	defaultUserPreferences,
} from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { AuthService } from "#modules/auth/service";

import { UserSettingsService } from "./service";

const makeUser = (preferences: CachedUserPreferences): CurrentUserValue => ({
	image: null,
	preferences,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
});

class FakeAuthSettings extends Context.Service<
	FakeAuthSettings,
	{
		readonly preferenceUpdates: Effect.Effect<
			ReadonlyArray<{ userId: UserId; preferences: CachedUserPreferences }>
		>;
		readonly imageUpdates: Effect.Effect<ReadonlyArray<{ userId: UserId; image: string }>>;
	}
>()("test/FakeAuthSettings") {}

const serviceLayer = () =>
	UserSettingsService.layer.pipe(
		Layer.provideMerge(
			Layer.effectContext(
				Effect.gen(function* () {
					const preferenceUpdates = yield* Ref.make<
						ReadonlyArray<{ userId: UserId; preferences: CachedUserPreferences }>
					>([]);
					const imageUpdates = yield* Ref.make<ReadonlyArray<{ userId: UserId; image: string }>>(
						[],
					);
					return Context.make(
						AuthService,
						Object.assign(Object.create(null), {
							updateUserImage: (userId: UserId, image: string) =>
								Ref.update(imageUpdates, (all) => [...all, { image, userId }]),
							updateUserPreferences: (userId: UserId, preferences: CachedUserPreferences) =>
								Ref.update(preferenceUpdates, (all) => [...all, { userId, preferences }]),
						}),
					).pipe(
						Context.add(FakeAuthSettings, {
							imageUpdates: Ref.get(imageUpdates),
							preferenceUpdates: Ref.get(preferenceUpdates),
						}),
					);
				}),
			),
		),
	);

layer(serviceLayer())((test) => {
	test.effect("persists only the supplied preference changes through better-auth", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser({ language: "es", allowNsfw: true, disableIntegrations: false });
			yield* service.updatePreferences(user, { disableIntegrations: true });
			yield* service.updatePreferences(user, { language: null });

			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{
					userId: user.id,
					preferences: { language: "es", allowNsfw: true, disableIntegrations: true },
				},
				{
					userId: user.id,
					preferences: { language: null, allowNsfw: true, disableIntegrations: false },
				},
			]);
		}),
	);
});

layer(serviceLayer())((test) => {
	test.effect("persists merged preferences through better-auth", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser(defaultUserPreferences);
			yield* service.updatePreferences(user, { allowNsfw: true });

			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{
					userId: user.id,
					preferences: { language: null, allowNsfw: true, disableIntegrations: false },
				},
			]);
		}),
	);
});

layer(serviceLayer())((test) => {
	test.effect("generates and persists a fresh avatar", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser(defaultUserPreferences);
			yield* service.refreshAvatar(user);

			const calls = yield* (yield* FakeAuthSettings).imageUpdates;
			expect(calls).toHaveLength(1);
			expect(calls[0]?.userId).toBe(user.id);
			expect(calls[0]?.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
		}),
	);
});
