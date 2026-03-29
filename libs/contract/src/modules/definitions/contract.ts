import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { RateLimited, Unauthorized } from "../../errors";
import { EntityDefinition, RelationshipDefinition, TrackerDefinition } from "./schemas";

export const DefinitionsGroup = HttpApiGroup.make("definitions")
	.annotate(OpenApi.Description, "Reads installed schema and tracker definitions.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listEntities", "/definitions/entities")
			.annotate(OpenApi.Description, "List installed entity definitions.")
			.addSuccess(Schema.Array(EntityDefinition)),
	)
	.add(
		HttpApiEndpoint.get("listRelationships", "/definitions/relationships")
			.annotate(OpenApi.Description, "List installed relationship definitions.")
			.addSuccess(Schema.Array(RelationshipDefinition)),
	)
	.add(
		HttpApiEndpoint.get("listTrackers", "/definitions/trackers")
			.annotate(OpenApi.Description, "List installed tracker definitions.")
			.addSuccess(Schema.Array(TrackerDefinition)),
	);
