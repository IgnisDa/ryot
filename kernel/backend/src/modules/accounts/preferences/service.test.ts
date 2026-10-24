import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/account/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	defaultUserPreferences,
	type UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { Context, Effect, Layer, Ref, Schema } from "effect";

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
		readonly initializations: Effect.Effect<
			ReadonlyArray<{ userId: UserId; reportingTimeZone: string }>
		>;
		readonly preferenceUpdates: Effect.Effect<
			ReadonlyArray<{ userId: UserId; preferences: UserPreferencesPatch }>
		>;
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
					const imageUpdates = yield* Ref.make<ReadonlyArray<{ image: string; userId: UserId }>>(
						[],
					);
					const initializations = yield* Ref.make<
						ReadonlyArray<{ userId: UserId; reportingTimeZone: string }>
					>([]);
					return Context.make(
						AuthService,
						Object.assign(Object.create(null), {
							updateUserImage: (userId: UserId, image: string) =>
								Ref.update(imageUpdates, (all) => [...all, { image, userId }]),
							updateUserPreferences: (userId: UserId, preferences: UserPreferencesPatch) =>
								Ref.update(preferenceUpdates, (all) => [...all, { userId, preferences }]),
							initializeReportingTimeZone: (userId: UserId, reportingTimeZone: string) =>
								Ref.update(initializations, (all) => [...all, { userId, reportingTimeZone }]),
						}),
					).pipe(
						Context.add(FakeAuthSettings, {
							imageUpdates: Ref.get(imageUpdates),
							initializations: Ref.get(initializations),
							preferenceUpdates: Ref.get(preferenceUpdates),
						}),
					);
				}),
			),
		),
	);

layer(serviceLayer())((test) => {
	test.effect("routes initialization to the conditional writer without a preference patch", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser({
				...defaultUserPreferences,
				reportingTimeZone: TimeZone.make("America/New_York"),
			});
			const body = yield* Schema.decodeEffect(UpdateUserPreferencesBody)({
				initializeReportingTimeZone: "Asia/Kolkata",
			});
			yield* service.updatePreferences(user, body);
			expect(yield* (yield* FakeAuthSettings).initializations).toEqual([
				{ userId: user.id, reportingTimeZone: TimeZone.make("Asia/Kolkata") },
			]);
			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([]);
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
	test.effect("rejects invalid and mixed initialization requests before dispatch", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			for (const body of [
				{ initializeReportingTimeZone: "+05:30" },
				{ initializeReportingTimeZone: "Not/AZone" },
				{ initializeReportingTimeZone: null },
				{ language: "fr", initializeReportingTimeZone: "UTC" },
				{ initializeReportingTimeZone: "UTC", reportingTimeZone: TimeZone.make("Asia/Kolkata") },
			]) {
				const exit = yield* Schema.decodeUnknownEffect(UpdateUserPreferencesBody)(body).pipe(
					Effect.flatMap((decoded) =>
						service.updatePreferences(makeUser(defaultUserPreferences), decoded),
					),
					Effect.exit,
				);
				expect(exit._tag).toBe("Failure");
			}
			expect(yield* (yield* FakeAuthSettings).initializations).toEqual([]);
			expect(yield* (yield* FakeAuthSettings).preferenceUpdates).toEqual([]);
		}),
	);
});

layer(serviceLayer())((test) => {
	test.effect("sends only changed fields even when CurrentUser is stale", () =>
		Effect.gen(function* () {
			const service = yield* UserSettingsService;
			const user = makeUser({
				language: "es",
				reportingTimeZone: null,
				disableIntegrations: false,
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
