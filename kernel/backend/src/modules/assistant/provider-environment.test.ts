import { expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Option, Redacted } from "effect";

import { AppConfig } from "#platform/config/service";
import { makeRequiredConfigLayer } from "#testing/effect";

layer(
	makeRequiredConfigLayer({
		SERVER_ASSISTANT_MODEL: "local",
		SERVER_ASSISTANT_BASE_URL: "http://localhost:11434/v1",
	}),
)((test) => {
	test.effect("loads an unauthenticated instance provider", () =>
		Effect.gen(function* () {
			const {
				server: { assistant },
			} = yield* AppConfig.make;
			expect(assistant.baseUrl).toEqual(Option.some("http://localhost:11434/v1"));
			expect(assistant.model).toEqual(Option.some("local"));
			expect(assistant.apiKey).toEqual(Option.none());
		}),
	);
});
layer(
	makeRequiredConfigLayer({
		SERVER_ASSISTANT_MODEL: "remote",
		SERVER_ASSISTANT_API_KEY: "instance-secret",
		SERVER_ASSISTANT_BASE_URL: "https://provider.example/v1",
	}),
)((test) => {
	test.effect("keeps the configured instance key redacted", () =>
		Effect.gen(function* () {
			const config = yield* AppConfig.make;
			assert(Option.isSome(config.server.assistant.apiKey));
			expect(Redacted.value(config.server.assistant.apiKey.value)).toBe("instance-secret");
		}),
	);
});
for (const environment of [
	{ SERVER_ASSISTANT_BASE_URL: "https://provider.example/v1" },
	{ SERVER_ASSISTANT_MODEL: "remote" },
	{ SERVER_ASSISTANT_API_KEY: "orphan-secret" },
	{
		SERVER_ASSISTANT_MODEL: "remote",
		SERVER_ASSISTANT_BASE_URL: "https://user:secret@provider.example/v1",
	},
	{
		SERVER_ASSISTANT_MODEL: "remote",
		SERVER_ASSISTANT_BASE_URL: "https://provider.example/v1?key=secret",
	},
]) {
	layer(makeRequiredConfigLayer(environment))((test) => {
		test.effect("rejects incomplete or credential-bearing instance provider configuration", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(AppConfig.make);
				expect(error.message).toContain("SERVER_ASSISTANT_");
				expect(error.message).not.toContain("secret");
			}),
		);
	});
}
