import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { redactPluginArtifactSessionUrl, registerRootRoutes } from "./server";

it("redacts artifact session tokens without changing other request URLs", () => {
	const token = "a".repeat(43);
	expect(
		redactPluginArtifactSessionUrl(`/api/plugin-artifact-sessions/${token}/plugin.js?q=1`),
	).toBe("/api/plugin-artifact-sessions/<redacted>/plugin.js?q=1");
	expect(redactPluginArtifactSessionUrl(`/api/plugins/${token}`)).toBe(`/api/plugins/${token}`);
});

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

					const artifact = yield* Effect.promise(() =>
						handler(
							new Request(
								`http://server.test/api/plugin-artifact-sessions/${"a".repeat(43)}/plugin.js`,
								{ headers: { Origin: "null" } },
							),
						),
					);
					expect(artifact.headers.get("access-control-allow-origin")).toBe("*");
					expect(artifact.headers.has("access-control-allow-credentials")).toBe(false);
					expect(artifact.headers.get("cache-control")).toBe("no-store");
					expect(artifact.headers.get("referrer-policy")).toBe("no-referrer");
					expect(artifact.headers.get("x-content-type-options")).toBe("nosniff");

					const artifactPreflight = yield* Effect.promise(() =>
						handler(
							new Request(
								`http://server.test/api/plugin-artifact-sessions/${"a".repeat(43)}/plugin.js`,
								{
									method: "OPTIONS",
									headers: { Origin: "null", "Access-Control-Request-Method": "GET" },
								},
							),
						),
					);
					expect(artifactPreflight.status).toBe(204);
					expect(artifactPreflight.headers.get("access-control-allow-origin")).toBe("*");
					expect(artifactPreflight.headers.has("access-control-allow-credentials")).toBe(false);
				}),
			({ dispose }) => Effect.promise(dispose),
		),
);

it.effect("preserves the auth handler's own expose-headers on a sign-in response", () =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const RootLive = HttpRouter.use((router) =>
				registerRootRoutes(
					router,
					Effect.succeed(HttpServerResponse.empty({ status: 404 })),
					() =>
						Promise.resolve(
							new Response("signed-in", {
								headers: {
									"set-auth-token": "session-token",
									"access-control-expose-headers": "set-auth-token",
								},
							}),
						),
					(pathname) => Effect.succeed(HttpServerResponse.text(`static:${pathname}`)),
					"http://frontend.test",
				),
			);
			return HttpRouter.toWebHandler(RootLive, { disableLogger: true });
		}),
		({ handler }) =>
			Effect.gen(function* () {
				const response = yield* Effect.promise(() =>
					handler(
						new Request("http://server.test/api/auth/sign-in/email", {
							method: "POST",
							headers: { origin: "https://localhost" },
						}),
					),
				);
				expect(response.headers.get("access-control-allow-origin")).toBe("*");
				expect(response.headers.get("set-auth-token")).toBe("session-token");
				expect(response.headers.get("access-control-expose-headers")).toBe("set-auth-token");
			}),
		({ dispose }) => Effect.promise(dispose),
	),
);
