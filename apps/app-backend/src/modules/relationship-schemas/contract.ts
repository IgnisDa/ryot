import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, Conflict, NotFound, RateLimited, Unauthorized } from "#lib/errors";

import {
	CreateRelationshipSchemaBody,
	ListRelationshipSchemasBody,
	RelationshipSchemaScope,
} from "./schemas";

export const RelationshipSchemasGroup = HttpApiGroup.make("relationshipSchemas")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("list", "/relationship-schemas/list")
			.setPayload(ListRelationshipSchemasBody)
			.addSuccess(Schema.Array(RelationshipSchemaScope))
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("create", "/relationship-schemas")
			.setPayload(CreateRelationshipSchemaBody)
			.addSuccess(RelationshipSchemaScope, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(Conflict, { status: 409 })
			.addError(NotFound, { status: 404 }),
	);
