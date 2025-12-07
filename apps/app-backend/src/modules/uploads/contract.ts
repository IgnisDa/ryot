import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { InternalError, NotImplemented, Unauthorized } from "../../lib/errors";

const CreatePresignedUploadBody = Schema.Struct({ contentType: Schema.String });

const PresignedUploadResponse = Schema.Struct({
	key: Schema.String,
	uploadUrl: Schema.String,
});

const CreatePresignedDownloadBody = Schema.Struct({ keys: Schema.Array(Schema.String) });

const PresignedDownloadResponse = Schema.Array(
	Schema.Struct({ key: Schema.String, downloadUrl: Schema.String }),
);

export const UploadsGroup = HttpApiGroup.make("uploads")
	.add(
		HttpApiEndpoint.post("createPresigned", "/uploads/presigned")
			.setPayload(CreatePresignedUploadBody)
			.addSuccess(PresignedUploadResponse)
			.addError(InternalError, { status: 500 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("createPresignedDownload", "/uploads/presigned/download")
			.setPayload(CreatePresignedDownloadBody)
			.addSuccess(PresignedDownloadResponse)
			.addError(InternalError, { status: 500 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("uploadTemporary", "/uploads/temporary")
			.setPayload(HttpApiSchema.Multipart(Schema.Struct({ files: Multipart.FilesSchema })))
			.addSuccess(Schema.Array(Schema.String), { status: 201 })
			.addError(Multipart.MultipartError, { status: 413 })
			.addError(InternalError, { status: 500 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
