import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { CreateEntityBody, EntityBadRequest, EntityNotFound, ListedEntity } from "./schemas";

export const EntitiesGroup = HttpApiGroup.make("entities")
	.annotate(OpenApi.Description, "Create entities.")
	.add(
		HttpApiEndpoint.post("create", "/entities", {
			payload: CreateEntityBody,
			success: ListedEntity.pipe(HttpApiSchema.status(201)),
			error: [
				EntityBadRequest.pipe(HttpApiSchema.status(400)),
				EntityNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Create an entity."),
	)
	.middleware(AuthMiddleware);
