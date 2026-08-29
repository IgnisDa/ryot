import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Exit, Scope } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

type ScopedFakeHttpServer = {
	url: string;
	requests: Array<{ body: unknown; path: string; headers: Record<string, string> }>;
};

export type FakeHttpServer = ScopedFakeHttpServer & { stop: () => Promise<void> };

const closeFakeHttpServer = (scope: Scope.Closeable) =>
	Effect.runPromise(Scope.close(scope, Exit.void));

type Respond = (url: URL, request: Request) => Response | Effect.Effect<Response>;

export const startFakeHttpServerScoped = (respond: Respond = () => Response.json({ ok: true })) =>
	Effect.gen(function* () {
		const scope = yield* Effect.acquireRelease(Scope.make(), (serverScope) =>
			Scope.close(serverScope, Exit.void),
		);
		return yield* Scope.provide(
			Effect.gen(function* () {
				const recorded: ScopedFakeHttpServer["requests"] = [];
				const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
				yield* HttpServer.serveEffect(
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.toWeb(
							yield* HttpServerRequest.HttpServerRequest,
						);
						const reqUrl = new URL(request.url);
						const body = yield* Effect.tryPromise(() => request.json()).pipe(
							Effect.orElseSucceed(() => null),
						);
						recorded.push({
							body,
							path: reqUrl.pathname,
							headers: Object.fromEntries(request.headers),
						});
						const response = respond(reqUrl, request);
						return HttpServerResponse.fromWeb(
							Effect.isEffect(response) ? yield* response : response,
						);
					}),
				).pipe(Effect.provideService(HttpServer.HttpServer, server));

				const address = server.address;
				if (address._tag === "UnixPathAddress") {
					return yield* Effect.die("Fake HTTP server unexpectedly bound to a Unix socket");
				}
				return { requests: recorded, url: `http://127.0.0.1:${address.port}` };
			}),
			scope,
		);
	});

// Vitest hooks cannot receive the per-test Scope provided by it.live.
export const startFakeHttpServer = (respond?: Respond) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const server = yield* Scope.provide(startFakeHttpServerScoped(respond), scope).pipe(
			Effect.onError(() => Scope.close(scope, Exit.void)),
		);
		return { ...server, stop: () => closeFakeHttpServer(scope) };
	});
