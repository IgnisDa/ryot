import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { EntityInterestSocketTicketResponse } from "./messages";

export const InterestGroup = HttpApiGroup.make("entity-interest")
	.annotate(OpenApi.Description, "Creates authenticated entity-interest socket sessions.")
	.add(
		HttpApiEndpoint.post("createSocketTicket", "/entity-interest/socket-ticket", {
			success: EntityInterestSocketTicketResponse,
		}).annotate(OpenApi.Description, "Creates a short-lived single-use socket ticket."),
	)
	.middleware(AuthMiddleware);
