import { describe, expect, it } from "@effect/vitest";
import { BackupRunId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http";

import { AuthenticatedApi, makeAuthenticatedApi } from "#/api/authenticated";
import { BackupsApi, backupArchiveFileName } from "#/api/backups";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import type { OAuthTokenService } from "#/modules/auth/token-service";
import { FileDownloads, type FileDownloadRequest } from "#/modules/downloads/file";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const runId = BackupRunId.make("backup_1");

const tokens: OAuthTokenService["Service"] = {
	clear: () => Effect.void,
	logout: () => Effect.succeed(null),
	userInfo: () => Effect.succeed(null),
	accessToken: () => Effect.succeed("token-1"),
	rejectAuthorization: () => Effect.die("not used"),
	completeAuthorization: () => Effect.die("not used"),
};

const runDownload = Effect.flatMap(BackupsApi, (api) => api.downloadArchive(scope, runId));

describe("backups API", () => {
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
					Response.json({ url: "/backups/runs/backup_1/download?ticket=short-lived-ticket" }),
				),
			);
		});
		const runtime = ManagedRuntime.make(
			BackupsApi.layer.pipe(
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
					expect(seen[0]?.url).toBe("https://ryot.example/api/backups/runs/backup_1/download-url");
					expect(seen[0]?.request.headers).toMatchObject({ authorization: "Bearer token-1" });
					expect(downloads).toEqual([
						{
							fileName: backupArchiveFileName(runId),
							url: "https://ryot.example/api/backups/runs/backup_1/download?ticket=short-lived-ticket",
						},
					]);
				}),
			),
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		);
	});
});
