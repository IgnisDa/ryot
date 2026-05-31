import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";

export const ListedEventSchema = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	entitySchemaId: Schema.String,
	propertiesSchema: Schema.Unknown,
});

const CreateEventSchemaBody = Schema.Struct({
	name: Schema.String,
	entitySchemaId: Schema.String,
	propertiesSchema: Schema.Unknown,
	slug: Schema.optional(Schema.String),
});

export const EventSchemasGroup = HttpApiGroup.make("event-schemas")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/event-schemas")
			.setUrlParams(Schema.Struct({ entitySchemaId: Schema.String }))
			.addSuccess(Schema.Array(ListedEventSchema))
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/event-schemas")
			.setPayload(CreateEventSchemaBody)
			.addSuccess(ListedEventSchema, { status: 201 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
