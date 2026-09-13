import { AuthorizationContext, CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { EntityInterestTicketService } from "./ticket-service";

export const InterestRoutesLive = HttpApiBuilder.group(AppContract, "entity-interest", (handlers) =>
	handlers.handle("createSocketTicket", () =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const authorization = yield* AuthorizationContext;
			const tickets = yield* EntityInterestTicketService;
			if (authorization.impersonation !== undefined) {
				if (
					authorization.credential.kind !== "oauth" ||
					authorization.credential.sessionId === undefined
				) {
					return yield* Effect.die("Impersonation authorization has no OAuth session");
				}
				return yield* tickets.create({
					userId: user.id,
					accountGeneration: user.accountGeneration,
					preferredLanguage: user.preferences.language,
					impersonation: {
						sessionId: authorization.credential.sessionId,
						expiresAt: authorization.impersonation.expiresAt,
					},
				});
			}
			return yield* tickets.create({
				userId: user.id,
				accountGeneration: user.accountGeneration,
				preferredLanguage: user.preferences.language,
			});
		}),
	),
);
