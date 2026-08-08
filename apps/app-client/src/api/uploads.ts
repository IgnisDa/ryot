import { TemporaryUploadToken } from "@ryot/contract/modules/uploads/schemas";
import { Cause, Effect, Schema } from "effect";

import { appClient } from "./client";
import { resolveApiUrl } from "./origin";
import type { ApiScope } from "./request-key";
import { TransportEnvironment } from "./request-layer";
import { transportEnvironmentLive } from "./transport";

export type TemporaryUploadRequest = {
	readonly fileName: string;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly contentType: string;
};

export type TemporaryUploadOutcome =
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "uploaded"; readonly token: string };

const TEMPORARY_UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

const putUploadedBytes = (input: {
	readonly url: string;
	readonly method: "PUT";
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly headers: Readonly<Record<string, string>>;
}) =>
	Effect.gen(function* () {
		const { expoFetch } = yield* TransportEnvironment;
		const response = yield* Effect.tryPromise(() =>
			expoFetch(input.url, {
				body: input.bytes,
				method: input.method,
				headers: { ...input.headers },
			}),
		);
		if (!response.ok) {
			return yield* Effect.fail(new Error(`Upload target responded with ${response.status}`));
		}
		return response;
	});

export const uploadTemporaryFile = (scope: ApiScope, request: TemporaryUploadRequest) =>
	Effect.gen(function* () {
		const client = yield* appClient(scope).request;
		const intent = yield* client.uploads.createIntent({
			payload: {
				kind: "temporary",
				provider: "local",
				fileName: request.fileName,
				contentType: request.contentType,
			},
		});
		yield* putUploadedBytes({
			bytes: request.bytes,
			method: intent.method,
			headers: intent.headers,
			url: resolveApiUrl(scope.serverUrl, intent.uploadUrl),
		});
		const completion = yield* client.uploads.completeIntent({
			params: { intentId: intent.intentId },
		});
		const decoded = yield* Schema.decodeUnknownEffect(TemporaryUploadToken)(completion);
		return { kind: "uploaded", token: decoded.token } as const;
	}).pipe(
		Effect.provide(transportEnvironmentLive),
		Effect.catchCause((cause) =>
			Effect.logWarning("temporary upload failed", Cause.pretty(cause)).pipe(
				Effect.as({ kind: "failed", message: TEMPORARY_UPLOAD_FAILURE_MESSAGE } as const),
			),
		),
	);

export const temporaryFileUploadOperation =
	(scope: ApiScope) => (request: TemporaryUploadRequest) =>
		Effect.runPromise(uploadTemporaryFile(scope, request));
