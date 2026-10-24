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

const makeFetchHarness = Effect.gen(function* () {
	const requests: Parameters<YoutubeiHost["httpCall"]>[] = [];
	const host = {
		httpCall: (...args) =>
			Effect.sync(() => {
				requests.push(args);
				return { body: "{}", status: 200, headers: {} };
			}),
	} satisfies YoutubeiHost;
	const client = yield* createYoutubeMusicClient(host, undefined, {
		retrievePlayer: false,
		retrieveInnertubeConfig: false,
	});
	return { requests, fetch: client.session.http.fetch_function };
});

describe("Youtubei sandbox adapter", () => {
	test("accepts a URL through the platform fetch boundary", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;

				yield* Effect.tryPromise(() =>
					fetch(new URL("https://example.com/resource?x=1"), {
						method: "POST",
						body: "URL body",
						headers: { "content-type": "application/custom" },
					}),
				);

				expect(requests).toEqual([
					[
						"POST",
						"https://example.com/resource?x=1",
						{ body: "URL body", headers: { "content-type": "application/custom" } },
					],
				]);
			}),
		));

	test("replaces input headers and normalizes init method and body", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;
				const input = new Request("https://example.com/resource", {
					method: "POST",
					body: "old body",
					headers: { "x-old": "remove", "content-type": "old/type" },
				});

				yield* Effect.tryPromise(() =>
					fetch(input, {
						method: "put",
						headers: [["X-New", "  replacement  "]],
						body: new URLSearchParams({ lang: "en", query: "a b" }),
					}),
				);

				expect(requests).toEqual([
					[
						"PUT",
						"https://example.com/resource",
						{
							body: "lang=en&query=a+b",
							headers: {
								"x-new": "replacement",
								"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
							},
						},
					],
				]);
			}),
		));

	test.each([
		{ name: "string", expected: "text", body: () => "text" },
		{ expected: "", body: () => "", name: "empty string" },
		{ name: "buffer", expected: "buffer", body: () => new TextEncoder().encode("buffer").buffer },
		{
			expected: "view",
			name: "buffer view",
			body: () => new TextEncoder().encode("_view_").subarray(1, 5),
		},
		{
			name: "stream",
			expected: "stream",
			body: () =>
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("stream"));
						controller.close();
					},
				}),
		},
	])("sends admitted $name bodies", ({ body, expected }) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;

				yield* Effect.tryPromise(() =>
					fetch("https://example.com/resource", { body: body(), method: "POST" }),
				);

				expect(requests).toHaveLength(1);
				expect(requests[0]).toMatchObject([
					"POST",
					"https://example.com/resource",
					{ body: expected },
				]);
			}),
		),
	);

	test("preserves an input request body without init overrides", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;
				yield* Effect.tryPromise(() =>
					fetch(
						new Request("https://example.com/resource", {
							method: "POST",
							body: "input body",
							headers: { "x-input": "keep", "content-type": "application/custom" },
						}),
					),
				);
				expect(requests).toEqual([
					[
						"POST",
						"https://example.com/resource",
						{
							body: "input body",
							headers: { "x-input": "keep", "content-type": "application/custom" },
						},
					],
				]);
			}),
		));

	test("adds the YouTube origin to normalized YouTube requests", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;

				yield* Effect.tryPromise(() =>
					fetch(new Request("https://www.youtube.com/resource", { body: "old", method: "POST" }), {
						method: "put",
						headers: [["X-New", " replacement "]],
						body: new URLSearchParams({ query: "a b" }),
					}),
				);

				expect(requests).toEqual([
					[
						"PUT",
						"https://www.youtube.com/resource",
						{
							body: "query=a+b",
							headers: {
								"x-new": "replacement",
								origin: "https://www.youtube.com",
								"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
							},
						},
					],
				]);
			}),
		));

	test.each([false, true])(
		"replacement bodies do not consume input (already used: %j)",
		(consumed) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const { fetch, requests } = yield* makeFetchHarness;
					const input = new Request("https://example.com/resource", {
						method: "POST",
						body: "original",
						headers: { "content-type": "application/custom" },
					});
					if (consumed) {
						yield* Effect.tryPromise(() => input.text());
					}

					yield* Effect.tryPromise(() => fetch(input, { method: "POST", body: "replacement" }));

					expect(input.bodyUsed).toBe(consumed);
					if (!consumed) {
						const original = yield* Effect.tryPromise(() => input.text());
						expect(original).toBe("original");
					}
					expect(requests).toEqual([
						[
							"POST",
							"https://example.com/resource",
							{ body: "replacement", headers: { "content-type": "application/custom" } },
						],
					]);
				}),
			),
	);

	test("propagates a rejected stream read without calling the host", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;
				const failure = new Error("body read failed");
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.error(failure);
					},
				});

				yield* Effect.promise(() =>
					expect(
						fetch("https://example.com/resource", { body, method: "POST" }),
					).rejects.toMatchObject({ cause: failure }),
				);
				expect(requests).toEqual([]);
			}),
		));

	test("rejects malformed headers before calling the host", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { fetch, requests } = yield* makeFetchHarness;
				yield* Effect.promise(() =>
					expect(
						fetch("https://example.com/resource", { headers: { "invalid header": "value" } }),
					).rejects.toMatchObject({ cause: expect.any(TypeError) }),
				);
				expect(requests).toEqual([]);
			}),
		));

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
