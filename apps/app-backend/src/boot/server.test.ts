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
				}),
			({ dispose }) => Effect.promise(dispose),
		),
);
