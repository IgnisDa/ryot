import type {
	PluginUploadBridgeErrorReason,
	PluginUploadOutcome,
	PluginUploadRequest,
} from "@ryot-app/client-plugin-contract";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	TemporaryUploadToken,
	UploadBadRequest,
	UploadInternalError,
} from "@ryot-app/contract/modules/uploads/schemas";
import { Data, Effect, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";

export class TemporaryUploadError extends Data.TaggedError("TemporaryUploadError")<{
	readonly reason: PluginUploadBridgeErrorReason;
}> {}

const isDeclaredUploadFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, UploadBadRequest, UploadInternalError]),
);

const isTemporaryUploadToken = Schema.is(TemporaryUploadToken);

export const classifyTemporaryUploadFailure = (error: unknown): PluginUploadBridgeErrorReason => {
	if (error instanceof TemporaryUploadError) {
		return error.reason;
	}
	return error instanceof AuthenticatedApiError && isDeclaredUploadFailure(error.cause)
		? "operation-failed"
		: "transport";
};

// `completeIntent` may resolve to a managed asset locator, so the token is narrowed, not assumed.
export const temporaryUpload = Effect.fn("temporaryUpload")(function* (
	scope: ApiScope,
	request: PluginUploadRequest,
) {
	const api = yield* UploadsApi;
	const failWith = (reason: PluginUploadBridgeErrorReason) => new TemporaryUploadError({ reason });
	const intent = yield* api
		.createIntent(scope, {
			payload: { kind: "temporary", fileName: request.fileName, contentType: request.contentType },
		})
		.pipe(Effect.mapError((error) => failWith(classifyTemporaryUploadFailure(error))));
	const response = yield* Effect.tryPromise({
		catch: () => failWith("transport"),
		try: (signal) =>
			fetch(resolveApiUrl(scope.serverUrl, intent.uploadUrl), {
				signal,
				body: request.source,
				method: intent.method,
				headers: { ...intent.headers },
			}),
	});
	if (!response.ok) {
		return yield* failWith("operation-failed");
	}
	const completion = yield* api
		.completeIntent(scope, { params: { intentId: intent.intentId } })
		.pipe(Effect.mapError((error) => failWith(classifyTemporaryUploadFailure(error))));
	return isTemporaryUploadToken(completion) ? completion : yield* failWith("malformed-result");
});

export const temporaryUploadOutcome = (
	scope: ApiScope,
	request: PluginUploadRequest,
): Effect.Effect<PluginUploadOutcome, never, UploadsApi> =>
	temporaryUpload(scope, request).pipe(
		Effect.match({
			onSuccess: (token) => ({ outcome: "success", token }) as const,
			onFailure: (error) => ({ outcome: "failure", reason: error.reason }) as const,
		}),
	);
