import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, Unauthorized } from "../../lib/errors";

export const ListedEntity = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
	image: Schema.optional(Schema.String),
	externalId: Schema.optional(Schema.String),
	populatedAt: Schema.optional(Schema.String),
	sandboxScriptId: Schema.optional(Schema.String),
});

const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	entitySchemaId: Schema.String,
	properties: Schema.Unknown,
	image: Schema.optional(Schema.String),
	externalId: Schema.optional(Schema.String),
	sandboxScriptId: Schema.optional(Schema.String),
});

const ClearUserStateResponse = Schema.Struct({
	entityId: Schema.String,
	deletedEventsCount: Schema.Number,
	deletedRelationshipsCount: Schema.Number,
});

const ImportEntityBody = Schema.Struct({
	scriptId: Schema.String,
	externalId: Schema.String,
	entitySchemaId: Schema.String,
});

const ImportEntityRunResult = Schema.Union(
	Schema.Struct({ status: Schema.Literal("pending") }),
	Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
	Schema.Struct({ status: Schema.Literal("completed"), data: ListedEntity }),
);

const entityIdParam = HttpApiSchema.param("entityId", Schema.String);
const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntitiesGroup = HttpApiGroup.make("entities")
	.add(
		HttpApiEndpoint.post("create", "/entities")
			.setPayload(CreateEntityBody)
			.addSuccess(ListedEntity, { status: 201 })
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/entities/${entityIdParam}`
			.addSuccess(ListedEntity)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("clearUserState")`/entities/${entityIdParam}/user-state`
			.addSuccess(ClearUserStateResponse)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("import", "/entities/import")
			.setPayload(ImportEntityBody)
			.addSuccess(Schema.Struct({ jobId: Schema.String }))
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("getImportResult")`/entities/import/${jobIdParam}`
			.addSuccess(ImportEntityRunResult)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
