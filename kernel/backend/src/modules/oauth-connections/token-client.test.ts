import { expect, it } from "@effect/vitest";
import { Context, Effect, Fiber, Option, Ref } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { OAUTH_TOKEN_RESPONSE_MAX_BYTES, OAuthTokenClient } from "./token-client";

const provider = {
	scopes: [],
	slug: "account",
	name: "Account",
	pkce: "S256" as const,
	clientIdConfigKey: "clientId",
	clientSecretConfigKey: "clientSecret",
	tokenUrl: "https://accounts.example.test/token",
	tokenEndpointAuth: "client_secret_post" as const,
	authorizeUrl: "https://accounts.example.test/authorize",
};

const credentials = { clientId: "client-1", clientSecret: "client-secret-1" };

const refresh = { refreshToken: "refresh-1", grantType: "refresh_token" as const };

const requestReason = (respond: () => Effect.Effect<Response>) =>
	Effect.gen(function* () {
		const redirects = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
		const client = yield* OAuthTokenClient.make.pipe(
			Effect.provideService(
				HttpClient.HttpClient,
				HttpClient.make((request, _url, _signal, fiber) =>
					Ref.update(redirects, (all) => [
						...all,
						Option.getOrUndefined(Context.getOption(fiber.context, FetchHttpClient.RequestInit))
							?.redirect,
					]).pipe(
						Effect.andThen(respond()),
						Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
					),
				),
			),
		);
		const result = yield* client.requestToken(provider, credentials, refresh).pipe(
			Effect.flip,
			Effect.map((error) => error.reason),
		);
		return { result, redirects: yield* Ref.get(redirects) };
	});

it.effect("never follows redirects and reports only kernel failure reasons", () =>
	Effect.gen(function* () {
		const redirected = yield* requestReason(() =>
			Effect.succeed(
				new Response(null, {
					status: 302,
					headers: { location: "https://attacker.example.test/collect" },
				}),
			),
		);
		expect(redirected).toEqual({ result: "failed", redirects: ["manual"] });

		const rejected = yield* requestReason(() =>
			Effect.succeed(
				Response.json(
					{ error: "invalid_grant", error_description: "refresh-1 was revoked" },
					{ status: 400 },
				),
			),
		);
		expect(rejected.result).toBe("invalid-grant");

		const oversized = yield* requestReason(() =>
			Effect.succeed(new Response("x".repeat(OAUTH_TOKEN_RESPONSE_MAX_BYTES + 1), { status: 200 })),
		);
		expect(oversized.result).toBe("failed");

		const notBearer = yield* requestReason(() =>
			Effect.succeed(Response.json({ token_type: "mac", access_token: "access-1" })),
		);
		expect(notBearer.result).toBe("failed");
	}),
);

it.effect("times out token requests", () =>
	Effect.gen(function* () {
		const pending = yield* Effect.forkChild(requestReason(() => Effect.never));
		while (pending.pollUnsafe() === undefined) {
			yield* TestClock.adjust("11 seconds");
			yield* TestClock.withLive(Effect.sleep("5 millis"));
		}
		expect((yield* Fiber.join(pending)).result).toBe("failed");
	}),
);
