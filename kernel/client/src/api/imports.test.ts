import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { ImportsApi, importRunFailuresFileName } from "#/api/imports";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const runId = "run_1";
const reportBytes = new TextEncoder().encode('{"runId":"run_1","failures":[]}');

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

const runDownload = Effect.flatMap(ImportsApi, (api) => api.downloadFailures(scope, runId));

describe("imports API", () => {
	it.live("sends the bearer header to the resolved failure download URL", () => {
		const http = stubHttp(
			() =>
				new Response(reportBytes, {
					headers: { "content-type": "application/json; charset=utf-8" },
				}),
		);
		const runtime = ManagedRuntime.make(
			ImportsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		return Effect.gen(function* () {
			const blob = yield* Effect.promise(() => runtime.runPromise(runDownload));

			expect(http.seen).toHaveLength(1);
			expect(http.seen[0].url).toBe(
				"https://ryot.example/api/imports/runs/run_1/failures/download",
			);
			expect(http.seen[0].request.method).toBe("GET");
			expect(http.seen[0].request.headers).toMatchObject({ authorization: "Bearer token-1" });
			expect(importRunFailuresFileName(runId)).toBe("ryot-import-failures-run_1.json");
			expect(blob).toBeInstanceOf(Blob);
			assert.isDefined(blob);
			expect(blob.type).toBe("application/json; charset=utf-8");
			expect(new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer()))).toEqual(reportBytes);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("maps a rejected download status to its numeric cause", () => {
		const http = stubHttp(() => new Response(null, { status: 404 }));
		const runtime = ManagedRuntime.make(
			ImportsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		return Effect.gen(function* () {
			const error = yield* Effect.promise(() => runtime.runPromise(Effect.flip(runDownload)));

			expect(error).toBeInstanceOf(AuthenticatedApiError);
			expect(error.cause).toBe(404);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
