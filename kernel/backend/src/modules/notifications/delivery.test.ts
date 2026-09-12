import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Option, Redacted, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { NotificationDeliveryService, NotificationMailer } from "./delivery";

type CapturedRequest = { url: string; body: string; headers: Record<string, string> };

const specifics = [
	{ key: "key", kind: "apprise" as const, baseUrl: "http://apprise" },
	{ kind: "discord" as const, webhookUrl: "http://discord/webhook" },
	{ token: "token", kind: "gotify" as const, baseUrl: "http://gotify" },
	{ topic: "topic", accessToken: "auth", kind: "ntfy" as const, baseUrl: "http://ntfy" },
	{ accessToken: "token", kind: "push_bullet" as const },
	{ appToken: "app", userKey: "user", kind: "push_over" as const },
	{ key: "key", kind: "push_safer" as const },
	{ chatId: "chat", botToken: "bot", kind: "telegram" as const },
];

class RecordedFetches extends Context.Service<
	RecordedFetches,
	{ readonly requests: Effect.Effect<ReadonlyArray<CapturedRequest>> }
>()("test/RecordedFetches") {}

const recordingFetchLayer = Layer.effectContext(
	Effect.gen(function* () {
		const requests = yield* Ref.make<ReadonlyArray<CapturedRequest>>([]);
		const run = Effect.runPromiseWith(yield* Effect.context());
		const stubFetch = (input: string | Request | URL, init?: RequestInit) => {
			const request =
				input instanceof Request
					? input
					: new Request(input instanceof URL ? input.toString() : input, init);
			return run(
				Effect.gen(function* () {
					const body = yield* Effect.promise(() => request.clone().text());
					yield* Ref.update(requests, (all) => [
						...all,
						{ body, url: request.url, headers: Object.fromEntries(request.headers.entries()) },
					]);
					return new Response("", { status: 200 });
				}),
			);
		};
		return Context.make(
			FetchHttpClient.Fetch,
			Object.assign(stubFetch, { preconnect: globalThis.fetch.preconnect }),
		).pipe(Context.add(RecordedFetches, { requests: Ref.get(requests) }));
	}),
);

layer(
	NotificationDeliveryService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(FetchHttpClient.layer, makeAppConfigLayer(), NotificationMailer.layer),
		),
		Layer.provideMerge(recordingFetchLayer),
	),
)((test) => {
	test.effect("builds the v1 request shape for every HTTP notification provider", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			for (const channelSpecifics of specifics) {
				yield* service.send({ message: "hello", channelSpecifics });
			}

			const captured = yield* (yield* RecordedFetches).requests;
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
	);
});

type CapturedMail = Parameters<NotificationMailer["Service"]["send"]>[0]["mail"];

class RecordedMail extends Context.Service<
	RecordedMail,
	{ readonly sent: Effect.Effect<ReadonlyArray<CapturedMail>> }
>()("test/RecordedMail") {}

const recordingMailerLayer = Layer.effectContext(
	Effect.gen(function* () {
		const sent = yield* Ref.make<ReadonlyArray<CapturedMail>>([]);
		return Context.make(NotificationMailer, {
			send: (input: Parameters<NotificationMailer["Service"]["send"]>[0]) =>
				Ref.update(sent, (all) => [...all, input.mail]),
		}).pipe(Context.add(RecordedMail, { sent: Ref.get(sent) }));
	}),
);

layer(
	NotificationDeliveryService.layer.pipe(
		Layer.provideMerge(
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
				recordingMailerLayer,
			),
		),
	),
)((test) => {
	test.effect("renders the generic transactional email", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			yield* service.send({
				message: "hello <world> & friends",
				channelSpecifics: { kind: "email", recipient: "recipient@example.com" },
			});

			const sentMessages = yield* (yield* RecordedMail).sent;
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
		}),
	);
});
