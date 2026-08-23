import { Effect, Layer, ManagedRuntime } from "effect";
import {
	HttpClient,
	HttpClientError,
	HttpClientResponse,
	type HttpClientRequest,
} from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { UploadsApi, type UploadByteTransfer } from "#/api/uploads";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

const transfer: UploadByteTransfer = {
	contentType: "text/csv",
	uploadUrl: "/uploads/local/intent-1",
	source: new Blob(["id,title"], { type: "text/csv" }),
	headers: { "content-type": "text/csv", "x-upload-signature": "signed" },
};

type StubResponse = Effect.Effect<
	HttpClientResponse.HttpClientResponse,
	HttpClientError.HttpClientError
>;

const stubAuth = Layer.succeed(AuthenticatedApi, {
	run: () => Effect.die("not used"),
	authorization: () => Effect.die("not used"),
});

const stubHttp = (respond: (request: HttpClientRequest.HttpClientRequest) => StubResponse) => {
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
				return respond(request);
			}),
		),
	};
};

const accepted = (request: HttpClientRequest.HttpClientRequest) =>
	Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })));

const runPutBytes = (input: UploadByteTransfer) =>
	Effect.flatMap(UploadsApi, (api) => api.putBytes(scope, input));

describe("uploads API", () => {
	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-based test callback and its framework assertions.
	it("resolves a relative upload URL and sends the blob bytes with its headers", async () => {
		const http = stubHttp(accepted);
		const runtime = ManagedRuntime.make(
			UploadsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		try {
			await runtime.runPromise(runPutBytes(transfer));

			expect(http.seen).toHaveLength(1);
			const sent = http.seen[0];
			expect(sent.url).toBe("https://ryot.example/api/uploads/local/intent-1");
			expect(sent.request.method).toBe("PUT");
			expect(sent.request.headers).toMatchObject({
				"content-type": "text/csv",
				"x-upload-signature": "signed",
			});
			const body = sent.request.body;
			expect(body._tag).toBe("Uint8Array");
			if (body._tag === "Uint8Array") {
				expect(body.contentType).toBe("text/csv");
				expect(Array.from(body.body)).toEqual(Array.from(new TextEncoder().encode("id,title")));
			}
		} finally {
			await runtime.dispose();
		}
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-based test callback and its framework assertions.
	it("leaves absolute presigned upload URLs untouched", async () => {
		const http = stubHttp(accepted);
		const runtime = ManagedRuntime.make(
			UploadsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		try {
			await runtime.runPromise(
				runPutBytes({ ...transfer, uploadUrl: "https://s3.example/presigned?part=1" }),
			);

			expect(http.seen[0].url).toBe("https://s3.example/presigned?part=1");
		} finally {
			await runtime.dispose();
		}
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-based test callback and its framework assertions.
	it("maps a rejected transfer status to its numeric cause", async () => {
		const http = stubHttp((request) =>
			Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 403 }))),
		);
		const runtime = ManagedRuntime.make(
			UploadsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		try {
			const error = await runtime.runPromise(Effect.flip(runPutBytes(transfer)));

			expect(error).toBeInstanceOf(AuthenticatedApiError);
			expect(error.cause).toBe(403);
		} finally {
			await runtime.dispose();
		}
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-based test callback and its framework assertions.
	it("wraps a transport failure without a status", async () => {
		const http = stubHttp((request) =>
			Effect.fail(
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({ request, description: "offline" }),
				}),
			),
		);
		const runtime = ManagedRuntime.make(
			UploadsApi.layer.pipe(Layer.provide(Layer.mergeAll(stubAuth, http.layer))),
		);
		try {
			const error = await runtime.runPromise(Effect.flip(runPutBytes(transfer)));

			expect(error).toBeInstanceOf(AuthenticatedApiError);
			expect(error.cause).toBeInstanceOf(HttpClientError.HttpClientError);
		} finally {
			await runtime.dispose();
		}
	});
});
