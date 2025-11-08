import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth";
import { BadRequest, NotFound, NotImplemented, RateLimited, Unauthorized } from "#lib/errors";

import {
	ClearUserStateResponse,
	CreateEntityBody,
	ImportEntityBody,
	ImportEntityRunResult,
	ListedEntity,
} from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", Schema.String);
const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntitiesGroup = HttpApiGroup.make("entities")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/entities")
			.setPayload(CreateEntityBody)
			.addSuccess(ListedEntity, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/entities/${entityIdParam}`
			.addSuccess(ListedEntity)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("clearUserState")`/entities/${entityIdParam}/user-state`
			.addSuccess(ClearUserStateResponse)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("import", "/entities/import")
			.setPayload(ImportEntityBody)
			.addSuccess(Schema.Struct({ jobId: Schema.String }))
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getImportResult")`/entities/import/${jobIdParam}`
			.addSuccess(ImportEntityRunResult)
			.addError(NotFound, { status: 404 }),
	)
	.addError(NotImplemented, { status: 501 });
