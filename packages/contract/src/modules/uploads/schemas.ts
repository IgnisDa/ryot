import { Schema } from "effect";

export const UploadProvider = Schema.Literals(["local", "s3"]);
export const UploadKind = Schema.Literals(["temporary", "permanent"]);

export const UploadIntentInput = Schema.Struct({
	kind: UploadKind,
	fileName: Schema.String,
	provider: UploadProvider,
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

export const DownloadResolutionInput = Schema.Struct({
	assets: Schema.Array(ManagedAssetLocator).pipe(Schema.check(Schema.isMinLength(1))),
});
export type DownloadResolutionInput = typeof DownloadResolutionInput.Type;

export const DownloadResolutionResponse = Schema.Array(
	Schema.Struct({ asset: ManagedAssetLocator, downloadUrl: Schema.String }),
);
export type DownloadResolutionResponse = typeof DownloadResolutionResponse.Type;
