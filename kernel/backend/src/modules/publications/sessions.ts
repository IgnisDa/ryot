import { PublicationUnavailable } from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, DateTime, Duration, Effect, Layer, Schema } from "effect";

import { makeOpaqueTickets } from "#platform/http/opaque-tickets";
import { TransientValues } from "#platform/transient-values";

const SESSION_TTL_SECONDS = 60 * 60;

const SessionValue = Schema.fromJsonString(
	Schema.Struct({ publicationId: PublicationId, linkId: Schema.NullOr(PublicationLinkId) }),
);

export class PublicationSessions extends Context.Service<PublicationSessions>()(
	"@ryot-app/kernel-backend/modules/publications/sessions/PublicationSessions",
	{
		make: Effect.gen(function* () {
			const tickets = makeOpaqueTickets({
				codec: SessionValue,
				unavailable: (cause) => cause,
				values: yield* TransientValues,
				ttlSeconds: SESSION_TTL_SECONDS,
				key: (tokenHash) => `publication-session:${tokenHash}`,
				invalid: () => new PublicationUnavailable({ reason: { code: "session-expired" } }),
			});

			const start = Effect.fn("PublicationSessions.start")(function* (input: {
				readonly linkExpiresAt: null | Date;
				readonly publicationId: PublicationId;
				readonly linkId: null | PublicationLinkId;
			}) {
				const now = yield* Clock.currentTimeMillis;
				const expiresAt = Math.min(
					now + SESSION_TTL_SECONDS * 1000,
					input.linkExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
				);
				const { ticket } = yield* tickets.create(
					{ linkId: input.linkId, publicationId: input.publicationId },
					Duration.millis(Math.max(1, expiresAt - now)),
				);
				return {
					sessionToken: ticket,
					expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
				};
			});

			const find = Effect.fn("PublicationSessions.find")(function* (token: string) {
				const { hash, value } = yield* tickets.read(token);
				return { ...value, sessionKey: hash };
			});

			return { find, start };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
