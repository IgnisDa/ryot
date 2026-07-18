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

export const UploadIntentResponse = Schema.Struct({
	intentId: Schema.String,
	uploadUrl: Schema.String,
	expiresAt: Schema.String,
	method: Schema.Literal("PUT"),
	headers: Schema.Record(Schema.String, Schema.String),
});
export type UploadIntentResponse = typeof UploadIntentResponse.Type;

export const CompleteUploadResponse = LocalAssetLocator;
export type CompleteUploadResponse = typeof CompleteUploadResponse.Type;

export const PresignedUploadResponse = Schema.Struct({
	key: Schema.String,
	uploadUrl: Schema.String,
});
export type PresignedUploadResponse = typeof PresignedUploadResponse.Type;

export const PresignedDownloadResponse = Schema.Array(
	Schema.Struct({ key: Schema.String, downloadUrl: Schema.String }),
);
export type PresignedDownloadResponse = typeof PresignedDownloadResponse.Type;
