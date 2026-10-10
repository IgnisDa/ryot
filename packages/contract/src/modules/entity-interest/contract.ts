import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EntityInterestSocketTicketResponse } from "./messages";

export const EntityInterestTicketFailureReason = Schema.Struct({
	code: Schema.Literal("ticket-store-unavailable"),
});
export type EntityInterestTicketFailureReason = typeof EntityInterestTicketFailureReason.Type;

export class EntityInterestTicketFailure extends Schema.TaggedError<EntityInterestTicketFailure>()(
	"EntityInterestTicketFailure",
	{ reason: EntityInterestTicketFailureReason },
) {}

export const InterestGroup = HttpApiGroup.make("entity-interest")
	.annotate(OpenApi.Description, "Creates authenticated entity-interest socket sessions.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"createSocketTicket",
			"/entity-interest/socket-ticket",
			{
				success: EntityInterestSocketTicketResponse,
				error: EntityInterestTicketFailure.pipe(HttpApiSchema.status(503)),
			},
		).annotate(OpenApi.Description, "Creates a short-lived single-use socket ticket."),
	)
	.middleware(AuthMiddleware);
