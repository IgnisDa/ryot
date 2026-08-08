import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	OAuthEndpointError,
	OAuthTransportError,
	postOAuthForm,
	postOAuthFormRequest,
} from "#/modules/auth/oauth-endpoint";

const origin = decodeServerOrigin("https://ryot.example");
const body = new URLSearchParams({ grant_type: "refresh_token" });

const respondWith =
	(value: unknown, status: number): typeof fetch =>
	() =>
		Promise.resolve(
			new Response(typeof value === "string" ? value : JSON.stringify(value), {
				status,
				headers: { "content-type": "application/json" },
			}),
		);

describe("OAuth endpoint", () => {
	it.effect("surfaces the OAuth error code from a rejected request", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				postOAuthFormRequest(
					respondWith({ error: "invalid_grant", error_description: "expired" }, 400),
					origin,
					"/api/auth/oauth2/token",
					body,
				),
			);

			expect(failure).toBeInstanceOf(OAuthEndpointError);
			expect(failure).toMatchObject({ code: "invalid_grant", status: 400, description: "expired" });
		}),
	);

	it.effect("falls back to a server error when the body carries no OAuth error", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				postOAuthFormRequest(respondWith({ unexpected: true }, 500), origin, "/token", body),
			);

			expect(failure).toMatchObject({ code: "server_error", status: 500 });
		}),
	);

	it.effect("falls back to a server error when the body is not JSON", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				postOAuthFormRequest(respondWith("<html>gateway</html>", 502), origin, "/token", body),
			);

			expect(failure).toMatchObject({ code: "server_error", status: 502 });
		}),
	);

	it.effect("reports a transport failure when the request never reaches the server", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				postOAuthFormRequest(
					() => Promise.reject(new TypeError("network down")),
					origin,
					"/token",
					body,
				),
			);

			expect(failure).toBeInstanceOf(OAuthTransportError);
		}),
	);

	it.effect("decodes a successful response with the supplied schema", () =>
		Effect.gen(function* () {
			expect(
				yield* postOAuthForm(
					respondWith({ access_token: "access-1" }, 200),
					origin,
					"/token",
					body,
					Schema.Struct({ access_token: Schema.String }),
				),
			).toEqual({ access_token: "access-1" });
		}),
	);

	it.effect("fails when a successful response does not match the schema", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				postOAuthForm(
					respondWith({ access_token: 1 }, 200),
					origin,
					"/token",
					body,
					Schema.Struct({ access_token: Schema.String }),
				),
			);

			expect(failure._tag).toBe("SchemaError");
		}),
	);
});
