import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { EntityInterestTicketService } from "./ticket-service";

export const InterestRoutesLive = HttpApiBuilder.group(AppContract, "entity-interest", (handlers) =>
	handlers.handle("createSocketTicket", () =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const tickets = yield* EntityInterestTicketService;
			return yield* tickets.create({
				userId: user.id,
				preferredLanguage: user.preferences.language,
			});
		}),
	),
);
