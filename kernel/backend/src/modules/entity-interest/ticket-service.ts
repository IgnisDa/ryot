import { EntityInterestTicketFailure } from "@ryot/contract/modules/entity-interest/contract";
import type { EntityInterestSocketTicketResponse } from "@ryot/contract/modules/entity-interest/messages";
import { UserId } from "@ryot/contract/schema/brands";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { Clock, Context, Data, DateTime, Effect, Layer, Schema } from "effect";

import { RedisService } from "#lib/infrastructure/redis";

export const ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS = 30;

const CONSUME_TICKET_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
`;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export class EntityInterestInvalidTicket extends Data.TaggedError("EntityInterestInvalidTicket") {}

const invalidTicket = () => new EntityInterestInvalidTicket();
const storeUnavailable = () =>
	new EntityInterestTicketFailure({ reason: { code: "ticket-store-unavailable" } });
const TicketValue = Schema.Struct({
	userId: UserId,
	preferredLanguage: Schema.NullOr(Schema.String),
});

export const entityInterestTicketKey = (ticketHash: string) =>
	`ryot:entity-interest:ticket:${ticketHash}`;

const ticketHash = (ticket: string) => sha256Hex(ticket);
const makeTicket = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export class EntityInterestTicketService extends Context.Service<EntityInterestTicketService>()(
	"EntityInterestTicketService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;

			const create = Effect.fn("EntityInterestTicketService.create")(function* (input: {
				readonly userId: UserId;
				readonly preferredLanguage: string | null;
			}) {
				const ticket = makeTicket();
				const now = yield* Clock.currentTimeMillis;
				const value = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(TicketValue))(
					input,
				).pipe(Effect.orDie);
				yield* Effect.tryPromise({
					catch: storeUnavailable,
					try: () =>
						redis.client.set(
							entityInterestTicketKey(ticketHash(ticket)),
							value,
							"EX",
							ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS,
						),
				});
				return {
					ticket,
					expiresAt: DateTime.formatIso(
						DateTime.makeUnsafe(now + ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS * 1_000),
					),
				} satisfies EntityInterestSocketTicketResponse;
			});

			const consume = Effect.fn("EntityInterestTicketService.consume")(function* (ticket: string) {
				if (!TICKET_PATTERN.test(ticket)) {
					return yield* invalidTicket();
				}
				const raw = yield* Effect.tryPromise({
					catch: storeUnavailable,
					try: () =>
						redis.client.eval(
							CONSUME_TICKET_SCRIPT,
							1,
							entityInterestTicketKey(ticketHash(ticket)),
						),
				});
				if (typeof raw !== "string") {
					return yield* invalidTicket();
				}
				return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(TicketValue))(raw).pipe(
					Effect.mapError(invalidTicket),
				);
			});

			return { create, consume };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
