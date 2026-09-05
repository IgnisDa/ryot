import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import {
	CreateRelationshipBody,
	RelationshipBadRequest,
	RelationshipNotFound,
	RelationshipMutationResult,
} from "./schemas";

export const RelationshipsGroup = HttpApiGroup.make("relationships")
	.annotate(OpenApi.Description, "Manage relationships between entities.")
	.add(
		HttpApiEndpoint.post("create", "/relationships", {
			payload: CreateRelationshipBody,
			success: RelationshipMutationResult.pipe(HttpApiSchema.status(201)),
			error: [
				RelationshipBadRequest.pipe(HttpApiSchema.status(400)),
				RelationshipNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Create a relationship between entities."),
	)
	.middleware(AuthMiddleware);
