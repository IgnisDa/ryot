import { expect, it } from "@effect/vitest";
import { AuthMiddleware } from "@ryot-app/contract/auth-middleware";
import { OAuthConnectionsGroup } from "@ryot-app/contract/modules/oauth-connections/contract";
import { Effect, Layer, Ref } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";

import { OAuthConnectionsRoutesLive } from "./routes";
import { OAuthConnectionsService } from "./service";

const contract = HttpApi.make("ryot").add(OAuthConnectionsGroup);

it.effect("redirects provider callbacks without caching, referrers, or provider content", () =>
	Effect.gen(function* () {
		const received = yield* Ref.make<ReadonlyArray<unknown>>([]);
		const services = Layer.mergeAll(
			Layer.succeed(AuthMiddleware, Object.create(null)),
			Layer.mock(OAuthConnectionsService)({
				callback: (path, query) =>
					Ref.update(received, (all) => [...all, { path, query }]).pipe(
						Effect.as("http://localhost:3000/settings/oauth-return#connection=c&secret=s"),
					),
			}),
		);
		const routes = HttpApiBuilder.layer(contract).pipe(
			Layer.provide(Layer.mergeAll(OAuthConnectionsRoutesLive, HttpServer.layerServices)),
			Layer.provideMerge(services),
			HttpRouter.provideRequest(services),
		);
		yield* Effect.acquireUseRelease(
			Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
			({ handler }) =>
				Effect.gen(function* () {
					const response = yield* Effect.promise(() =>
						handler(
							new Request(
								"http://server.test/oauth-connections/providers/media/spotify/callback?code=provider-code&state=state-1&error_description=%3Cscript%3E",
							),
						),
					);
					expect(response.status).toBe(302);
					expect(response.headers.get("location")).toBe(
						"http://localhost:3000/settings/oauth-return#connection=c&secret=s",
					);
					expect(response.headers.get("cache-control")).toBe("no-store");
					expect(response.headers.get("referrer-policy")).toBe("no-referrer");
					expect(yield* Effect.promise(() => response.text())).toBe("");
				}),
			({ dispose }) => Effect.promise(dispose),
		);
		expect(yield* Ref.get(received)).toEqual([
			{
				query: { state: "state-1", code: "provider-code" },
				path: { pluginSlug: "media", oauthProviderSlug: "spotify" },
			},
		]);
	}),
);
