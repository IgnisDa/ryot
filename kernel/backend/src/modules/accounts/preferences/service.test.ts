import { BunCrypto } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	defaultUserPreferences,
	type UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { partialFake } from "@ryot-app/testing/fakes";
import { Context, Effect, Layer, Ref } from "effect";

import { AuthService } from "#modules/accounts/auth/service";

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
		readonly imageUpdates: Effect.Effect<ReadonlyArray<{ image: string; userId: UserId }>>;
		readonly preferenceUpdates: Effect.Effect<
			ReadonlyArray<{ userId: UserId; preferences: UserPreferencesPatch }>
		>;
	}
>()("@ryot-app/kernel-backend/modules/accounts/preferences/service.test/FakeAuthSettings") {}

const serviceLayer = () =>
	Layer.provideMerge(
		UserSettingsService.layer.pipe(
			Layer.provideMerge(
				Layer.effectContext(
					Effect.gen(function* () {
						const preferenceUpdates = yield* Ref.make<
							ReadonlyArray<{ userId: UserId; preferences: UserPreferencesPatch }>
						>([]);
						const imageUpdates = yield* Ref.make<ReadonlyArray<{ image: string; userId: UserId }>>(
							[],
						);
						return Context.make(
							AuthService,
							partialFake<AuthService["Service"]>({
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
		),
		BunCrypto.layerSecureRandom,
	);

layer(serviceLayer())((test) => {
	test.effect("writes an explicit reporting time zone as an ordinary patch", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser(defaultUserPreferences);
			yield* service.updatePreferences(user, {
				reportingTimeZone: TimeZone.make("Pacific/Auckland"),
			});
			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{ userId: user.id, preferences: { reportingTimeZone: TimeZone.make("Pacific/Auckland") } },
			]);
		}),
	);
});

layer(serviceLayer())((test) => {
	test.effect("sends only changed fields even when CurrentUser is stale", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser({
				language: "es",
				disableIntegrations: false,
				reportingTimeZone: TimeZone.make("America/New_York"),
			});
			yield* service.updatePreferences(user, { disableIntegrations: true });
			yield* service.updatePreferences(user, { language: null, disableIntegrations: false });
			yield* service.updatePreferences(user, { language: "  fr  " });
			yield* service.updatePreferences(user, { language: " \t " });
			yield* service.updatePreferences(user, {});

			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{ userId: user.id, preferences: { disableIntegrations: true } },
				{ userId: user.id, preferences: { language: null, disableIntegrations: false } },
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
			yield* service.updatePreferences(user, { language: "es" });

			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([
				{ userId: user.id, preferences: { language: "es" } },
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
