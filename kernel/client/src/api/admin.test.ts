import { assert, describe, expect, it } from "@effect/vitest";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Effect } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import { makeAdminApi } from "#/api/admin";
import { decodeServerOrigin } from "#/api/origin";
import { FileDownloadError } from "#/modules/downloads/file";

const origin = decodeServerOrigin("https://ryot.example");

describe("admin API", () => {
	it.live("downloads file bytes with the admin header and no credentials in the URL", () =>
		Effect.gen(function* () {
			const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> =
				[];
			const bytes = new Uint8Array([1, 2, 3]);
			const api = makeAdminApi(
				HttpClient.make((request, url) => {
					requests.push({ url: url.toString(), headers: request.headers });
					return Effect.succeed(
						HttpClientResponse.fromWeb(
							request,
							new Response(bytes, { headers: { "content-type": "application/gzip" } }),
						),
					);
				}),
			);
			const blob = yield* api.download(
				origin,
				"admin-secret",
				"god-mode/logs/files/file-id/download",
				"ryot.log.gz",
			);
			assert.isDefined(blob);
			expect(blob.type).toBe("application/gzip");
			expect(new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer()))).toEqual(bytes);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.url).toBe(
				"https://ryot.example/api/god-mode/logs/files/file-id/download",
			);
			expect(requests[0]?.headers).toMatchObject({ "admin-access-token": "admin-secret" });
			expect(requests[0]?.headers).not.toHaveProperty("authorization");
		}),
	);

	it.live("preserves unauthorized and missing-file download failures", () =>
		Effect.gen(function* () {
			for (const status of [401, 404]) {
				const api = makeAdminApi(
					HttpClient.make((request) =>
						Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status }))),
					),
				);
				const error = yield* Effect.flip(
					api.download(origin, "admin-secret", "god-mode/logs/download", "logs.zip"),
				);
				if (status === 401) {
					expect(error.cause).toBeInstanceOf(AuthUnauthorized);
				} else {
					assert.instanceOf(error.cause, FileDownloadError);
					expect(error.cause.status).toBe(404);
				}
			}
		}),
	);

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
