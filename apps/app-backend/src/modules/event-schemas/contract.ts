import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AppSchema } from "~/lib/schema";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";

export const ListedEventSchema = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	entitySchemaId: Schema.String,
});

const CreateEventSchemaBody = Schema.Struct({
	name: Schema.String,
	propertiesSchema: AppSchema,
	entitySchemaId: Schema.String,
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
