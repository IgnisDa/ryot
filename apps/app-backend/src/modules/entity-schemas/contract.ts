import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AppSchema } from "~/lib/schema";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";
import { SandboxRunResult } from "../sandbox/contract";

export const ListedEntitySchema = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	trackerId: Schema.String,
	isBuiltin: Schema.Boolean,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	providers: Schema.Array(Schema.Struct({ name: Schema.String, scriptId: Schema.String })),
});

const ListEntitySchemasBody = Schema.Struct({
	trackerId: Schema.optional(Schema.String),
	slugs: Schema.optional(Schema.Array(Schema.String)),
});

const CreateEntitySchemaBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	trackerId: Schema.String,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	slug: Schema.optional(Schema.String),
});

const SearchEntitySchemasBody = Schema.Struct({
	scriptId: Schema.String,
	context: Schema.optional(Schema.Unknown),
});

const entitySchemaIdParam = HttpApiSchema.param("entitySchemaId", Schema.String);
const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntitySchemasGroup = HttpApiGroup.make("entity-schemas")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.post("list", "/entity-schemas/list")
			.setPayload(ListEntitySchemasBody)
			.addSuccess(Schema.Array(ListedEntitySchema))
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/entity-schemas")
			.setPayload(CreateEntitySchemaBody)
			.addSuccess(ListedEntitySchema, { status: 201 })
			.addError(NotFound, { status: 404 })
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
