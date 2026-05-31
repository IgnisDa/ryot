import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { BadRequest, Conflict, NotFound, RateLimited, Unauthorized } from "../../lib/errors";
import { CreateEventSchemaBody, ListedEventSchema } from "./schemas";

export const EventSchemasGroup = HttpApiGroup.make("event-schemas")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/event-schemas")
			.setUrlParams(Schema.Struct({ entitySchemaId: Schema.String }))
			.addSuccess(Schema.Array(ListedEventSchema))
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/event-schemas")
			.setPayload(CreateEventSchemaBody)
			.addSuccess(ListedEventSchema, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(Conflict, { status: 409 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	);
