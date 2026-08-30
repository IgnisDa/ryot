import { BackupRunId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { BackupsApi } from "#/api/backups";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const runId = BackupRunId.make("backup_1");
const archiveBytes = new Uint8Array([80, 75, 3, 4]);

const stubAuth = Layer.succeed(AuthenticatedApi, {
	run: () => Effect.die("not used"),
	authorization: () => Effect.succeed({ Authorization: "Bearer token-1" }),
});

const stubHttp = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) => {
	const seen: Array<{
		readonly url: string;
		readonly request: HttpClientRequest.HttpClientRequest;
	}> = [];
	return {
		seen,
		layer: Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) => {
				seen.push({ request, url: url.toString() });
				return Effect.succeed(HttpClientResponse.fromWeb(request, respond(request)));
			}),
		),
	};
};

const runDownload = Effect.flatMap(BackupsApi, (api) => api.downloadArchive(scope, runId));

describe("backups API", () => {
	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-based test callback and its framework assertions.
	it("sends the bearer header to the resolved download URL and returns the archive bytes", async () => {
		const http = stubHttp(
			() => new Response(archiveBytes, { headers: { "content-type": "application/zip" } }),
		);
		const runtime = ManagedRuntime.make(
			BackupsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		try {
			const blob = await runtime.runPromise(runDownload);

			expect(http.seen).toHaveLength(1);
			expect(http.seen[0].url).toBe("https://ryot.example/api/backups/runs/backup_1/download");
			expect(http.seen[0].request.method).toBe("GET");
			expect(http.seen[0].request.headers).toMatchObject({ authorization: "Bearer token-1" });
			expect(blob).toBeInstanceOf(Blob);
			expect(blob.type).toBe("application/zip");
			expect(new Uint8Array(await blob.arrayBuffer())).toEqual(archiveBytes);
		} finally {
			await runtime.dispose();
		}
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-based test callback and its framework assertions.
	it("maps a rejected download status to its numeric cause", async () => {
		const http = stubHttp(() => new Response(null, { status: 404 }));
		const runtime = ManagedRuntime.make(
			BackupsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		try {
			const error = await runtime.runPromise(Effect.flip(runDownload));

			expect(error).toBeInstanceOf(AuthenticatedApiError);
			expect(error.cause).toBe(404);
		} finally {
			await runtime.dispose();
		}
	});
});
