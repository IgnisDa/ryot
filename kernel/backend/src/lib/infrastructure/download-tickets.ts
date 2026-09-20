import { Clock, Context, Data, Effect, Layer, Schema } from "effect";

import { HmacSigner } from "./hmac-signer";

const DOWNLOAD_TICKET_TTL_SECONDS = 5 * 60;

const DownloadTicketClaims = Schema.Struct({
	expiresAt: Schema.Int,
	purpose: Schema.NonEmptyString,
	resource: Schema.NonEmptyString,
	subject: Schema.NullOr(Schema.String),
});

type DownloadTicketClaims = typeof DownloadTicketClaims.Type;

export class DownloadTicketInvalid extends Data.TaggedError("DownloadTicketInvalid")<{}> {}

export class DownloadTickets extends Context.Service<DownloadTickets>()("DownloadTickets", {
	make: Effect.gen(function* () {
		const signer = yield* HmacSigner;

		const issue = Effect.fn("DownloadTickets.issue")(function* (
			input: Omit<DownloadTicketClaims, "expiresAt">,
		) {
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			const claims: DownloadTicketClaims = {
				...input,
				expiresAt: now + DOWNLOAD_TICKET_TTL_SECONDS,
			};
			const payload = yield* Schema.encodeEffect(Schema.fromJsonString(DownloadTicketClaims))(
				claims,
			).pipe(Effect.orDie);
			return `${payload}.${yield* signer.sign(payload)}`;
		});

		const verify = Effect.fn("DownloadTickets.verify")(function* (
			ticket: string,
			expected: Pick<DownloadTicketClaims, "purpose" | "resource">,
		) {
			const separator = ticket.lastIndexOf(".");
			if (separator < 1) {
				return yield* new DownloadTicketInvalid();
			}
			const payload = ticket.slice(0, separator);
			const signature = ticket.slice(separator + 1);
			if (!(yield* signer.verify(payload, signature))) {
				return yield* new DownloadTicketInvalid();
			}

			const claims = Schema.decodeOption(Schema.fromJsonString(DownloadTicketClaims))(payload);
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			if (
				claims._tag === "None" ||
				claims.value.expiresAt <= now ||
				claims.value.purpose !== expected.purpose ||
				claims.value.resource !== expected.resource
			) {
				return yield* new DownloadTicketInvalid();
			}
			return claims.value;
		});

		return { issue, verify };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const downloadTicketUrl = (path: string, ticket: string) =>
	`${path}?${new URLSearchParams({ ticket }).toString()}`;
