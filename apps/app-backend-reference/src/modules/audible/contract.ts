import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import {
	AudibleRunError,
	AudibleRunNotFound,
	DbError,
	SandboxRunError,
	Unauthorized,
	UploadNotFound,
	ValidationError,
} from "../../lib/errors";
import { AudibleRun, AudibleRunDetail, CreateAudibleRunPayload } from "./schemas";

const runIdParam = HttpApiSchema.param("runId", Schema.String);

export const AudibleGroup = HttpApiGroup.make("audible")
	.add(
		HttpApiEndpoint.get("list", "/audible/runs")
			.addSuccess(Schema.Array(AudibleRun))
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/audible/runs")
			.setPayload(CreateAudibleRunPayload)
			.addSuccess(AudibleRunDetail, { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.addError(UploadNotFound, { status: 404 })
			.addError(ValidationError, { status: 422 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/audible/runs/${runIdParam}`
			.addSuccess(AudibleRunDetail)
			.addError(Unauthorized, { status: 401 })
			.addError(AudibleRunNotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("confirmImport")`/audible/runs/${runIdParam}/confirm-import`
			.addSuccess(AudibleRunDetail)
			.addError(Unauthorized, { status: 401 })
			.addError(AudibleRunNotFound, { status: 404 })
			.addError(ValidationError, { status: 422 })
			.middleware(AuthMiddleware),
	)
	.addError(DbError, { status: 500 })
	.addError(AudibleRunError, { status: 500 })
	.addError(SandboxRunError, { status: 502 })
	.annotate(OpenApi.Description, "Audible integration: query and run audiobook searches");
