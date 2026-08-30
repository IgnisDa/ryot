import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import { makeAdminApi } from "#/api/admin";
import { decodeServerOrigin } from "#/api/origin";

const origin = decodeServerOrigin("https://ryot.example");

describe("admin API", () => {
	it.effect(
		"runs a typed contract program at the server API with only the admin token header",
		() =>
			Effect.gen(function* () {
				const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> =
					[];
				const api = makeAdminApi(
					HttpClient.make((request, url) => {
						requests.push({ url: url.toString(), headers: request.headers });
						return Effect.succeed(
							HttpClientResponse.fromWeb(
								request,
								new Response(JSON.stringify({ status: "healthy" }), {
									headers: { "content-type": "application/json" },
								}),
							),
						);
					}),
				);

				expect(yield* api.run(origin, "admin-secret", (client) => client.system.health())).toEqual({
					status: "healthy",
				});
				expect(requests).toHaveLength(1);
				expect(requests[0]?.url).toBe("https://ryot.example/api/system/health");
				expect(requests[0]?.headers).toMatchObject({ "admin-access-token": "admin-secret" });
				expect(requests[0]?.headers).not.toHaveProperty("authorization");
			}),
	);

	it.effect("wraps contract failures without exposing the token", () =>
		Effect.gen(function* () {
			const api = makeAdminApi(
				HttpClient.make((request) =>
					Effect.fail(
						new HttpClientError.HttpClientError({
							reason: new HttpClientError.TransportError({ request, description: "offline" }),
						}),
					),
				),
			);
			const error = yield* Effect.flip(
				api.run(origin, "admin-secret", (client) => client.system.health()),
			);

			expect(error.cause).toBeInstanceOf(HttpClientError.HttpClientError);
			expect(String(error)).not.toContain("admin-secret");
		}),
	);
});
