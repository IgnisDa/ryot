import { configureApprovedDependencyRuntime } from "@ryot-app/sandbox-sdk/dependency-runtime";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	createYoutubeHistoryClient,
	createYoutubeMusicClient,
	type YoutubeiHost,
} from "@ryot-app/sandbox-sdk/youtubei";
import { describe, expect, test } from "vitest";

let approvedDependencyRuntimeCalls = 0;

configureApprovedDependencyRuntime(<A>(operation: () => Promise<A>) => {
	approvedDependencyRuntimeCalls += 1;
	return operation();
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

				yield* client.getHistory();

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
				const host = {
					httpCall: () => Effect.fail({ message: "unexpected network call" }),
				} satisfies YoutubeiHost;

				const callsBefore = approvedDependencyRuntimeCalls;
				const client = yield* createYoutubeMusicClient(host, undefined, {
					retrievePlayer: false,
					retrieveInnertubeConfig: false,
				});

				expect(client).toBeTruthy();
				expect(approvedDependencyRuntimeCalls - callsBefore).toBe(1);
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
