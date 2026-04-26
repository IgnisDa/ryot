import { expect, it } from "@effect/vitest";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { makeAuthMiddleware } from "./service";

it.effect("passes complete request headers to the auth service", () => {
	let capturedCookie: string | null = null;
	const middleware = makeAuthMiddleware({
		currentUser: (headers) => {
			capturedCookie = headers.get("cookie");
			return Effect.succeed({
				image: null,
				name: "User",
				email: "user@example.com",
				id: UserId.make("user-1"),
				preferences: { allowNsfw: false, language: null, disableIntegrations: false },
			});
		},
	});
	const routes = HttpRouter.add(
		"GET",
		"/",
		middleware(
			Effect.gen(function* () {
				yield* CurrentUser;
				return HttpServerResponse.empty();
			}),
		),
	);

	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
		({ handler }) =>
			Effect.promise(() =>
				handler(
					new Request("http://localhost/", {
						headers: { cookie: "future-auth-cookie=value" },
					}),
				),
			).pipe(
				Effect.tap((response) =>
					Effect.sync(() => {
						expect(response.status).toBe(204);
						expect(capturedCookie).toBe("future-auth-cookie=value");
					}),
				),
			),
		({ dispose }) => Effect.promise(dispose),
	);
});
