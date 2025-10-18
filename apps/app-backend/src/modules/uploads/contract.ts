import {
	HttpApiEndpoint,
	HttpApiError,
	HttpApiGroup,
	HttpApiSchema,
	Multipart,
} from "@effect/platform";
import { Option, Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, RateLimited, Unauthorized } from "#lib/errors";

import { TEMPORARY_UPLOAD_MAX_FILE_BYTES, TEMPORARY_UPLOAD_MAX_REQUEST_BYTES } from "./shared";
import { PresignedDownloadResponse, PresignedUploadResponse } from "./schemas";

export const UploadsGroup = HttpApiGroup.make("uploads")
	.addError(HttpApiError.HttpApiDecodeError, { status: 400 })
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createPresigned", "/uploads/presigned")
			.setPayload(Schema.Struct({ contentType: Schema.String }))
			.addSuccess(PresignedUploadResponse)
			.addError(BadRequest, { status: 400 }),
	)
	.add(
		HttpApiEndpoint.post("createPresignedDownload", "/uploads/presigned/download")
			.setPayload(Schema.Struct({ keys: Schema.Array(Schema.String).pipe(Schema.minItems(1)) }))
			.addSuccess(PresignedDownloadResponse)
			.addError(BadRequest, { status: 400 }),
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
			.addError(BadRequest, { status: 400 }),
	);
