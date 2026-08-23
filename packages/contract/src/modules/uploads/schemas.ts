import { Schema } from "effect";

export const UploadProvider = Schema.Literals(["local", "s3"]);
export const UploadKind = Schema.Literals(["temporary", "permanent"]);

export const UploadIntentInput = Schema.Struct({
	kind: UploadKind,
	fileName: Schema.String,
	contentType: Schema.String,
});

export const LocalAssetLocator = Schema.Struct({
	key: Schema.String,
	type: Schema.Literal("local"),
});
export type LocalAssetLocator = typeof LocalAssetLocator.Type;

export const S3AssetLocator = Schema.Struct({ key: Schema.String, type: Schema.Literal("s3") });
export type S3AssetLocator = typeof S3AssetLocator.Type;

export const RemoteAssetLocator = Schema.Struct({
	type: Schema.Literal("remote"),
	url: Schema.String,
});
export type RemoteAssetLocator = typeof RemoteAssetLocator.Type;

export const ManagedAssetLocator = Schema.Union([LocalAssetLocator, S3AssetLocator]);
export type ManagedAssetLocator = typeof ManagedAssetLocator.Type;

export const AssetLocator = Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]);
export type AssetLocator = typeof AssetLocator.Type;

export const MANAGED_ASSET_RESOLUTION_MAX_ASSETS = 64;
export const ManagedAssetResolutionBatch = Schema.Array(ManagedAssetLocator).pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(MANAGED_ASSET_RESOLUTION_MAX_ASSETS)),
);

export const UploadIntentResponse = Schema.Struct({
	intentId: Schema.String,
	uploadUrl: Schema.String,
	expiresAt: Schema.String,
	method: Schema.Literal("PUT"),
	headers: Schema.Record(Schema.String, Schema.String),
});
export type UploadIntentResponse = typeof UploadIntentResponse.Type;

export const TemporaryUploadToken = Schema.Struct({
	token: Schema.String,
	expiresAt: Schema.String,
});
export type TemporaryUploadToken = typeof TemporaryUploadToken.Type;

export const CompleteUploadResponse = Schema.Union([ManagedAssetLocator, TemporaryUploadToken]);
export type CompleteUploadResponse = typeof CompleteUploadResponse.Type;

export const DownloadResolutionInput = Schema.Struct({ assets: ManagedAssetResolutionBatch });
export type DownloadResolutionInput = typeof DownloadResolutionInput.Type;

export const DownloadResolutionResponse = Schema.Array(
	Schema.Struct({
		expiresAt: Schema.String,
		asset: ManagedAssetLocator,
		downloadUrl: Schema.String,
	}),
);
export type DownloadResolutionResponse = typeof DownloadResolutionResponse.Type;

export const UploadFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("token-busy") }),
	Schema.Struct({ code: Schema.Literal("token-invalid") }),
	Schema.Struct({ code: Schema.Literal("upload-failed") }),
	Schema.Struct({ code: Schema.Literal("token-forbidden") }),
	Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
	Schema.Struct({ code: Schema.Literal("empty-file-name") }),
	Schema.Struct({ code: Schema.Literal("lifecycle-active") }),
	Schema.Struct({ code: Schema.Literal("token-already-claimed") }),
	Schema.Struct({ code: Schema.Literal("asset-metadata-mismatch") }),
	Schema.Struct({ code: Schema.Literal("invalid-download-target") }),
	Schema.Struct({ code: Schema.Literal("intent-busy"), intentId: Schema.String }),
	Schema.Struct({ code: Schema.Literal("intent-invalid"), intentId: Schema.String }),
	Schema.Struct({ code: Schema.Literal("object-missing"), intentId: Schema.String }),
	Schema.Struct({ code: Schema.Literal("intent-expired"), intentId: Schema.String }),
	Schema.Struct({ code: Schema.Literal("intent-forbidden"), intentId: Schema.String }),
	Schema.Struct({ code: Schema.Literal("intent-provider-mismatch"), intentId: Schema.String }),
	Schema.Struct({ code: Schema.Literal("unsupported-file-type"), contentType: Schema.String }),
	Schema.Struct({ code: Schema.Literal("unsupported-file-extension"), extension: Schema.String }),
	Schema.Struct({
		code: Schema.Literal("asset-metadata-invalid"),
		field: Schema.Literals(["key", "sha256", "size"]),
	}),
	Schema.Struct({
		contentType: Schema.String,
		code: Schema.Literal("asset-content-type-unsupported"),
	}),
	Schema.Struct({
		maxBytes: Schema.Number,
		actualBytes: Schema.NullOr(Schema.Number),
		code: Schema.Literal("upload-too-large"),
	}),
	Schema.Struct({
		expected: Schema.String,
		actual: Schema.NullOr(Schema.String),
		code: Schema.Literal("content-type-mismatch"),
	}),
]);
export type UploadFailureReason = typeof UploadFailureReason.Type;

export class UploadBadRequest extends Schema.TaggedError<UploadBadRequest>()("UploadBadRequest", {
	reason: UploadFailureReason,
}) {}

export class UploadInternalError extends Schema.TaggedError<UploadInternalError>()(
	"UploadInternalError",
	{ reason: Schema.Struct({ code: Schema.Literal("unexpected-error") }) },
) {}
