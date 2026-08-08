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
					HttpServerResponse.text(`api:${request.url}`, {
						headers: request.url.startsWith("/plugins/artifacts/")
							? { "access-control-allow-origin": "*" }
							: undefined,
					}),
				);
				const RootLive = HttpRouter.use((router) =>
					registerRootRoutes(
						router,
						inner,
						(request) => Promise.resolve(new Response(`auth:${new URL(request.url).pathname}`)),
						(pathname) => Effect.succeed(HttpServerResponse.text(`static:${pathname}`)),
						"http://frontend.test",
						["http://client.test"],
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
					expect(preflight.headers.get("access-control-allow-origin")).toBe("http://client.test");
					expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
					expect(preflight.headers.get("access-control-allow-headers")).toBe("b3,traceparent");

					const artifact = yield* Effect.promise(() =>
						handler(
							new Request("http://server.test/api/plugins/artifacts/hash/plugin.js", {
								headers: { Origin: "null" },
							}),
						),
					);
					expect(artifact.headers.get("access-control-allow-origin")).toBe("*");
					expect(artifact.headers.has("access-control-allow-credentials")).toBe(false);
				}),
			({ dispose }) => Effect.promise(dispose),
		),
);
