import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { CreateEntityBody, EntityDetail, ListedEntity } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", EntityId);

export const EntitiesGroup = HttpApiGroup.make("entities")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/entities")
			.setPayload(CreateEntityBody)
			.addSuccess(ListedEntity, { status: 201 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/entities/${entityIdParam}`
			.addSuccess(EntityDetail)
			.addError(NotFound, { status: 404 }),
	);
