import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { CreateEntityBody, EntityDetail, ListedEntity } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", EntityId);

export const EntitiesGroup = HttpApiGroup.make("entities")
	.annotate(OpenApi.Description, "Create and retrieve entities.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/entities")
			.annotate(OpenApi.Description, "Create an entity.")
			.setPayload(CreateEntityBody)
			.addSuccess(ListedEntity, { status: 201 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/entities/${entityIdParam}`
			.annotate(OpenApi.Description, "Retrieve an entity by ID.")
			.addSuccess(EntityDetail)
			.addError(NotFound, { status: 404 }),
	);
