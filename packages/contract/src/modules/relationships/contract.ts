import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { CreateRelationshipBody, RelationshipScope } from "./schemas";

export const RelationshipsGroup = HttpApiGroup.make("relationships")
	.annotate(OpenApi.Description, "Manage relationships between entities.")
	.add(
		HttpApiEndpoint.post("create", "/relationships", {
			payload: CreateRelationshipBody,
			success: RelationshipScope.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Create a relationship between entities."),
	)
	.middleware(AuthMiddleware);
