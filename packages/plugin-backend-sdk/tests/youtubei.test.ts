import { configureApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	createYoutubeHistoryClient,
	createYoutubeMusicClient,
	type YoutubeiHost,
} from "@ryot-app/plugin-backend-sdk/youtubei";
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
				const requests: {
					url: string;
					body: string | undefined;
					headers: Record<string, string> | undefined;
				}[] = [];
				const host = {
					httpCall: (_method, url, options) =>
						Effect.sync(() => {
							requests.push({ url, body: options?.body, headers: options?.headers });
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
				const headers = new Headers(requests[0]?.headers);
				expect(headers.get("origin")).toBe("https://www.youtube.com");
				expect(headers.get("cookie")).toBe("SAPISID=value");
				expect(headers.get("authorization")).toMatch(/^SAPISIDHASH /);
				const body = yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Struct({ params: Schema.String, browseId: Schema.String })),
				)(requests[0]?.body ?? "{}");
				expect(body).toMatchObject({ params: "oggECgIIAQ%3D%3D", browseId: "FEmusic_history" });
			}),
		));

	test.each([
		{
			expectedOrigin: "https://www.youtube.com",
			url: "https://www.youtube.com/youtubei/v1/browse",
		},
		{ expectedOrigin: null, url: "https://example.com/resource" },
		{ expectedOrigin: null, url: "https://www.youtube.com.example.com/resource" },
	])("scopes the authentication origin for $url", ({ url, expectedOrigin }) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const origins: (string | null)[] = [];
				const host = {
					httpCall: (_method, _url, options) =>
						Effect.sync(() => {
							origins.push(new Headers(options?.headers).get("origin"));
							return { body: "{}", status: 200, headers: {} };
						}),
				} satisfies YoutubeiHost;
				const client = yield* createYoutubeMusicClient(host, undefined, {
					retrievePlayer: false,
					retrieveInnertubeConfig: false,
				});

				yield* Effect.tryPromise(() => client.session.http.fetch(new URL(url)));

				expect(origins).toEqual([expectedOrigin]);
			}),
		),
	);

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
