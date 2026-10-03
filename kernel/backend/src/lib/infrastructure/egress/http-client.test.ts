import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http";

import { assertExitFails } from "#lib/test-utils/assertions";

import { EgressDenied, EgressHttpClientLive } from "./http-client";

type CapturedFetch = Readonly<{
	url: string;
	body: string;
	tls: unknown;
	method: string;
	headers: Readonly<Record<string, string>>;
}>;

class RecordedFetches extends Context.Service<
	RecordedFetches,
	{ readonly fetches: Effect.Effect<ReadonlyArray<CapturedFetch>> }
>()("test/RecordedFetches") {}

const recordingFetchLayer = Layer.effectContext(
	Effect.gen(function* () {
		const fetches = yield* Ref.make<ReadonlyArray<CapturedFetch>>([]);
		const run = Effect.runPromiseWith(yield* Effect.context());
		const recordingFetch = (input: string | Request | URL, init?: RequestInit) => {
			const request =
				input instanceof Request
					? input
					: new Request(input instanceof URL ? input.toString() : input, init);
			return run(
				Effect.gen(function* () {
					const body = yield* Effect.promise(() => request.clone().text());
					yield* Ref.update(fetches, (all) => [
						...all,
						{
							body,
							url: request.url,
							method: request.method,
							tls: init && "tls" in init ? init.tls : undefined,
							headers: Object.fromEntries(request.headers.entries()),
						},
					]);
					return new Response("ok");
				}),
			);
		};
		return Context.make(
			FetchHttpClient.Fetch,
			Object.assign(recordingFetch, { preconnect: globalThis.fetch.preconnect }),
		).pipe(Context.add(RecordedFetches, { fetches: Ref.get(fetches) }));
	}),
);

const egressLayer = Layer.merge(EgressHttpClientLive, recordingFetchLayer);

layer(egressLayer)((test) => {
	test.effect("refuses non-HTTP schemes as a certain failure without fetching", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			for (const url of [
				"file:///etc/passwd",
				"data:text/plain,secret",
				"blob:https://example.test/0b1c",
				"s3://bucket/key",
			]) {
				const request = HttpClientRequest.get(url);
				assertExitFails(
					yield* Effect.exit(client.execute(request)),
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.InvalidUrlError({
							request,
							description: "destination denied",
							cause: new EgressDenied({ reason: "scheme" }),
						}),
					}),
				);
			}
			const rewritten = yield* client
				.pipe(HttpClient.mapRequest(HttpClientRequest.setUrl("file:///etc/passwd")))
				.execute(HttpClientRequest.get("https://example.test/"))
				.pipe(Effect.flip);
			expect(rewritten.reason.cause).toEqual(new EgressDenied({ reason: "scheme" }));

			expect(yield* (yield* RecordedFetches).fetches).toEqual([]);
		}),
	);
});

layer(egressLayer)((test) => {
	test.effect("passes HTTP and HTTPS requests to fetch unchanged", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const insecureRequestInit: RequestInit & { tls: { rejectUnauthorized: boolean } } = {
				tls: { rejectUnauthorized: false },
			};
			yield* client.execute(HttpClientRequest.get("http://example.test/plain"));
			yield* client
				.execute(
					HttpClientRequest.post("https://example.test/submit").pipe(
						HttpClientRequest.bodyText("payload", "text/plain"),
						HttpClientRequest.setHeaders({ "x-trace": "t" }),
					),
				)
				.pipe(Effect.provideService(FetchHttpClient.RequestInit, insecureRequestInit));

			expect(yield* (yield* RecordedFetches).fetches).toMatchObject([
				{ body: "", method: "GET", tls: undefined, url: "http://example.test/plain" },
				{
					method: "POST",
					body: "payload",
					url: "https://example.test/submit",
					tls: { rejectUnauthorized: false },
					headers: { "x-trace": "t", "content-type": "text/plain" },
				},
			]);
		}),
	);
});
