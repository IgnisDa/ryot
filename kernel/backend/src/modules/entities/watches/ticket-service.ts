import { EntityWatchTicketFailure } from "@ryot-app/contract/modules/entity-watches/contract";
import type { EntityWatchSocketTicketResponse } from "@ryot-app/contract/modules/entity-watches/messages";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Data, DateTime, Effect, Layer, Schema } from "effect";

import { ImpersonationSessions } from "#modules/accounts/auth/impersonation-sessions";
import { makeOpaqueTickets } from "#platform/http/opaque-tickets";
import { RedisService, redisKeys } from "#platform/redis";

export const ENTITY_WATCH_SOCKET_TICKET_TTL_SECONDS = 30;

export class EntityWatchInvalidTicket extends Data.TaggedError("EntityWatchInvalidTicket") {}

const invalidTicket = () => new EntityWatchInvalidTicket();
const storeUnavailable = () =>
	new EntityWatchTicketFailure({ reason: { code: "ticket-store-unavailable" } });
const TicketValue = Schema.Struct({
	userId: UserId,
	accountGeneration: AccountGeneration,
	preferredLanguage: Schema.NullOr(Schema.String),
	impersonation: Schema.optional(
		Schema.Struct({ sessionId: Schema.String, expiresAt: Schema.Finite }),
	),
});

export class EntityWatchTicketService extends Context.Service<EntityWatchTicketService>()(
	"EntityWatchTicketService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const impersonationSessions = yield* ImpersonationSessions;
			const tickets = makeOpaqueTickets({
				redis,
				invalid: invalidTicket,
				unavailable: storeUnavailable,
				key: redisKeys.entityWatchTicket,
				codec: Schema.fromJsonString(TicketValue),
				ttlSeconds: ENTITY_WATCH_SOCKET_TICKET_TTL_SECONDS,
			});

			const create = Effect.fn("EntityWatchTicketService.create")(function* (
				input: typeof TicketValue.Type,
			) {
				const created = yield* tickets.create(input);
				return {
					ticket: created.ticket,
					expiresAt: DateTime.formatIso(DateTime.makeUnsafe(created.expiresAt)),
				} satisfies EntityWatchSocketTicketResponse;
			});

			const consume = Effect.fn("EntityWatchTicketService.consume")(function* (ticket: string) {
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
