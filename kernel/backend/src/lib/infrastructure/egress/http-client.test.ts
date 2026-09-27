import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Option, Ref } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { EgressDenied, egressHttpClientLayer } from "./http-client";
import { EgressResolver } from "./resolver";

type CapturedFetch = Readonly<{
	url: string;
	body: string;
	host: string | null;
	tls: unknown;
	proxy: unknown;
	method: string;
	redirect: unknown;
	keepalive: unknown;
	headers: Readonly<Record<string, string>>;
}>;

class Recorded extends Context.Service<
	Recorded,
	{
		readonly lookups: Effect.Effect<ReadonlyArray<string>>;
		readonly fetches: Effect.Effect<ReadonlyArray<CapturedFetch>>;
	}
>()("test/Recorded") {}

const RESOLUTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
	"empty.test": [],
	"example.test": ["93.184.215.14"],
	"loopback.test": ["127.0.0.1", "::1"],
	"mixed.test": ["93.184.215.14", "10.0.0.1"],
	"v6.test": ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"],
};

const recordingLayer = Layer.effectContext(
	Effect.gen(function* () {
		const fetches = yield* Ref.make<ReadonlyArray<CapturedFetch>>([]);
		const lookups = yield* Ref.make<ReadonlyArray<string>>([]);
		const run = Effect.runPromiseWith(yield* Effect.context());
		const recordingFetch = (input: string | Request | URL, init?: BunFetchRequestInit) =>
			run(
				Effect.gen(function* () {
					const body = yield* Effect.promise(() => new Response(init?.body).text());
					yield* Ref.update(fetches, (all) => [
						...all,
						{
							body,
							tls: init?.tls,
							proxy: init?.proxy,
							redirect: init?.redirect,
							keepalive: init?.keepalive,
							method: init?.method ?? "GET",
							host: new Headers(init?.headers).get("host"),
							url: input instanceof Request ? input.url : input.toString(),
							headers: Object.fromEntries(new Headers(init?.headers).entries()),
						},
					]);
					return new Response("ok");
				}),
			);
		return Context.make(
			FetchHttpClient.Fetch,
			Object.assign(recordingFetch, { preconnect: globalThis.fetch.preconnect }),
		).pipe(
			Context.add(EgressResolver, {
				resolve: (hostname) =>
					Ref.update(lookups, (all) => [...all, hostname]).pipe(
						Effect.andThen(
							RESOLUTIONS[hostname] === undefined
								? Effect.fail(new Cause.UnknownError("unresolvable"))
								: Effect.succeed(RESOLUTIONS[hostname]),
						),
					),
			}),
			Context.add(Recorded, { lookups: Ref.get(lookups), fetches: Ref.get(fetches) }),
		);
	}),
);

const egressLayer = (allowedNetworks?: string) =>
	egressHttpClientLayer.pipe(
		Layer.provideMerge(recordingLayer),
		Layer.provide(
			makeAppConfigLayer({
				server: {
					egressAllowedNetworks:
						allowedNetworks === undefined ? Option.none() : Option.some(allowedNetworks),
				},
			}),
		),
	);

const denialReason = (request: HttpClientRequest.HttpClientRequest) =>
	Effect.gen(function* () {
		const error = yield* (yield* HttpClient.HttpClient).execute(request).pipe(Effect.flip);
		expect(error.reason._tag).toBe("InvalidUrlError");
		return error.reason.cause instanceof EgressDenied ? error.reason.cause.reason : undefined;
	});

const deniedGet = (url: string) => denialReason(HttpClientRequest.get(url));

layer(egressLayer())((test) => {
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

			const recorded = yield* Recorded;
			expect(yield* recorded.fetches).toEqual([]);
			expect(yield* recorded.lookups).toEqual([]);
		}),
	);
});

