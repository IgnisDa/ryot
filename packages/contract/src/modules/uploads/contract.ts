import { Schema } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest } from "../../errors";
import {
	MultipartInternalErrorSchema,
	MultipartLimitErrorSchema,
	MultipartParseErrorSchema,
	UploadBodyLimitMiddleware,
} from "./middleware";
import {
	CompleteUploadResponse,
	PresignedDownloadResponse,
	PresignedUploadResponse,
	UploadIntentInput,
	UploadIntentResponse,
} from "./schemas";
import {
	TEMPORARY_UPLOAD_MAX_FILE_BYTES,
	TEMPORARY_UPLOAD_MAX_REQUEST_BYTES,
} from "./upload-policy";

export const UploadsGroup = HttpApiGroup.make("uploads")
	.annotate(OpenApi.Description, "Creates upload and download URLs and accepts temporary files")
	.add(
		HttpApiEndpoint.post("createIntent", "/uploads/intents", {
			payload: UploadIntentInput,
			success: UploadIntentResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a provider-neutral upload intent"),
	)
	.add(
		HttpApiEndpoint.post("completeIntent", "/uploads/intents/:intentId/complete", {
			success: CompleteUploadResponse,
			params: { intentId: Schema.String },
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Completes an upload intent"),
	)
	.add(
		HttpApiEndpoint.post("createPresigned", "/uploads/presigned", {
			payload: Schema.Struct({ contentType: Schema.String }),
			success: PresignedUploadResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a presigned URL for uploading a file"),
	)
	.add(
		HttpApiEndpoint.post("createPresignedDownload", "/uploads/presigned/download", {
			payload: Schema.Struct({
				keys: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
			}),
			success: PresignedDownloadResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates presigned download URLs for stored files"),
	)
	.add(
		HttpApiEndpoint.post("uploadTemporary", "/uploads/temporary", {
			payload: Schema.Struct({ "files[]": Multipart.FilesSchema }).pipe(
				HttpApiSchema.asMultipart({
					fieldMimeTypes: [],
					maxFileSize: TEMPORARY_UPLOAD_MAX_FILE_BYTES,
					maxTotalSize: TEMPORARY_UPLOAD_MAX_REQUEST_BYTES,
				}),
			),
			success: Schema.Array(Schema.String).pipe(HttpApiSchema.status(201)),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				MultipartLimitErrorSchema,
				MultipartParseErrorSchema,
				MultipartInternalErrorSchema,
			],
		})
			.middleware(UploadBodyLimitMiddleware)
			.annotate(OpenApi.Description, "Uploads files to temporary storage"),
	)
	.middleware(AuthMiddleware);

export const LocalUploadsGroup = HttpApiGroup.make("localUploads")
	.annotate(OpenApi.Description, "Accepts bytes for signed local upload targets")
	.add(
		HttpApiEndpoint.put("put", "/uploads/local/:intentId", {
			params: { intentId: Schema.String },
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Uploads bytes to a signed local upload target"),
	);
