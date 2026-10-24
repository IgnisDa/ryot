import { expect, layer } from "@effect/vitest";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Data, Effect, Layer, Option, Redacted, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import { makeAppConfigLayer } from "#testing/effect";

import {
	NotificationDeliveryError,
	NotificationDeliveryService,
	NotificationMailer,
} from "./delivery";

type ResponseForRequest = (request: CapturedRequest) => Response;
type CapturedMail = Parameters<NotificationMailer["Service"]["send"]>[0]["mail"];
type CapturedRequest = { url: string; body: string; headers: Record<string, string> };

class TestFetchFailure extends Data.TaggedError("TestFetchFailure")<{ cause: unknown }> {}

const apprise = { key: "key", kind: "apprise" as const, baseUrl: "http://apprise" };
const discord = { kind: "discord" as const, webhookUrl: "http://discord/webhook" };
const gotify = { token: "token", kind: "gotify" as const, baseUrl: "http://gotify" };
const ntfy = { topic: "topic", accessToken: "auth", kind: "ntfy" as const, baseUrl: "http://ntfy" };
const pushBullet = { accessToken: "token", kind: "push_bullet" as const };
const pushover = { appToken: "app", userKey: "user", kind: "push_over" as const };
const pushSafer = { key: "key", kind: "push_safer" as const };
const telegram = { chatId: "chat", botToken: "bot", kind: "telegram" as const };
const specifics = [apprise, discord, gotify, ntfy, pushBullet, pushover, pushSafer, telegram];

class RecordedFetches extends Context.Service<
	RecordedFetches,
	{ readonly requests: Effect.Effect<ReadonlyArray<CapturedRequest>> }
>()("test/RecordedFetches") {}

const successfulResponse: ResponseForRequest = ({ url }) => {
	if (url.includes("api.telegram.org")) {
		return Response.json({ ok: true });
	}
	if (url.includes("pushover.net")) {
		return Response.json({ status: 1 });
	}
	if (url.includes("pushsafer.com")) {
		return Response.json({ status: 1 });
	}
	return new Response("", { status: 200 });
};

const recordingFetchLayer = (respond: ResponseForRequest = successfulResponse) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<CapturedRequest>>([]);
			const run = Effect.runPromiseWith(yield* Effect.context());
			const stubFetch = (input: URL | string | Request, init?: RequestInit) => {
				const request =
					input instanceof Request
						? input
						: new Request(input instanceof URL ? input.toString() : input, init);
				return run(
					Effect.gen(function* () {
						const body = yield* Effect.promise(() => request.clone().text());
						const captured = {
							body,
							url: request.url,
							headers: Object.fromEntries(request.headers.entries()),
						};
						yield* Ref.update(requests, (all) => [...all, captured]);
						return yield* Effect.try({
							try: () => respond(captured),
							catch: (cause) => new TestFetchFailure({ cause }),
						});
					}),
				);
			};
			return Context.make(
				FetchHttpClient.Fetch,
				Object.assign(stubFetch, { preconnect: globalThis.fetch.preconnect }),
			).pipe(Context.add(RecordedFetches, { requests: Ref.get(requests) }));
		}),
	);

class RecordedMail extends Context.Service<
	RecordedMail,
	{ readonly sent: Effect.Effect<ReadonlyArray<CapturedMail>> }
>()("test/RecordedMail") {}

const recordingMailerLayer = (
	options: { accepted?: ReadonlyArray<string>; failure?: NotificationDeliveryError } = {},
) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const sent = yield* Ref.make<ReadonlyArray<CapturedMail>>([]);
			return Context.make(NotificationMailer, {
				send: (input: Parameters<NotificationMailer["Service"]["send"]>[0]) => {
					if (options.failure) {
						return Effect.fail(options.failure);
					}
					return Ref.update(sent, (all) => [...all, input.mail]).pipe(
						Effect.as({ accepted: [...(options.accepted ?? [input.mail.to])] }),
					);
				},
			}).pipe(Context.add(RecordedMail, { sent: Ref.get(sent) }));
		}),
	);

const smtpConfig = {
	server: {
		smtp: Option.some({
			server: "smtp.example.com",
			user: Redacted.make("user"),
			mailbox: "Ryot <no-reply@ryot.io>",
			password: Redacted.make("password"),
		}),
	},
};

const deliveryTestLayer = (
	options: {
		respond?: ResponseForRequest;
		config?: Parameters<typeof makeAppConfigLayer>[0];
		mailer?: { accepted?: ReadonlyArray<string>; failure?: NotificationDeliveryError };
	} = {},
) =>
	NotificationDeliveryService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				FetchHttpClient.layer,
				makeAppConfigLayer(options.config),
				recordingMailerLayer(options.mailer),
			),
		),
		Layer.provideMerge(recordingFetchLayer(options.respond)),
	);

layer(deliveryTestLayer())((test) => {
	test.effect("builds the existing request shape for every HTTP notification provider", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			for (const channelSpecifics of specifics) {
				expect(yield* service.send({ message: "hello", channelSpecifics })).toBeUndefined();
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

	test.effect("accepts an empty-body 2xx acknowledgement", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			expect(yield* service.send({ message: "hello", channelSpecifics: discord })).toBeUndefined();
		}),
	);
});

layer(deliveryTestLayer())((test) => {
	test.effect("sends Telegram text without a parse mode", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			yield* service.send({ message: "hello *world*", channelSpecifics: telegram });

			const captured = yield* (yield* RecordedFetches).requests;
			expect(captured[0]?.body).toBe('{"text":"hello *world*","chat_id":"chat"}');
		}),
	);
});

