import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EntityWatchSocketTicketResponse } from "./messages";

export const EntityWatchTicketFailureReason = Schema.Struct({
	code: Schema.Literal("ticket-store-unavailable"),
});
export type EntityWatchTicketFailureReason = typeof EntityWatchTicketFailureReason.Type;

export class EntityWatchTicketFailure extends Schema.TaggedError<EntityWatchTicketFailure>()(
	"EntityWatchTicketFailure",
	{ reason: EntityWatchTicketFailureReason },
) {}

export const EntityWatchesGroup = HttpApiGroup.make("entity-watches")
	.annotate(OpenApi.Description, "Creates authenticated entity-watches socket sessions.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"createSocketTicket",
			"/entity-watches/socket-ticket",
			{
				success: EntityWatchSocketTicketResponse,
				error: EntityWatchTicketFailure.pipe(HttpApiSchema.status(503)),
			},
		).annotate(OpenApi.Description, "Creates a short-lived single-use socket ticket."),
	)
	.middleware(AuthMiddleware);
