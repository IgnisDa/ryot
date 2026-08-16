import { TemporaryUploadToken } from "@ryot/contract/modules/uploads/schemas";
import { Cause, Effect, Schema } from "effect";

import { appClient } from "../client";
import { resolveApiUrl } from "../origin";
import type { ApiScope } from "../request-key";
import { TransportEnvironment } from "../request-layer";
import { transportEnvironmentLive } from "../transport";
import { temporaryUploadIntentPayload } from "./upload-intent";
import { putUploadSource, type UploadFileSource } from "./upload-source";

export type TemporaryUploadRequest = {
	readonly fileName: string;
	readonly contentType: string;
	readonly source: UploadFileSource;
};

const TEMPORARY_UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

export const uploadTemporaryFile = (scope: ApiScope, request: TemporaryUploadRequest) =>
	Effect.gen(function* () {
		const client = yield* appClient(scope).request;
		const { expoFetch } = yield* TransportEnvironment;
		const intent = yield* client.uploads.createIntent({
			payload: temporaryUploadIntentPayload(request),
		});
		yield* Effect.tryPromise(() =>
			putUploadSource({
				fetch: expoFetch,
				method: intent.method,
				source: request.source,
				headers: intent.headers,
				contentType: request.contentType,
				url: resolveApiUrl(scope.serverUrl, intent.uploadUrl),
			}),
		);
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
