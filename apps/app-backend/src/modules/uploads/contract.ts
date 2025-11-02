import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart } from "@effect/platform";
import { Option, Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { RateLimited, Unauthorized } from "#lib/errors";

import { UploadBodyLimitMiddleware } from "./middleware";
import { PresignedDownloadResponse, PresignedUploadResponse } from "./schemas";
import {
	TEMPORARY_UPLOAD_MAX_FILE_BYTES,
	TEMPORARY_UPLOAD_MAX_REQUEST_BYTES,
} from "./upload-policy";

export const UploadsGroup = HttpApiGroup.make("uploads")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createPresigned", "/uploads/presigned")
			.setPayload(Schema.Struct({ contentType: Schema.String }))
			.addSuccess(PresignedUploadResponse),
	)
	.add(
		HttpApiEndpoint.post("createPresignedDownload", "/uploads/presigned/download")
			.setPayload(Schema.Struct({ keys: Schema.Array(Schema.String).pipe(Schema.minItems(1)) }))
			.addSuccess(PresignedDownloadResponse),
	)
	.add(
		HttpApiEndpoint.post("uploadTemporary", "/uploads/temporary")
			.setPayload(
				HttpApiSchema.Multipart(Schema.Struct({ "files[]": Multipart.FilesSchema }), {
					fieldMimeTypes: [],
					maxFileSize: Option.some(TEMPORARY_UPLOAD_MAX_FILE_BYTES),
					maxTotalSize: Option.some(TEMPORARY_UPLOAD_MAX_REQUEST_BYTES),
				}),
			)
			.addSuccess(Schema.Array(Schema.String), { status: 201 })
			.addError(Multipart.MultipartError, { status: 413 })
			.middleware(UploadBodyLimitMiddleware),
	);
