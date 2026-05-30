import { Schema } from "effect";

export const PresignedUploadResponse = Schema.Struct({
	key: Schema.String,
	uploadUrl: Schema.String,
});
export type PresignedUploadResponse = typeof PresignedUploadResponse.Type;

export const PresignedDownloadResponse = Schema.Array(
	Schema.Struct({ key: Schema.String, downloadUrl: Schema.String }),
);
export type PresignedDownloadResponse = typeof PresignedDownloadResponse.Type;
