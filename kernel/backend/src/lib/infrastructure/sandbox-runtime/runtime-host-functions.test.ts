import { describe, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, MutableRef, Ref } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { withEgressPolicy } from "#lib/infrastructure/egress/http-client";
import { makeRedisService } from "#lib/test-utils/effect";
import { sandboxHttpRedirectClassifier } from "#modules/sandbox/durable-host-dispatcher";

import { RedisService } from "../redis";
import { ServerRun } from "../server-run";
import {
	makeRuntimeSandboxApiFunctions,
	SANDBOX_HTTP_REDIRECT_STOPPED_MESSAGE,
	type SandboxHttpClassify,
} from "./runtime-host-functions";
import type { SandboxRunInput } from "./shared";

const followAll: SandboxHttpClassify = () => Effect.succeed("follow");

const redirect = (status: number, location: string) =>
	new Response(null, { status, headers: { location } });

const hostWith = (client: HttpClient.HttpClient, classify: SandboxHttpClassify = followAll) =>
	makeRuntimeSandboxApiFunctions(classify).pipe(
		Effect.provideService(HttpClient.HttpClient, client),
	);

const input = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	lane: "interactive",
	executionId: "execution-1",
	principal: {
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "script",
		metadata: { runtimeImports: [] },
		scriptId: SandboxScriptId.make("script-1"),
		subject: {
			type: "user",
			userId: UserId.make("user-1"),
			accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
		},
	},
} as const satisfies SandboxRunInput;

const runtimeHostLayer = Layer.unwrap(
	Effect.gen(function* () {
		const values = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
		const run = Effect.runPromiseWith(yield* Effect.context());
		const read = (key: string) => MutableRef.get(values.ref).get(key) ?? null;
		const write = (key: string, value: string) =>
			MutableRef.update(values.ref, (all) => new Map(all).set(key, value));
		const client = Object.assign(Object.create(null), {
			get: (key: string) => Promise.resolve(read(key)),
			set: (key: string, value: string, ...options: ReadonlyArray<unknown>) =>
				run(
					Effect.sync(() => {
						if (options.includes("NX") && MutableRef.get(values.ref).has(key)) {
							return null;
						}
						write(key, value);
						return "OK";
					}),
				),
		}) satisfies RedisService["Service"]["client"];
		const redis = makeRedisService({
			client,
			get: (key) => Effect.map(Ref.get(values), (all) => all.get(key) ?? null),
			set: (key, value) => Ref.update(values, (all) => new Map(all).set(key, value)),
		});

		return Layer.mergeAll(
			Layer.succeed(RedisService, redis),
			Layer.succeed(ServerRun, { id: "run-1" }),
			FetchHttpClient.layer,
		);
	}),
);

