import { expect, it } from "@effect/vitest";
import { Effect, Either, Option, Redacted } from "effect";
import { describe } from "vitest";

import { getSandboxAppConfigValue } from "./app-config";
import { normalizePreferences, toSandboxCreateEventsResult } from "./host-functions";

const config = {
	port: 8000,
	nodeEnv: "test",
	providers: {
		googleBooksApiKey: Option.none(),
		malClientId: Option.some("mal-client"),
		giantBombApiKey: Option.some(Redacted.make("giant-secret")),
	},
};

const runEither = (key: string, scriptIsBuiltin: boolean) =>
	Effect.either(getSandboxAppConfigValue(config, key, scriptIsBuiltin));

describe("getSandboxAppConfigValue", () => {
	it.effect("reads non-sensitive app config values", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.malClientId", false);

			expect(Either.getOrThrow(result)).toBe("mal-client");
		}),
	);

	it.effect("rejects host environment keys", () =>
		Effect.gen(function* () {
			const result = yield* runEither("PATH", false);

			expect(Either.getLeft(result)).toEqual(Option.some('Config key "PATH" does not exist'));
		}),
	);

	it.effect("rejects sensitive config values for user scripts", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.giantBombApiKey", false);

			expect(Either.getLeft(result)).toEqual(
				Option.some('Config key "providers.giantBombApiKey" is sensitive'),
			);
		}),
	);

	it.effect("allows sensitive config values for builtin scripts", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.giantBombApiKey", true);

			expect(Either.getOrThrow(result)).toBe("giant-secret");
		}),
	);

	it.effect("rejects unconfigured optional values", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.googleBooksApiKey", true);

			expect(Either.getLeft(result)).toEqual(
				Option.some('Config key "providers.googleBooksApiKey" is not configured'),
			);
		}),
	);
});

describe("normalizePreferences", () => {
	it("normalizes missing and non-boolean preference values", () => {
		expect(normalizePreferences(null)).toEqual({
			isNsfw: false,
			disableIntegrations: false,
		});
		expect(normalizePreferences({ isNsfw: 1, disableIntegrations: true })).toEqual({
			isNsfw: false,
			disableIntegrations: true,
		});
	});
});

describe("toSandboxCreateEventsResult", () => {
	it.effect("preserves policy failures at the sandbox host boundary", () =>
		Effect.gen(function* () {
			const result = yield* Effect.either(
				toSandboxCreateEventsResult({
					count: 0,
					outcomes: [],
					failure: { index: 0, reason: { kind: "bad_request", message: "Policy failed" } },
				}),
			);

			expect(Either.getLeft(result)).toEqual(Option.some("Policy failed"));
		}),
	);
});
