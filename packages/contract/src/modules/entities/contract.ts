import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { CreateEntityBody, ListedEntity } from "./schemas";

export const EntitiesGroup = HttpApiGroup.make("entities")
	.annotate(OpenApi.Description, "Create entities.")
	.add(
		HttpApiEndpoint.post("create", "/entities", {
			payload: CreateEntityBody,
			success: ListedEntity.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Create an entity."),
	)
	.middleware(AuthMiddleware);