describe("runtime sandbox host functions", () => {
	layer(runtimeHostLayer)((test) => {
		test.effect(
			"reads persistent completion without claiming and retains its namespace across server runs",
			() =>
				Effect.gen(function* () {
					const host = yield* makeRuntimeSandboxApiFunctions(followAll);
					expect(yield* host.getPersistentValue(input, "completion")).toBeNull();
					expect(yield* host.claimPersistentValue(input, "completion", true, 60)).toEqual({
						claimed: true,
					});
					const restarted = yield* makeRuntimeSandboxApiFunctions(followAll).pipe(
						Effect.provideService(ServerRun, { id: "run-2" }),
					);
					expect(yield* restarted.getPersistentValue(input, "completion")).toBe(true);
					expect(
						yield* restarted.getPersistentValue(
							{
								...input,
								principal: { ...input.principal, scriptId: SandboxScriptId.make("other-script") },
							},
							"completion",
						),
					).toBeNull();
					expect(yield* host.claimPersistentValue(input, "completion", false, 60)).toEqual({
						value: true,
						claimed: false,
					});
				}),
		);
	});
	layer(runtimeHostLayer)((test) => {
		test.effect("round-trips run-scoped cache values", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions(followAll);

				yield* host.setCachedValue(input, " answer ", { value: 42 }, 60);
				expect(yield* host.getCachedValue(input, "answer")).toEqual({ value: 42 });
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		test.effect("claims persistent values only once", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions(followAll);
				const value = { value: { nested: true }, __ryotDurableClaim: "public" };

				expect(yield* host.claimPersistentValue(input, "answer", value, 60)).toEqual({
					claimed: true,
				});
				expect(yield* host.claimPersistentValue(input, "answer", { value: 43 }, 60)).toEqual({
					value,
					claimed: false,
				});
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		test.effect("replays a durable persistent claim as the original successful claim", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions(followAll);
				const durableInput = {
					...input,
					executionId: "workflow-1-host-0",
					workflowExecutionId: "workflow-1",
				};

				expect(yield* host.claimPersistentValue(durableInput, "answer", { value: 42 }, 60)).toEqual(
					{ claimed: true },
				);
				expect(yield* host.claimPersistentValue(durableInput, "answer", { value: 42 }, 60)).toEqual(
					{ claimed: true },
				);
				expect(
					yield* host.claimPersistentValue(
						{
							...durableInput,
							executionId: "workflow-2-host-0",
							workflowExecutionId: "workflow-2",
						},
						"answer",
						{ value: 43 },
						60,
					),
				).toEqual({ claimed: false, value: { value: 42 } });
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		test.effect("validates HTTP calls before execution", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions(followAll);
				const error = yield* host.httpCall(input, "", "https://example.com").pipe(Effect.flip);

				expect(error).toEqual({ message: "httpCall expects a non-empty method string" });
			}),
		);
	});

	layer(runtimeHostLayer)((test) => {
		// Port 1 refuses connections, so the request fails without reaching an application.
		test.effect("marks a failed HTTP request as an uncertain external outcome", () =>
			Effect.gen(function* () {
				const host = yield* makeRuntimeSandboxApiFunctions(followAll);
				const error = yield* host.httpCall(input, "POST", "http://127.0.0.1:1/").pipe(Effect.flip);

				expect(error).toMatchObject({ data: { code: "external-uncertain" } });
			}),
		);
	});

	describe("sandbox_http_redirects_admit_every_matched_hop", () => {
		type Sent = Readonly<{
			url: string;
			method: string;
			body: string | null;
			headers: Readonly<Record<string, string>>;
		}>;

		const redirecting = (routes: Readonly<Record<string, Response | (() => Response)>>) =>
			Effect.gen(function* () {
				const sent = yield* Ref.make<ReadonlyArray<Sent>>([]);
				const client = HttpClient.make((request, url) =>
					Effect.gen(function* () {
						yield* Ref.update(sent, (all) => [
							...all,
							{
								url: url.toString(),
								method: request.method,
								headers: { ...request.headers },
								body:
									request.body._tag === "Uint8Array"
										? new TextDecoder().decode(request.body.body)
										: null,
							},
						]);
						const route = routes[url.toString()];
						const response = typeof route === "function" ? route() : route;
						return HttpClientResponse.fromWeb(request, response ?? new Response("ok"));
					}),
				);
				return { client, sent: Ref.get(sent) };
			});

		layer(runtimeHostLayer)((test) => {
			test.effect("rewrites methods and strips bodies and cross-origin credentials", () =>
				Effect.gen(function* () {
					const { sent, client } = yield* redirecting({
						"https://a.test/keep": redirect(307, "/kept"),
						"https://a.test/start": redirect(302, "https://b.test/next"),
						"https://a.test/see-other": redirect(303, "https://a.test/other"),
					});
					const host = yield* hostWith(client);
					const headers = {
						Cookie: "c=1",
						"X-Trace": "t",
						"Content-Type": "text/plain",
						Authorization: "Bearer secret",
						"Proxy-Authorization": "Basic p",
					};

					yield* host.httpCall(input, "POST", "https://a.test/start", { headers, body: "payload" });
					yield* host.httpCall(input, "POST", "https://a.test/keep", { headers, body: "payload" });
					yield* host.httpCall(input, "PUT", "https://a.test/see-other", {
						headers,
						body: "payload",
					});

					const requests = yield* sent;
					expect(requests.map(({ url, method }) => `${method} ${url}`)).toEqual([
						"POST https://a.test/start",
						"GET https://b.test/next",
						"POST https://a.test/keep",
						"POST https://a.test/kept",
						"PUT https://a.test/see-other",
						"GET https://a.test/other",
					]);
					expect(requests[1]?.body).toBeNull();
					expect(requests[1]?.headers).toMatchObject({ "x-trace": "t" });
					for (const removed of [
						"cookie",
						"authorization",
						"content-type",
						"proxy-authorization",
					]) {
						expect(requests[1]?.headers).not.toHaveProperty(removed);
					}
					expect(requests[3]).toMatchObject({
						body: "payload",
						headers: { cookie: "c=1", authorization: "Bearer secret" },
					});
					expect(requests[5]?.body).toBeNull();
					expect(requests[5]?.headers).toMatchObject({
						cookie: "c=1",
						authorization: "Bearer secret",
					});
					expect(requests[5]?.headers).not.toHaveProperty("content-type");
				}),
			);
		});

		layer(runtimeHostLayer)((test) => {
			test.effect("refuses a script-set Host header before any request", () =>
				Effect.gen(function* () {
					const { sent, client } = yield* redirecting({});
					const host = yield* hostWith(client);
					const error = yield* host
						.httpCall(input, "GET", "https://203.0.113.7/", { headers: { hOsT: "provider.test" } })
						.pipe(Effect.flip);

					expect(error).toEqual({ message: "httpCall may not set the Host header" });
					expect(yield* sent).toEqual([]);
				}),
			);
		});

		layer(runtimeHostLayer)((test) => {
			test.effect("denies a non-HTTP destination before any request", () =>
				Effect.gen(function* () {
					const { sent, client } = yield* redirecting({});
					const host = yield* hostWith(withEgressPolicy(client));
					const error = yield* host.httpCall(input, "GET", "file:///etc/passwd").pipe(Effect.flip);

					expect(error).toEqual({
						data: { code: "destination-denied" },
						message: "httpCall destination is not allowed",
					});
					expect(yield* sent).toEqual([]);
				}),
			);
		});

		layer(runtimeHostLayer)((test) => {
			test.effect("refuses a redirect to a non-HTTP location without requesting it", () =>
				Effect.gen(function* () {
					const { sent, client } = yield* redirecting({
						"https://open.test/start": redirect(302, "file:///etc/passwd"),
					});
					const host = yield* hostWith(withEgressPolicy(client));
					const error = yield* host
						.httpCall(input, "GET", "https://open.test/start")
						.pipe(Effect.flip);

					expect(error).toEqual({ message: "httpCall redirect location is not an HTTP(S) URL" });
					expect((yield* sent).map(({ url }) => url)).toEqual(["https://open.test/start"]);
				}),
			);
		});

		layer(runtimeHostLayer)((test) => {
			test.effect("fails an inline redirect to a matched origin before requesting it", () =>
				Effect.gen(function* () {
					const { sent, client } = yield* redirecting({
						"https://open.test/start": redirect(302, "https://provider.test/data"),
					});
					const classified: Array<string> = [];
					const host = yield* hostWith(client, (url) => {
						classified.push(url);
						return Effect.succeed(url.startsWith("https://provider.test") ? "stop" : "follow");
					});
					const error = yield* host
						.httpCall(input, "GET", "https://open.test/start")
						.pipe(Effect.flip);

					expect(error).toEqual({ message: SANDBOX_HTTP_REDIRECT_STOPPED_MESSAGE });
					expect(classified).toEqual(["https://provider.test/data"]);
					expect((yield* sent).map(({ url }) => url)).toEqual(["https://open.test/start"]);
				}),
			);
		});

		layer(runtimeHostLayer)((test) => {
			test.effect("sends nothing to an inline redirect target whose policy lookup fails", () =>
				Effect.gen(function* () {
					const { sent, client } = yield* redirecting({
						"https://open.test/start": redirect(301, "https://provider.test./data"),
					});
					const host = yield* hostWith(
						client,
						sandboxHttpRedirectClassifier(() =>
							Effect.fail(new DbError({ message: "database unavailable" })),
						),
					);
					const error = yield* host
						.httpCall(input, "GET", "https://open.test/start")
						.pipe(Effect.flip);

					expect(error).toEqual({ message: SANDBOX_HTTP_REDIRECT_STOPPED_MESSAGE });
					expect((yield* sent).map(({ url }) => url)).toEqual(["https://open.test/start"]);
				}),
			);
		});

		layer(runtimeHostLayer)((test) => {
			test.effect("follows at most five proven-unmatched redirects", () =>
				Effect.gen(function* () {
					let hops = 0;
					const { sent, client } = yield* redirecting({
						"https://open.test/loop": () => redirect(302, `https://open.test/loop?hop=${++hops}`),
						...Object.fromEntries(
							[1, 2, 3, 4, 5].map((hop) => [
								`https://open.test/loop?hop=${hop}`,
								() => redirect(302, `https://open.test/loop?hop=${hop + 1}`),
							]),
						),
					});
					const host = yield* hostWith(client);
					const error = yield* host
						.httpCall(input, "GET", "https://open.test/loop")
						.pipe(Effect.flip);

					expect(error).toEqual({ message: "httpCall exceeded 5 redirects" });
					expect(yield* sent).toHaveLength(6);
				}),
			);
		});
	});
});