layer(egressLayer())((test) => {
	test.effect("connects to the resolved address while the response keeps the hostname", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const insecureRequestInit: RequestInit & { tls: { rejectUnauthorized: boolean } } = {
				tls: { rejectUnauthorized: false },
			};
			const plain = yield* client.execute(HttpClientRequest.get("http://example.test/plain"));
			yield* client
				.execute(
					HttpClientRequest.post("https://example.test:8443/submit").pipe(
						HttpClientRequest.bodyText("payload", "text/plain"),
						HttpClientRequest.setHeaders({ "x-trace": "t" }),
					),
				)
				.pipe(Effect.provideService(FetchHttpClient.RequestInit, insecureRequestInit));
			yield* client.execute(HttpClientRequest.get("https://v6.test/path"));

			expect(plain.request.url).toBe("http://example.test/plain");
			const recorded = yield* Recorded;
			expect(yield* recorded.lookups).toEqual(["example.test", "example.test", "v6.test"]);
			expect(yield* recorded.fetches).toMatchObject([
				{
					body: "",
					proxy: false,
					method: "GET",
					redirect: "manual",
					keepalive: undefined,
					host: "example.test",
					url: "http://93.184.215.14/plain",
					tls: { serverName: "example.test" },
				},
				{
					proxy: false,
					method: "POST",
					body: "payload",
					redirect: "manual",
					keepalive: undefined,
					host: "example.test:8443",
					url: "https://93.184.215.14:8443/submit",
					headers: { "x-trace": "t", "content-type": "text/plain" },
					tls: { rejectUnauthorized: false, serverName: "example.test" },
				},
				{
					body: "",
					proxy: false,
					method: "GET",
					host: "v6.test",
					redirect: "manual",
					keepalive: undefined,
					tls: { serverName: "v6.test" },
					url: "https://[2606:2800:21f:cb07:6820:80da:af6b:8b2c]/path",
				},
			]);
		}),
	);
});

layer(egressLayer())((test) => {
	test.effect("connects to an IP literal without resolving it or naming a server", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			yield* client.execute(HttpClientRequest.get("https://93.184.215.14/a"));
			yield* client.execute(HttpClientRequest.get("http://[2606:4700::1111]:8080/b"));

			const recorded = yield* Recorded;
			expect(yield* recorded.lookups).toEqual([]);
			expect(yield* recorded.fetches).toMatchObject([
				{
					body: "",
					host: null,
					proxy: false,
					method: "GET",
					tls: undefined,
					redirect: "manual",
					keepalive: undefined,
					url: "https://93.184.215.14/a",
				},
				{
					body: "",
					host: null,
					proxy: false,
					method: "GET",
					tls: undefined,
					redirect: "manual",
					keepalive: undefined,
					url: "http://[2606:4700::1111]:8080/b",
				},
			]);
		}),
	);
});

layer(egressLayer())((test) => {
	test.effect("denies special-purpose and unresolvable destinations without fetching", () =>
		Effect.gen(function* () {
			const unixSocketRequestInit: BunFetchRequestInit = { unix: "/var/run/docker.sock" };
			expect(yield* deniedGet("http://mixed.test/")).toBe("address");
			expect(yield* deniedGet("http://loopback.test/")).toBe("address");
			expect(yield* deniedGet("http://169.254.169.254/latest/meta-data/")).toBe("address");
			expect(yield* deniedGet("http://[::1]:3000/")).toBe("address");
			expect(yield* deniedGet("http://[::ffff:127.0.0.1]/")).toBe("address");
			expect(yield* deniedGet("http://0.0.0.0:3000/")).toBe("address");
			expect(yield* deniedGet("http://2130706433/")).toBe("address");
			expect(yield* deniedGet("http://empty.test/")).toBe("resolution");
			expect(yield* deniedGet("http://unknown.test/")).toBe("resolution");
			expect(
				yield* deniedGet("http://example.test/").pipe(
					Effect.provideService(FetchHttpClient.RequestInit, unixSocketRequestInit),
				),
			).toBe("address");

			expect(yield* (yield* Recorded).fetches).toEqual([]);
		}),
	);
});

layer(egressLayer("127.0.0.1/32,::1/128"))((test) => {
	test.effect("pins a loopback hostname when every resolved address is allowlisted", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			yield* client.execute(HttpClientRequest.get("http://loopback.test:3000/"));
			yield* client.execute(HttpClientRequest.get("http://[::1]:3000/"));
			expect(yield* denialReason(HttpClientRequest.get("http://169.254.169.254/"))).toBe("address");

			expect((yield* (yield* Recorded).fetches).map(({ url, host }) => [url, host])).toEqual([
				["http://127.0.0.1:3000/", "loopback.test:3000"],
				["http://[::1]:3000/", null],
			]);
		}),
	);
});

layer(egressLayer("127.0.0.1/32"))((test) => {
	test.effect("denies a hostname when any resolved address is outside the allowlist", () =>
		Effect.gen(function* () {
			expect(yield* denialReason(HttpClientRequest.get("http://loopback.test/"))).toBe("address");
			expect(yield* (yield* Recorded).fetches).toEqual([]);
		}),
	);
});
