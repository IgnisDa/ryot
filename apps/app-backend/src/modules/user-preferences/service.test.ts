import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { UserId } from "#lib/schema/brands";
import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer } from "#lib/test-support/effect";

import { UserPreferencesRepository } from "./repository";
import { UserPreferencesService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
} satisfies CurrentUserValue;

const mockUserPreferencesRepository = Layer.mock(UserPreferencesRepository);

const makeUserPreferencesRepository = (
	overrides: MockOverrides<typeof mockUserPreferencesRepository> = {},
) => mockUserPreferencesRepository({ ...overrides, _tag: "UserPreferencesRepository" });

const makeServiceLayer = (
	options: { repository?: ReturnType<typeof makeUserPreferencesRepository> } = {},
) =>
	UserPreferencesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, options.repository ?? makeUserPreferencesRepository()),
		),
	);

it.effect("fills in defaults when the user has no stored preferences", () => {
	const layer = makeServiceLayer({
		repository: makeUserPreferencesRepository({
			findByUserId: () => Effect.succeed(null),
			updateForUser: () => Effect.void,
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const result = yield* service.update(user, {});

		expect(result).toEqual({ isNsfw: false, language: null, disableIntegrations: false });
	}).pipe(Effect.provide(layer));
});

it.effect("only overwrites the fields provided in the body", () => {
	const layer = makeServiceLayer({
		repository: makeUserPreferencesRepository({
			findByUserId: () =>
				Effect.succeed({ isNsfw: true, language: "es", disableIntegrations: false }),
			updateForUser: () => Effect.void,
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const result = yield* service.update(user, { disableIntegrations: true });

		expect(result).toEqual({ isNsfw: true, language: "es", disableIntegrations: true });
	}).pipe(Effect.provide(layer));
});

it.effect("allows explicitly clearing the language preference", () => {
	const layer = makeServiceLayer({
		repository: makeUserPreferencesRepository({
			findByUserId: () =>
				Effect.succeed({ isNsfw: false, language: "es", disableIntegrations: false }),
			updateForUser: () => Effect.void,
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		const result = yield* service.update(user, { language: null });

		expect(result).toEqual({ isNsfw: false, language: null, disableIntegrations: false });
	}).pipe(Effect.provide(layer));
});

it.effect("persists the merged preferences", () => {
	const calls: unknown[] = [];
	const layer = makeServiceLayer({
		repository: makeUserPreferencesRepository({
			findByUserId: () => Effect.succeed(null),
			updateForUser: (input) =>
				Effect.sync(() => {
					calls.push(input);
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserPreferencesService;
		yield* service.update(user, { isNsfw: true });

		expect(calls).toEqual([
			{
				userId: user.id,
				preferences: { isNsfw: true, language: null, disableIntegrations: false },
			},
		]);
	}).pipe(Effect.provide(layer));
});
