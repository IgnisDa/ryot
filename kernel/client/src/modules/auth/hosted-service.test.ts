import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { requestDemoSignIn } from "#/modules/auth/hosted-service";

describe("hosted auth service demo sign-in", () => {
	it.each(["demo", "standard"] as const)("accepts the %s mode", async (mode) => {
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

		await expect(Effect.runPromise(request)).resolves.toEqual({ mode });
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://ryot.example/api/auth/demo/sign-in");
		expect(requests[0]?.init).toMatchObject({
			body: "{}",
			method: "POST",
			cache: "no-store",
			credentials: "same-origin",
		});
	});

	it.each([{ mode: "unknown" }, { extra: true, mode: "demo" }, null])(
		"rejects an invalid response: %j",
		async (payload) => {
			const request = requestDemoSignIn(
				() => Promise.resolve(Response.json(payload)),
				"https://ryot.example",
			);

			await expect(Effect.runPromise(request)).rejects.toMatchObject({ _tag: "HostedAuthError" });
		},
	);

	it("rejects an unavailable response without exposing its payload", async () => {
		const request = requestDemoSignIn(
			() => Promise.resolve(Response.json({ email: "demo@ryot.example" }, { status: 403 })),
			"https://ryot.example",
		);

		await expect(Effect.runPromise(request)).rejects.toMatchObject({
			_tag: "HostedAuthError",
			message: "Could not open the shared demo.",
		});
	});
});
