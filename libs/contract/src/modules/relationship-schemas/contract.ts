import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import {
	CreateRelationshipSchemaBody,
	ListRelationshipSchemasBody,
	RelationshipSchemaScope,
} from "./schemas";

export const RelationshipSchemasGroup = HttpApiGroup.make("relationshipSchemas")
	.annotate(OpenApi.Description, "Manages relationship schemas.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("list", "/relationship-schemas/list")
			.annotate(OpenApi.Description, "Lists relationship schemas for the requested scope.")
			.setPayload(ListRelationshipSchemasBody)
			.addSuccess(Schema.Array(RelationshipSchemaScope))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("create", "/relationship-schemas")
			.annotate(OpenApi.Description, "Creates a relationship schema.")
			.setPayload(CreateRelationshipSchemaBody)
			.addSuccess(RelationshipSchemaScope, { status: 201 })
			.addError(Conflict, { status: 409 })
			.addError(NotFound, { status: 404 }),
	);
