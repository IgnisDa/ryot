import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import {
	CreateEntityBody,
	EntityBadRequest,
	EntityNotFound,
	EntityMutationResult,
} from "./schemas";

export const EntitiesGroup = HttpApiGroup.make("entities")
	.annotate(OpenApi.Description, "Create entities.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("create", "/entities", {
			payload: CreateEntityBody,
			success: EntityMutationResult.pipe(HttpApiSchema.status(201)),
			error: [
				EntityBadRequest.pipe(HttpApiSchema.status(400)),
				EntityNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Create an entity."),
	)
	.middleware(AuthMiddleware);