layer(
	deliveryTestLayer({
		respond: () => new Response('{"error":"secret provider detail"}', { status: 503 }),
	}),
)((test) => {
	test.effect("reports an explicit HTTP rejection as failed without provider response text", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(service.send({ message: "hello", channelSpecifics: discord })),
				new NotificationDeliveryError({
					outcome: "failed",
					message: "Discord rejected request with status 503",
				}),
			);
		}),
	);
});

layer(
	deliveryTestLayer({
		respond: ({ url }) => {
			if (url.includes("api.telegram.org")) {
				return Response.json({ ok: false });
			}
			if (url.includes("pushover.net")) {
				return Response.json({ status: 0 });
			}
			return Response.json({ status: 0 });
		},
	}),
)((test) => {
	test.effect("reports structured provider rejection as failed", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			const structuredCases = [
				{ channelSpecifics: pushover, message: "Pushover rejected the notification" },
				{ channelSpecifics: pushSafer, message: "PushSafer rejected the notification" },
				{ channelSpecifics: telegram, message: "Telegram rejected the notification" },
			];
			for (const { message, channelSpecifics } of structuredCases) {
				assertExitFails(
					yield* Effect.exit(service.send({ message: "hello", channelSpecifics })),
					new NotificationDeliveryError({ message, outcome: "failed" }),
				);
			}
		}),
	);
});

layer(
	deliveryTestLayer({
		respond: ({ url }) => {
			if (url.includes("api.telegram.org")) {
				return Response.json({});
			}
			if (url.includes("pushover.net")) {
				return Response.json({ status: "1" });
			}
			return Response.json({ status: 2 });
		},
	}),
)((test) => {
	test.effect("treats missing and unexpected structured success fields as unknown", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			const cases = [
				{ channelSpecifics: pushover, message: "Pushover response could not be confirmed" },
				{ channelSpecifics: pushSafer, message: "PushSafer response could not be confirmed" },
				{ channelSpecifics: telegram, message: "Telegram response could not be confirmed" },
			];
			for (const { message, channelSpecifics } of cases) {
				assertExitFails(
					yield* Effect.exit(service.send({ message: "hello", channelSpecifics })),
					new NotificationDeliveryError({ message, outcome: "unknown" }),
				);
			}
		}),
	);
});

layer(deliveryTestLayer({ respond: () => new Response("not-json", { status: 200 }) }))((test) => {
	test.effect("treats malformed success JSON as unknown", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(service.send({ message: "hello", channelSpecifics: telegram })),
				new NotificationDeliveryError({
					outcome: "unknown",
					message: "Telegram response could not be confirmed",
				}),
			);
		}),
	);
});

layer(
	deliveryTestLayer({
		respond: () => {
			throw new Error("secret transport detail");
		},
	}),
)((test) => {
	test.effect("treats HTTP transport errors as unknown", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(service.send({ message: "hello", channelSpecifics: discord })),
				new NotificationDeliveryError({
					outcome: "unknown",
					message: "Discord response could not be confirmed",
				}),
			);
		}),
	);
});

layer(
	deliveryTestLayer({
		respond: () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.error(new Error("secret body detail"));
					},
				}),
				{ status: 200 },
			),
	}),
)((test) => {
	test.effect("treats HTTP body read errors as unknown", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(service.send({ message: "hello", channelSpecifics: discord })),
				new NotificationDeliveryError({
					outcome: "unknown",
					message: "Discord response could not be confirmed",
				}),
			);
		}),
	);
});

layer(deliveryTestLayer({ config: { server: { disableNotifications: true } } }))((test) => {
	test.effect("reports globally disabled delivery as skipped", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(service.send({ message: "hello", channelSpecifics: discord })),
				new NotificationDeliveryError({
					outcome: "skipped",
					message: "Notification delivery is disabled",
				}),
			);
			expect(yield* (yield* RecordedFetches).requests).toEqual([]);
		}),
	);
});

layer(deliveryTestLayer())((test) => {
	test.effect("reports an unconfigured SMTP transport as failed", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(
					service.send({
						message: "hello",
						channelSpecifics: { kind: "email", recipient: "recipient@example.com" },
					}),
				),
				new NotificationDeliveryError({ outcome: "failed", message: "SMTP is not configured" }),
			);
		}),
	);
});

layer(deliveryTestLayer({ config: smtpConfig, mailer: { accepted: [] } }))((test) => {
	test.effect("reports an SMTP result with no accepted recipients as failed", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(
					service.send({
						message: "hello",
						channelSpecifics: { kind: "email", recipient: "recipient@example.com" },
					}),
				),
				new NotificationDeliveryError({
					outcome: "failed",
					message: "SMTP did not accept the message",
				}),
			);
		}),
	);
});

layer(
	deliveryTestLayer({
		config: smtpConfig,
		mailer: {
			failure: new NotificationDeliveryError({
				outcome: "unknown",
				message: "SMTP request outcome is unknown",
			}),
		},
	}),
)((test) => {
	test.effect("keeps SMTP send errors conservatively unknown", () =>
		Effect.gen(function* () {
			const service = yield* NotificationDeliveryService;
			assertExitFails(
				yield* Effect.exit(
					service.send({
						message: "hello",
						channelSpecifics: { kind: "email", recipient: "recipient@example.com" },
					}),
				),
				new NotificationDeliveryError({
					outcome: "unknown",
					message: "SMTP request outcome is unknown",
				}),
			);
		}),
	);
});

layer(deliveryTestLayer({ config: smtpConfig }))((test) => {
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
