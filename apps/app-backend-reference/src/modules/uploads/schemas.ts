import { Schema } from "effect";

export const UploadedFile = Schema.Struct({
	id: Schema.String,
	size: Schema.Number,
	fileName: Schema.String,
	contentType: Schema.String,
	createdAt: Schema.String,
});

export type UploadedFile = typeof UploadedFile.Type;
