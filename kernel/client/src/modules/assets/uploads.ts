import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	ManagedAssetLocator,
	TemporaryUploadToken,
	UploadBadRequest,
	UploadInternalError,
} from "@ryot-app/contract/modules/assets/schemas";
import type {
	PluginUploadBridgeErrorReason,
	PluginUploadOutcome,
	PluginUploadRequest,
	PluginUploadResult,
} from "@ryot-app/plugin-client-contract";
import { Context, Data, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";

export class UploadsError extends Data.TaggedError("UploadsError")<{
	readonly reason: PluginUploadBridgeErrorReason;
}> {}

const isDeclaredUploadFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, UploadBadRequest, UploadInternalError]),
);

const isManagedAssetLocator = Schema.is(ManagedAssetLocator);
const isTemporaryUploadToken = Schema.is(TemporaryUploadToken);

export const classifyUploadFailure = (error: unknown): PluginUploadBridgeErrorReason => {
	if (error instanceof UploadsError) {
		return error.reason;
	}
	return error instanceof AuthenticatedApiError && isDeclaredUploadFailure(error.cause)
		? "operation-failed"
		: "transport";
};

const failWith = (reason: PluginUploadBridgeErrorReason) => new UploadsError({ reason });

type TemporaryUploadRequest = Extract<PluginUploadRequest, { readonly action: "temporary" }>;
type PermanentUploadRequest = Extract<PluginUploadRequest, { readonly action: "permanent" }>;

export class Uploads extends Context.Service<Uploads>()("Uploads", {
	make: Effect.gen(function* () {
		const api = yield* UploadsApi;

		const transferFile = Effect.fn("Uploads.transferFile")(function* (
			scope: ApiScope,
			request: TemporaryUploadRequest | PermanentUploadRequest,
		) {
			const intent = yield* api
				.createIntent(scope, {
					payload: {
						kind: request.action,
						fileName: request.fileName,
						contentType: request.contentType,
					},
				})
				.pipe(Effect.mapError((error) => failWith(classifyUploadFailure(error))));
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
				.pipe(Effect.mapError((error) => failWith(classifyUploadFailure(error))));
			return completion;
		});

		const uploadTemporary = Effect.fn("Uploads.uploadTemporary")(function* (
			scope: ApiScope,
			request: TemporaryUploadRequest,
		) {
			const completion = yield* transferFile(scope, request);
			return isTemporaryUploadToken(completion)
				? ({ token: completion, action: "temporary" } as const)
				: yield* failWith("malformed-result");
		});

		const uploadPermanent = Effect.fn("Uploads.uploadPermanent")(function* (
			scope: ApiScope,
			request: PermanentUploadRequest,
		) {
			const completion = yield* transferFile(scope, request);
			return isManagedAssetLocator(completion)
				? ({ asset: completion, action: "permanent" } as const)
				: yield* failWith("malformed-result");
		});

		const upload = (
			scope: ApiScope,
			request: PluginUploadRequest,
		): Effect.Effect<PluginUploadResult, UploadsError> => {
			if (request.action === "temporary") {
				return uploadTemporary(scope, request);
			}
			return uploadPermanent(scope, request);
		};

		const outcome = (
			scope: ApiScope,
			request: PluginUploadRequest,
		): Effect.Effect<PluginUploadOutcome> => {
			return upload(scope, request).pipe(
				Effect.match({
					onSuccess: (result) => ({ ...result, outcome: "success" }) as const,
					onFailure: (error) => ({ outcome: "failure", reason: error.reason }) as const,
				}),
			);
		};

		return { upload, outcome, uploadTemporary };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
