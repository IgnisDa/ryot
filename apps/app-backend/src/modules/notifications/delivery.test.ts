import { FetchHttpClient } from "@effect/platform";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { makeAppConfigLayer } from "#lib/test-support/effect";

import { NotificationDeliveryService } from "./delivery";

type CapturedRequest = {
	url: string;
	body: string;
	headers: Record<string, string>;
};

it.effect("builds the v1 request shape for every HTTP notification provider", () => {
	const captured: CapturedRequest[] = [];
	const originalFetch = globalThis.fetch;
	const stubFetch = (input: string | Request | URL, init?: RequestInit) => {
		const request =
			input instanceof Request
				? input
				: new Request(input instanceof URL ? input.toString() : input, init);
		return request
			.clone()
			.text()
			.then((body) => {
				captured.push({
					body,
					url: request.url,
					headers: Object.fromEntries(request.headers.entries()),
				});
				return new Response("", { status: 200 });
			});
	};
	globalThis.fetch = Object.assign(stubFetch, { preconnect: originalFetch.preconnect });

	const specifics = [
		{ baseUrl: "http://apprise", key: "key", kind: "apprise" as const },
		{ kind: "discord" as const, webhookUrl: "http://discord/webhook" },
		{ baseUrl: "http://gotify", kind: "gotify" as const, token: "token" },
		{ kind: "ntfy" as const, topic: "topic", accessToken: "auth", baseUrl: "http://ntfy" },
		{ accessToken: "token", kind: "push_bullet" as const },
		{ appToken: "app", kind: "push_over" as const, userKey: "user" },
		{ key: "key", kind: "push_safer" as const },
		{ botToken: "bot", chatId: "chat", kind: "telegram" as const },
	];

	const program = Effect.gen(function* () {
		const service = yield* NotificationDeliveryService;
		for (const platformSpecifics of specifics) {
			yield* service.send({ message: "hello", platformSpecifics });
		}
	}).pipe(
		Effect.provide(
			Layer.provide(
				NotificationDeliveryService.Default,
				Layer.mergeAll(FetchHttpClient.layer, makeAppConfigLayer()),
			),
		),
		Effect.ensuring(
			Effect.sync(() => {
				globalThis.fetch = originalFetch;
			}),
		),
	);

	return program.pipe(
		Effect.tap(() =>
			Effect.sync(() => {
				expect(captured).toHaveLength(specifics.length);
				expect(captured[0]?.url).toBe("http://apprise/notify/key");
				expect(captured[1]?.body).toContain('"content":"hello"');
				expect(captured[2]?.headers["x-gotify-key"]).toBe("token");
				expect(captured[3]?.headers.authorization).toBe("Bearer auth");
				expect(captured[4]?.headers["access-token"]).toBe("token");
				expect(captured[5]?.url).toContain("user=user");
				expect(captured[6]?.url).toContain("k=key");
				expect(captured[7]?.url).toContain("/botbot/sendMessage");
			}),
		),
	);
});
