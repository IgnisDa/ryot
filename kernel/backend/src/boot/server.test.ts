import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { registerRootRoutes } from "./server";

it.effect(
	"routes API, docs, auth, webhooks, and static fallback without replacing native requests",
	() =>
		Effect.acquireUseRelease(
			Effect.sync(() => {
				const inner = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
					HttpServerResponse.text(`api:${request.url}`),
				);
				const RootLive = HttpRouter.use((router) =>
					registerRootRoutes(
						router,
						inner,
						(request) => Promise.resolve(new Response(`auth:${new URL(request.url).pathname}`)),
						(pathname) => Effect.succeed(HttpServerResponse.text(`static:${pathname}`)),
						"http://frontend.test",
					),
				);
				return HttpRouter.toWebHandler(RootLive, { disableLogger: true });
			}),
			({ handler }) =>
				Effect.gen(function* () {
					const cases = [
						["/api/system/ping?value=1", "api:/system/ping?value=1"],
						["/api/docs", "api:/docs"],
						["/api/auth/session", "auth:/api/auth/session"],
						["/_i/provider?token=redacted", "api:/webhooks/integrations/provider?token=redacted"],
						["/saved/views", "static:/saved/views"],
					] as const;
					for (const [path, expected] of cases) {
						const response = yield* Effect.promise(() =>
							handler(new Request(`http://server.test${path}`)),
						);
						expect(yield* Effect.promise(() => response.text())).toBe(expected);
					}
					const preflight = yield* Effect.promise(() =>
						handler(
							new Request("http://server.test/api/system/health", {
								method: "OPTIONS",
								headers: {
									Origin: "http://client.test",
									"Access-Control-Request-Method": "GET",
									"Access-Control-Request-Headers": "b3,traceparent",
								},
							}),
						),
					);
					expect(preflight.status).toBe(204);
					expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
					expect(preflight.headers.has("access-control-allow-credentials")).toBe(false);
					expect(preflight.headers.get("access-control-allow-headers")).toBe("b3,traceparent");

					for (const origin of [
						"null",
						"https://localhost",
						"capacitor://localhost",
						"http://localhost:3005",
					]) {
						const response = yield* Effect.promise(() =>
							handler(new Request("http://server.test/api/system/health", { headers: { origin } })),
						);
						expect([origin, response.headers.get("access-control-allow-origin")]).toEqual([
							origin,
							"*",
						]);
						expect([origin, response.headers.has("access-control-allow-credentials")]).toEqual([
							origin,
							false,
						]);
					}
				}),
			({ dispose }) => Effect.promise(dispose),
		),
);
