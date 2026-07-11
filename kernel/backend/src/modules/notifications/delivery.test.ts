import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { NotificationDeliveryService, NotificationMailer } from "./delivery";

type CapturedRequest = { url: string; body: string; headers: Record<string, string> };

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
		for (const channelSpecifics of specifics) {
			yield* service.send({ message: "hello", channelSpecifics });
		}
	}).pipe(
		Effect.provide(
			Layer.provide(
				NotificationDeliveryService.layer,
				Layer.mergeAll(FetchHttpClient.layer, makeAppConfigLayer(), NotificationMailer.layer),
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
				expect(captured[3]?.headers["authorization"]).toBe("Bearer auth");
				expect(captured[4]?.headers["access-token"]).toBe("token");
				expect(captured[5]?.url).toContain("user=user");
				expect(captured[6]?.url).toContain("k=key");
				expect(captured[7]?.url).toContain("/botbot/sendMessage");
			}),
		),
	);
});

it.effect("renders the generic transactional email", () => {
	type CapturedMail = Parameters<NotificationMailer["Service"]["send"]>[0]["mail"];
	const sentMessages: CapturedMail[] = [];
	const mailerLayer = Layer.succeed(NotificationMailer, {
		send: (input: Parameters<NotificationMailer["Service"]["send"]>[0]) =>
			Effect.sync(() => {
				sentMessages.push(input.mail);
			}),
	});

	return Effect.gen(function* () {
		const service = yield* NotificationDeliveryService;
		yield* service.send({
			message: "hello <world> & friends",
			channelSpecifics: { kind: "email", recipient: "recipient@example.com" },
		});

		expect(sentMessages).toHaveLength(1);
		expect(sentMessages[0]).toMatchObject({
			to: "recipient@example.com",
			subject: "Ryot notification",
			from: "Ryot <no-reply@ryot.io>",
		});
		const sent = sentMessages[0];
		expect(sent?.html).toContain("You have a message");
		expect(sent?.html).toContain("hello &lt;world&gt; &amp; friends");
		expect(sent?.text).toContain("hello <world> & friends");
	}).pipe(
		Effect.provide(
			Layer.provide(
				NotificationDeliveryService.layer,
				Layer.mergeAll(
					FetchHttpClient.layer,
					makeAppConfigLayer({
						server: {
							smtp: {
								server: Option.some("smtp.example.com"),
								user: Option.some(Redacted.make("user")),
								password: Option.some(Redacted.make("password")),
							},
						},
					}),
					mailerLayer,
				),
			),
		),
	);
});
