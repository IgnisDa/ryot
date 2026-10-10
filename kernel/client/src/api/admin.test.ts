import { describe, expect, it } from "@effect/vitest";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Effect } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import { makeAdminApi } from "#/api/admin";
import { decodeServerOrigin } from "#/api/origin";
import { FileDownloadError, type FileDownloadRequest } from "#/modules/downloads/file";

const origin = decodeServerOrigin("https://ryot.example");

describe("admin API", () => {
	it.live("starts a download from its short-lived URL", () =>
		Effect.gen(function* () {
			const downloads: Array<FileDownloadRequest> = [];
			const api = makeAdminApi(
				HttpClient.make(() => Effect.die("not used")),
				{ download: (request) => Effect.sync(() => downloads.push(request)) },
			);
			yield* api.download(
				"https://ryot.example/api/god-mode/logs/download?ticket=short",
				"logs.zip",
			);

			expect(downloads).toEqual([
				{
					fileName: "logs.zip",
					url: "https://ryot.example/api/god-mode/logs/download?ticket=short",
				},
			]);
		}),
	);

	it.live("maps native unauthorized and transport failures", () =>
		Effect.gen(function* () {
			const api = makeAdminApi(
				HttpClient.make(() => Effect.die("not used")),
				{
					download: (request) =>
						Effect.fail(
							request.fileName === "unauthorized.zip"
								? new FileDownloadError({ cause: 401, status: 401 })
								: new FileDownloadError({ cause: "offline" }),
						),
				},
			);
			const unauthorized = yield* Effect.flip(
				api.download("https://download.test/a", "unauthorized.zip"),
			);
			const transport = yield* Effect.flip(api.download("https://download.test/b", "logs.zip"));

			expect(unauthorized.cause).toBeInstanceOf(AuthUnauthorized);
			expect(transport.cause).toBeInstanceOf(FileDownloadError);
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
					{ download: () => Effect.void },
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
				{ download: () => Effect.void },
			);
			const error = yield* Effect.flip(
				api.run(origin, "admin-secret", (client) => client.system.health()),
			);

			expect(error.cause).toBeInstanceOf(HttpClientError.HttpClientError);
			expect(String(error)).not.toContain("admin-secret");
		}),
	);
});
