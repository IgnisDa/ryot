import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { requestDemoSignIn } from "#/modules/auth/hosted-service";

describe("hosted auth service demo sign-in", () => {
	it.live.each(["demo", "standard"] as const)("accepts the %s mode", (mode) =>
		Effect.gen(function* () {
			const requests: Array<{ init?: RequestInit; url: string }> = [];
			const request = requestDemoSignIn((input, init) => {
				let url: string;
				if (typeof input === "string") {
					url = input;
				} else if (input instanceof URL) {
					url = input.href;
				} else {
					url = input.url;
				}
				requests.push({ url, init });
				return Promise.resolve(Response.json({ mode }));
			}, "https://ryot.example");

			expect(yield* request).toEqual({ mode });
			expect(requests).toHaveLength(1);
			expect(requests[0]?.url).toBe("https://ryot.example/api/auth/demo/sign-in");
			expect(requests[0]?.init).toMatchObject({
				body: "{}",
				method: "POST",
				cache: "no-store",
				credentials: "same-origin",
			});
		}),
	);

	it.live.each([{ mode: "unknown" }, { extra: true, mode: "demo" }, null])(
		"rejects an invalid response: %j",
		(payload) =>
			Effect.gen(function* () {
				const request = requestDemoSignIn(
					() => Promise.resolve(Response.json(payload)),
					"https://ryot.example",
				);

				expect(yield* Effect.flip(request)).toMatchObject({ _tag: "HostedAuthError" });
			}),
	);

	it.live("rejects an unavailable response without exposing its payload", () =>
		Effect.gen(function* () {
			const request = requestDemoSignIn(
				() => Promise.resolve(Response.json({ email: "demo@ryot.example" }, { status: 403 })),
				"https://ryot.example",
			);

			expect(yield* Effect.flip(request)).toMatchObject({
				_tag: "HostedAuthError",
				message: "Could not open the shared demo.",
			});
		}),
	);
});
