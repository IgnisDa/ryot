import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import {
	defaultUserPreferences,
	type UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { Context, Effect, Layer, Ref } from "effect";

import { AuthService } from "#modules/auth/service";

import { UserSettingsService } from "./service";

const makeUser = (preferences: UserPreferences): CurrentUserValue => ({
	image: null,
	preferences,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	accountGeneration: { userId: UserId.make("user-id"), token: "test-account-generation" },
});

class FakeAuthSettings extends Context.Service<
	FakeAuthSettings,
	{
		readonly preferenceUpdates: Effect.Effect<
			ReadonlyArray<{ userId: UserId; preferences: UserPreferencesPatch }>
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
						ReadonlyArray<{ userId: UserId; preferences: UserPreferencesPatch }>
					>([]);
					const imageUpdates = yield* Ref.make<ReadonlyArray<{ userId: UserId; image: string }>>(
						[],
					);
					return Context.make(
						AuthService,
						Object.assign(Object.create(null), {
							updateUserImage: (userId: UserId, image: string) =>
								Ref.update(imageUpdates, (all) => [...all, { image, userId }]),
							updateUserPreferences: (userId: UserId, preferences: UserPreferencesPatch) =>
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
	test.effect("sends only changed fields even when CurrentUser is stale", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser({ language: "es", allowNsfw: true, disableIntegrations: false });
			yield* service.updatePreferences(user, { disableIntegrations: true });
			yield* service.updatePreferences(user, { language: null, allowNsfw: false });
			yield* service.updatePreferences(user, { language: "  fr  " });
			yield* service.updatePreferences(user, { language: " \t " });
			yield* service.updatePreferences(user, {});

			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{ userId: user.id, preferences: { disableIntegrations: true } },
				{ userId: user.id, preferences: { language: null, allowNsfw: false } },
				{ userId: user.id, preferences: { language: "fr" } },
				{ userId: user.id, preferences: { language: null } },
			]);
		}),
	);
});

layer(serviceLayer())((test) => {
	test.effect("keeps omitted fields out of the patch", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser(defaultUserPreferences);
			yield* service.updatePreferences(user, { allowNsfw: true });

			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{ userId: user.id, preferences: { allowNsfw: true } },
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
