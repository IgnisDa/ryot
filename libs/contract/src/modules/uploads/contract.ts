import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart, OpenApi } from "@effect/platform";
import { Option, Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { RateLimited, Unauthorized } from "../../errors";
import { UploadBodyLimitMiddleware } from "./middleware";
import { PresignedDownloadResponse, PresignedUploadResponse } from "./schemas";
import {
	TEMPORARY_UPLOAD_MAX_FILE_BYTES,
	TEMPORARY_UPLOAD_MAX_REQUEST_BYTES,
} from "./upload-policy";

export const UploadsGroup = HttpApiGroup.make("uploads")
	.annotate(OpenApi.Description, "Creates upload and download URLs and accepts temporary files")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createPresigned", "/uploads/presigned")
			.setPayload(Schema.Struct({ contentType: Schema.String }))
			.addSuccess(PresignedUploadResponse)
			.annotate(OpenApi.Description, "Creates a presigned URL for uploading a file"),
	)
	.add(
		HttpApiEndpoint.post("createPresignedDownload", "/uploads/presigned/download")
			.setPayload(Schema.Struct({ keys: Schema.Array(Schema.String).pipe(Schema.minItems(1)) }))
			.addSuccess(PresignedDownloadResponse)
			.annotate(OpenApi.Description, "Creates presigned download URLs for stored files"),
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
			.middleware(UploadBodyLimitMiddleware)
			.annotate(OpenApi.Description, "Uploads files to temporary storage"),
	);
