import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Exit, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/unstable/http";

type ScopedFakeHttpServer = {
	url: string;
	requests: Array<{ body: unknown; path: string; headers: Record<string, string> }>;
};

export type FakeHttpServer = ScopedFakeHttpServer & { stop: () => Promise<void> };

const closeFakeHttpServer = (scope: Scope.Closeable) =>
	Effect.runPromise(Scope.close(scope, Exit.void));

export const startFakeHttpServerScoped = (
	respond: (url: URL, request: Request) => Response | Promise<Response> = () =>
		Response.json({ ok: true }),
) =>
	Effect.gen(function* () {
		const scope = yield* Effect.acquireRelease(Scope.make(), (serverScope) =>
			Scope.close(serverScope, Exit.void),
		);
		return yield* Scope.provide(
			Effect.gen(function* () {
				const recorded: ScopedFakeHttpServer["requests"] = [];
				const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
				yield* HttpServer.serveEffect(
					HttpEffect.fromWebHandler((request) => {
						const reqUrl = new URL(request.url);
						return request
							.json()
							.catch(() => null)
							.then((body) => {
								recorded.push({
									body,
									path: reqUrl.pathname,
									headers: Object.fromEntries(request.headers),
								});
								return respond(reqUrl, request);
							});
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
export const startFakeHttpServer = (
	respond?: (url: URL, request: Request) => Response | Promise<Response>,
) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const server = yield* Scope.provide(startFakeHttpServerScoped(respond), scope).pipe(
			Effect.onError(() => Scope.close(scope, Exit.void)),
		);
		return { ...server, stop: () => closeFakeHttpServer(scope) };
	});
