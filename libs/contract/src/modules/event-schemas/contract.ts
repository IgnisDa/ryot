import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntitySchemaId } from "../../schema/brands";
import { CreateEventSchemaBody, ListedEventSchema } from "./schemas";

export const EventSchemasGroup = HttpApiGroup.make("eventSchemas")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/event-schemas")
			.setUrlParams(Schema.Struct({ entitySchemaId: EntitySchemaId }))
			.addSuccess(Schema.Array(ListedEventSchema))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("create", "/event-schemas")
			.setPayload(CreateEventSchemaBody)
			.addSuccess(ListedEventSchema, { status: 201 })
			.addError(Conflict, { status: 409 })
			.addError(NotFound, { status: 404 }),
	);
