import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http";

import { AuthenticatedApi, makeAuthenticatedApi } from "#/api/authenticated";
import { ImportsApi, importRunFailuresFileName } from "#/api/imports";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import type { OAuthTokenService } from "#/modules/auth/token-service";
import { FileDownloads, type FileDownloadRequest } from "#/modules/downloads/file";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const runId = "run_1";
const accessToken = "test.eyJzdWIiOiJ1c2VyLTEifQ.signature";

const tokens: OAuthTokenService["Service"] = {
	clear: () => Effect.void,
	logout: () => Effect.succeed(null),
	userInfo: () => Effect.succeed(null),
	accessToken: () => Effect.succeed(accessToken),
	rejectAuthorization: () => Effect.die("not used"),
	completeAuthorization: () => Effect.die("not used"),
};

const runDownload = Effect.flatMap(ImportsApi, (api) => api.downloadFailures(scope, runId));

describe("imports API", () => {
	it.live("requests an authenticated ticket and starts a browser download with it", () => {
		const seen: Array<{
			readonly url: string;
			readonly request: HttpClientRequest.HttpClientRequest;
		}> = [];
		const downloads: Array<FileDownloadRequest> = [];
		const http = HttpClient.make((request, url) => {
			seen.push({ request, url: url.toString() });
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					Response.json({
						url: `/imports/runs/${runId}/failures/download?ticket=short-lived-ticket`,
					}),
				),
			);
		});
		const runtime = ManagedRuntime.make(
			ImportsApi.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(AuthenticatedApi, makeAuthenticatedApi(tokens, http)),
						Layer.succeed(FileDownloads, {
							download: (request) => Effect.sync(() => downloads.push(request)),
						}),
					),
				),
			),
		);
		return Effect.promise(() => runtime.runPromise(runDownload)).pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					expect(seen).toHaveLength(1);
					expect(seen[0]?.url).toBe(
						"https://ryot.example/api/imports/runs/run_1/failures/download-url",
					);
					expect(seen[0]?.request.method).toBe("POST");
					expect(seen[0]?.request.headers).toMatchObject({
						authorization: `Bearer ${accessToken}`,
					});
					expect(downloads).toEqual([
						{
							fileName: importRunFailuresFileName(runId),
							url: "https://ryot.example/api/imports/runs/run_1/failures/download?ticket=short-lived-ticket",
						},
					]);
				}),
			),
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		);
	});
});
