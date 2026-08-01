import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { EntityInterestSocketTicketResponse } from "./messages";

export const EntityInterestTicketFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("invalid-ticket") }),
	Schema.Struct({ code: Schema.Literal("ticket-store-unavailable") }),
]);
export type EntityInterestTicketFailureReason = typeof EntityInterestTicketFailureReason.Type;

export class EntityInterestTicketFailure extends Schema.TaggedError<EntityInterestTicketFailure>()(
	"EntityInterestTicketFailure",
	{ reason: EntityInterestTicketFailureReason },
) {}

export const InterestGroup = HttpApiGroup.make("entity-interest")
	.annotate(OpenApi.Description, "Creates authenticated entity-interest socket sessions.")
	.add(
		HttpApiEndpoint.post("createSocketTicket", "/entity-interest/socket-ticket", {
			success: EntityInterestSocketTicketResponse,
			error: EntityInterestTicketFailure.pipe(HttpApiSchema.status(503)),
		}).annotate(OpenApi.Description, "Creates a short-lived single-use socket ticket."),
	)
	.middleware(AuthMiddleware);
