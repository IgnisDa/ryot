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
import { Context, Data, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
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

const failWith = (reason: PluginUploadBridgeErrorReason) => new TemporaryUploadError({ reason });

export class TemporaryUploads extends Context.Service<TemporaryUploads>()("TemporaryUploads", {
	make: Effect.gen(function* () {
		const api = yield* UploadsApi;

		// `completeIntent` may resolve to a managed asset locator, so the token is narrowed, not assumed.
		const upload = Effect.fn("temporaryUpload")(function* (
			scope: ApiScope,
			request: PluginUploadRequest,
		) {
			const intent = yield* api
				.createIntent(scope, {
					payload: {
						kind: "temporary",
						fileName: request.fileName,
						contentType: request.contentType,
					},
				})
				.pipe(Effect.mapError((error) => failWith(classifyTemporaryUploadFailure(error))));
			yield* api
				.putBytes(scope, {
					source: request.source,
					uploadUrl: intent.uploadUrl,
					headers: { ...intent.headers },
					contentType: request.contentType,
				})
				.pipe(
					Effect.mapError((error) =>
						failWith(
							error instanceof AuthenticatedApiError && typeof error.cause === "number"
								? "operation-failed"
								: "transport",
						),
					),
				);
			const completion = yield* api
				.completeIntent(scope, { params: { intentId: intent.intentId } })
				.pipe(Effect.mapError((error) => failWith(classifyTemporaryUploadFailure(error))));
			return isTemporaryUploadToken(completion) ? completion : yield* failWith("malformed-result");
		});

		const outcome = (
			scope: ApiScope,
			request: PluginUploadRequest,
		): Effect.Effect<PluginUploadOutcome> =>
			upload(scope, request).pipe(
				Effect.match({
					onSuccess: (token) => ({ token, outcome: "success" }) as const,
					onFailure: (error) => ({ outcome: "failure", reason: error.reason }) as const,
				}),
			);

		return { upload, outcome };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
