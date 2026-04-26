import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "~/lib/auth";
import {
	BadRequest,
	Conflict,
	NotFound,
	NotImplemented,
	RateLimited,
	Unauthorized,
} from "~/lib/errors";
import { SandboxRunResult } from "~/modules/sandbox/contract";

import {
	CreateEntitySchemaBody,
	ListEntitySchemasBody,
	ListedEntitySchema,
	SearchEntitySchemasBody,
} from "./schemas";

const entitySchemaIdParam = HttpApiSchema.param("entitySchemaId", Schema.String);
const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntitySchemasGroup = HttpApiGroup.make("entitySchemas")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.post("list", "/entity-schemas/list")
			.setPayload(ListEntitySchemasBody)
			.addSuccess(Schema.Array(ListedEntitySchema))
			.addError(NotFound, { status: 404 })
			.addError(BadRequest, { status: 400 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/entity-schemas")
			.setPayload(CreateEntitySchemaBody)
			.addSuccess(ListedEntitySchema, { status: 201 })
			.addError(NotFound, { status: 404 })
			.addError(BadRequest, { status: 400 })
			.addError(Conflict, { status: 409 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/entity-schemas/${entitySchemaIdParam}`
			.addSuccess(ListedEntitySchema)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("search", "/entity-schemas/search")
			.setPayload(SearchEntitySchemasBody)
			.addSuccess(Schema.Struct({ jobId: Schema.String }))
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("getSearchResult")`/entity-schemas/search/${jobIdParam}`
			.addSuccess(SandboxRunResult)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
