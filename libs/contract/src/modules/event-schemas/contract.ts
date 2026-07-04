import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntitySchemaId } from "../../schema/brands";
import { CreateEventSchemaBody, ListedEventSchema } from "./schemas";

export const EventSchemasGroup = HttpApiGroup.make("eventSchemas")
	.annotate(OpenApi.Description, "List and create event schemas.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/event-schemas")
			.annotate(OpenApi.Description, "List event schemas for an entity schema.")
			.setUrlParams(Schema.Struct({ entitySchemaId: EntitySchemaId }))
			.addSuccess(Schema.Array(ListedEventSchema))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("create", "/event-schemas")
			.annotate(OpenApi.Description, "Create an event schema.")
			.setPayload(CreateEventSchemaBody)
			.addSuccess(ListedEventSchema, { status: 201 })
			.addError(Conflict, { status: 409 })
			.addError(NotFound, { status: 404 }),
	);
