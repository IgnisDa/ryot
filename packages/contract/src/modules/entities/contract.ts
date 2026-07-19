import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { EntityId } from "../../schema/brands";
import { CreateEntityBody, EntityDetail, ListedEntity } from "./schemas";

export const EntitiesGroup = HttpApiGroup.make("entities")
	.annotate(OpenApi.Description, "Create and retrieve entities.")
	.add(
		HttpApiEndpoint.post("create", "/entities", {
			payload: CreateEntityBody,
			success: ListedEntity.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Create an entity."),
	)
	.add(
		HttpApiEndpoint.get("get", "/entities/:entityId", {
			params: { entityId: EntityId },
			success: EntityDetail,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Retrieve an entity by ID."),
	)
	.middleware(AuthMiddleware);
