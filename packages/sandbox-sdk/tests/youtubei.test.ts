import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	createYoutubeHistoryClient,
	createYoutubeMusicClient,
	type YoutubeiHost,
} from "@ryot-app/sandbox-sdk/youtubei";
import { describe, expect, test } from "vitest";

const runtimeKey = Symbol.for("@ryot-app/sandbox-sdk/approved-dependency-runtime");

const withRuntime = <A, E>(operation: Effect.Effect<A, E>, calls: { count: number }) =>
	Effect.suspend(() => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, runtimeKey);
		Object.defineProperty(globalThis, runtimeKey, {
			configurable: true,
			value: (callback: () => Promise<unknown>) => {
				calls.count += 1;
				return callback();
			},
		});
		return operation.pipe(
			Effect.ensuring(
				Effect.sync(() => {
					if (previous) {
						Object.defineProperty(globalThis, runtimeKey, previous);
					} else {
						Reflect.deleteProperty(globalThis, runtimeKey);
					}
				}),
			),
		);
	});

describe("Youtubei sandbox adapter", () => {
	test("requests YouTube Music history", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requests: { body: string | undefined; url: string }[] = [];
				const host = {
					httpCall: (_method, url, options) =>
						Effect.sync(() => {
							requests.push({ url, body: options?.body });
							return {
								status: 200,
								body: '{"contents":{"history":true}}',
								headers: { "content-type": "application/json" },
							};
						}),
				} satisfies YoutubeiHost;
				const client = yield* createYoutubeHistoryClient(host, "SAPISID=value");

				yield* Effect.tryPromise(() => client.getHistory());

				expect(requests).toHaveLength(1);
				expect(new URL(requests[0]?.url ?? "").pathname).toBe("/youtubei/v1/browse");
				const body = yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Struct({ params: Schema.String, browseId: Schema.String })),
				)(requests[0]?.body ?? "{}");
				expect(body).toMatchObject({ params: "oggECgIIAQ%3D%3D", browseId: "FEmusic_history" });
			}),
		));

	test("keeps the dependency runtime scope private to SDK calls", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const calls = { count: 0 };
				const host = {
					httpCall: () => Effect.fail({ message: "unexpected network call" }),
				} as YoutubeiHost;

				const client = yield* withRuntime(
					createYoutubeMusicClient(host, undefined, {
						retrievePlayer: false,
						retrieveInnertubeConfig: false,
					}),
					calls,
				);

				expect(client).toBeTruthy();
				expect(calls.count).toBe(1);
			}),
		));

	test("does not turn a pending host failure into an HTTP response", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const pending = Symbol("pending");
				const host = { httpCall: () => Effect.fail(pending) } satisfies YoutubeiHost;
				const client = yield* createYoutubeMusicClient(host, undefined, {
					retrievePlayer: false,
					retrieveInnertubeConfig: false,
				});

				const failure = yield* Effect.flip(
					Effect.tryPromise(() => client.actions.execute("/pending", { value: 1 })),
				);
				expect(failure).toMatchObject({ cause: pending });
			}),
		));
});
