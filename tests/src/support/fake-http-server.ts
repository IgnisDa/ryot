import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Exit, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/unstable/http";

export type FakeHttpServer = {
	url: string;
	stop: () => void;
	requests: Array<{ body: unknown; path: string }>;
};

export async function startFakeHttpServer(
	respond: (url: URL, request: Request) => Response | Promise<Response> = () =>
		Response.json({ ok: true }),
): Promise<FakeHttpServer> {
	const scope = await Effect.runPromise(Scope.make());
	const { requests, url } = await Effect.runPromise(
		Scope.provide(
			Effect.gen(function* () {
				const recorded: FakeHttpServer["requests"] = [];
				const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
				yield* HttpServer.serveEffect(
					HttpEffect.fromWebHandler(async (request) => {
						const reqUrl = new URL(request.url);
						recorded.push({ path: reqUrl.pathname, body: await request.json().catch(() => null) });
						return respond(reqUrl, request);
					}),
				).pipe(Effect.provideService(HttpServer.HttpServer, server));

				const address = server.address;
				if (address._tag === "UnixAddress") {
					return yield* Effect.die("Fake HTTP server unexpectedly bound to a Unix socket");
				}
				return { requests: recorded, url: `http://127.0.0.1:${address.port}` };
			}),
			scope,
		),
	);
	return {
		requests,
		url,
		stop: () => void Effect.runPromise(Scope.close(scope, Exit.void)),
	};
}

export const startFakeHttpServerScoped = (
	respond?: (url: URL, request: Request) => Response | Promise<Response>,
) =>
	Effect.acquireRelease(
		Effect.promise(() => startFakeHttpServer(respond)),
		(server) => Effect.sync(() => server.stop()),
	);
