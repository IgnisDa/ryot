import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { decodeServerOrigin, ServerOrigin } from "#/api/origin";
import { apiScopeKey } from "#/api/scope";

describe("API scope", () => {
	it.effect("uses canonical origins to partition users and servers", () =>
		Effect.gen(function* () {
			const firstOrigin = ServerOrigin.make("https://one.test");
			const first = apiScopeKey({ userId: "user-1", serverUrl: firstOrigin });

			expect(first).toBe(
				apiScopeKey({
					userId: "user-1",
					serverUrl: yield* decodeServerOrigin("https://one.test/"),
				}),
			);
			expect(first).not.toBe(apiScopeKey({ userId: "user-2", serverUrl: firstOrigin }));
			expect(first).not.toBe(
				apiScopeKey({ userId: "user-1", serverUrl: ServerOrigin.make("https://two.test") }),
			);
		}),
	);

	it("excludes unrelated fields from the key", () => {
		const input = {
			userId: "user-1",
			cookie: "session=secret",
			accessToken: "secret-token",
			serverUrl: ServerOrigin.make("https://one.test"),
		};

		expect(apiScopeKey(input)).toBe('["https://one.test","user-1"]');
		expect(apiScopeKey(input)).not.toContain("secret");
	});
});
