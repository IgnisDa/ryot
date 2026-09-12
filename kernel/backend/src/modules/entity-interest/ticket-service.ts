import { EntityInterestTicketFailure } from "@ryot-app/contract/modules/entity-interest/contract";
import type { EntityInterestSocketTicketResponse } from "@ryot-app/contract/modules/entity-interest/messages";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Data, DateTime, Effect, Layer, Schema } from "effect";

import { makeOpaqueTickets } from "#lib/infrastructure/opaque-tickets";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { ImpersonationSessions } from "#modules/auth/impersonation-sessions";

export const ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS = 30;

export class EntityInterestInvalidTicket extends Data.TaggedError("EntityInterestInvalidTicket") {}

const invalidTicket = () => new EntityInterestInvalidTicket();
const storeUnavailable = () =>
	new EntityInterestTicketFailure({ reason: { code: "ticket-store-unavailable" } });
const TicketValue = Schema.Struct({
	userId: UserId,
	preferredLanguage: Schema.NullOr(Schema.String),
	impersonation: Schema.optional(
		Schema.Struct({ sessionId: Schema.String, expiresAt: Schema.Finite }),
	),
});

export class EntityInterestTicketService extends Context.Service<EntityInterestTicketService>()(
	"EntityInterestTicketService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const impersonationSessions = yield* ImpersonationSessions;
			const tickets = makeOpaqueTickets({
				redis,
				invalid: invalidTicket,
				unavailable: storeUnavailable,
				key: redisKeys.entityInterestTicket,
				codec: Schema.fromJsonString(TicketValue),
				ttlSeconds: ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS,
			});

			const create = Effect.fn("EntityInterestTicketService.create")(function* (
				input: typeof TicketValue.Type,
			) {
				const created = yield* tickets.create(input);
				return {
					ticket: created.ticket,
					expiresAt: DateTime.formatIso(DateTime.makeUnsafe(created.expiresAt)),
				} satisfies EntityInterestSocketTicketResponse;
			});

			const consume = Effect.fn("EntityInterestTicketService.consume")(function* (ticket: string) {
				const principal = yield* tickets.consume(ticket);
				if (principal.impersonation === undefined) {
					return principal;
				}
				const activeSession = yield* impersonationSessions.getActive(
					principal.impersonation.sessionId,
					principal.userId,
				);
				const now = yield* Clock.currentTimeMillis;
				if (
					activeSession === null ||
					activeSession.expiresAt <= now ||
					principal.impersonation.expiresAt <= now
				) {
					return yield* invalidTicket();
				}
				return {
					...principal,
					impersonation: {
						...principal.impersonation,
						expiresAt: Math.min(principal.impersonation.expiresAt, activeSession.expiresAt),
					},
				};
			});

			return { create, consume };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
