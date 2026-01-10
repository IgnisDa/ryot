import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntitySchemaId } from "../../schema/brands";
import { SandboxRunResult } from "../sandbox/schemas";
import {
	CreateEntitySchemaBody,
	ListEntitySchemasBody,
	ListedEntitySchema,
	SearchEntitySchemasBody,
} from "./schemas";

const entitySchemaIdParam = HttpApiSchema.param("entitySchemaId", EntitySchemaId);
const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntitySchemasGroup = HttpApiGroup.make("entitySchemas")
	.annotate(OpenApi.Description, "Manages entity schemas and schema searches.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("list", "/entity-schemas/list")
			.annotate(OpenApi.Description, "Lists entity schemas for the requested scope.")
			.setPayload(ListEntitySchemasBody)
			.addSuccess(Schema.Array(ListedEntitySchema))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("create", "/entity-schemas")
			.annotate(OpenApi.Description, "Creates an entity schema.")
			.setPayload(CreateEntitySchemaBody)
			.addSuccess(ListedEntitySchema, { status: 201 })
			.addError(NotFound, { status: 404 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/entity-schemas/${entitySchemaIdParam}`
			.annotate(OpenApi.Description, "Returns an entity schema by ID.")
			.addSuccess(ListedEntitySchema)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("search", "/entity-schemas/search")
			.annotate(OpenApi.Description, "Starts an entity schema search job.")
			.setPayload(SearchEntitySchemasBody)
			.addSuccess(Schema.Struct({ jobId: Schema.String }))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getSearchResult")`/entity-schemas/search/${jobIdParam}`
			.annotate(OpenApi.Description, "Returns the result of an entity schema search job.")
			.addSuccess(SandboxRunResult)
			.addError(NotFound, { status: 404 }),
	);
