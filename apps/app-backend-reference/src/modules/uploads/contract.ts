import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { DbError, Unauthorized, ValidationError } from "../../lib/errors";
import { UploadedFile } from "./schemas";

export const UploadsGroup = HttpApiGroup.make("uploads")
	.add(
		HttpApiEndpoint.post("uploadTemporary", "/uploads/temporary")
			.setPayload(HttpApiSchema.Multipart(Schema.Struct({ files: Multipart.FilesSchema })))
			.addSuccess(Schema.Array(UploadedFile), { status: 201 })
			.addError(Multipart.MultipartError, { status: 413 })
			.addError(Unauthorized, { status: 401 })
			.addError(ValidationError, { status: 422 })
			.addError(DbError, { status: 500 })
			.middleware(AuthMiddleware),
	)
	.annotate(OpenApi.Description, "Upload temporary files for background processing");
