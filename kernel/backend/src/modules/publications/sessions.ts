import { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect";

import { TransientValues } from "#platform/transient-values";

const SESSION_TTL_MS = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const storageKey = (tokenHash: string) => `publication-session:${tokenHash}`;

const SessionValue = Schema.fromJsonString(
	Schema.Struct({ publicationId: PublicationId, linkId: Schema.NullOr(PublicationLinkId) }),
);

export const randomToken = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const isWellFormedToken = (token: string) => TOKEN_PATTERN.test(token);

export class PublicationSessions extends Context.Service<PublicationSessions>()(
	"@ryot-app/kernel-backend/modules/publications/sessions/PublicationSessions",
	{
		make: Effect.gen(function* () {
			const values = yield* TransientValues;

			const start = Effect.fn("PublicationSessions.start")(function* (input: {
				readonly linkExpiresAt: null | Date;
				readonly publicationId: PublicationId;
				readonly linkId: null | PublicationLinkId;
			}) {
				const now = yield* Clock.currentTimeMillis;
				const expiresAt = Math.min(
					now + SESSION_TTL_MS,
					input.linkExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
				);
				const token = randomToken();
				const encoded = yield* Schema.encodeEffect(SessionValue)({
					linkId: input.linkId,
					publicationId: input.publicationId,
				}).pipe(Effect.orDie);
				yield* values.set(
					storageKey(sha256Hex(token)),
					encoded,
					Duration.millis(Math.max(1, expiresAt - now)),
				);
				return {
					sessionToken: token,
					expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
				};
			});

			const find = Effect.fn("PublicationSessions.find")(function* (token: string) {
				if (!isWellFormedToken(token)) {
					return null;
				}
				const sessionKey = sha256Hex(token);
				const raw = yield* values.get(storageKey(sessionKey));
				if (raw === null) {
					return null;
				}
				const decoded = yield* Effect.option(Schema.decodeEffect(SessionValue)(raw));
				return Option.isSome(decoded) ? { ...decoded.value, sessionKey } : null;
			});

			return { find, start };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
