import { BunHttpServer } from "@effect/platform-bun";
import { Effect } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

import { acquireInChildScope, makeTestResourceScope } from "./resource-scope";

export type FakeHttpServer = ScopedFakeHttpServer & { stop: () => Promise<void> };

type Respond = (url: URL, request: Request) => Response | Effect.Effect<Response>;

type ScopedFakeHttpServer = {
	url: string;
	requests: Array<{ path: string; body: unknown; headers: Record<string, string> }>;
};

export const startFakeHttpServerScoped = (
	respond: Respond = () => Response.json({ ok: true }),
	hostname = "127.0.0.1",
) =>
	Effect.gen(function* () {
		const recorded: ScopedFakeHttpServer["requests"] = [];
		const server = yield* BunHttpServer.make({ port: 0, hostname });
		yield* HttpServer.serveEffect(
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest);
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
				return HttpServerResponse.fromWeb(Effect.isEffect(response) ? yield* response : response);
			}),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));

		const address = server.address;
		if (address._tag === "UnixPathAddress") {
			return yield* Effect.die("Fake HTTP server unexpectedly bound to a Unix socket");
		}
		const host = hostname.includes(":") ? `[${hostname}]` : hostname;
		return { requests: recorded, url: `http://${host}:${address.port}` };
	}).pipe(acquireInChildScope);

// Vitest hooks cannot receive the per-test Scope provided by it.live.
export const startFakeHttpServer = (respond?: Respond) =>
	Effect.gen(function* () {
		const resources = makeTestResourceScope();
		const server = yield* resources.run(startFakeHttpServerScoped(respond));
		const context = yield* Effect.context();
		return { ...server, stop: () => Effect.runPromiseWith(context)(resources.close) };
	});
