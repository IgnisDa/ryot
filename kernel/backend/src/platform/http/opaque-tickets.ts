import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Duration, Effect, Schema } from "effect";

import type { TransientValues } from "../transient-values";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const makeOpaqueTickets = <A, E, F>(options: {
	readonly invalid: () => E;
	readonly ttlSeconds: number;
	readonly key: (hash: string) => string;
	readonly codec: Schema.Codec<A, string>;
	readonly values: TransientValues["Service"];
	readonly unavailable: (cause: unknown) => F;
}) => {
	const create = Effect.fn("OpaqueTickets.create")(function* (value: A) {
		const ticket = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
		const encoded = yield* Schema.encodeEffect(options.codec)(value).pipe(Effect.orDie);
		const now = yield* Clock.currentTimeMillis;
		yield* options.values
			.set(options.key(sha256Hex(ticket)), encoded, Duration.seconds(options.ttlSeconds))
			.pipe(Effect.mapError(options.unavailable));
		return { ticket, expiresAt: now + options.ttlSeconds * 1000 };
	});
	const consume = Effect.fn("OpaqueTickets.consume")(function* (ticket: string) {
		if (!TICKET_PATTERN.test(ticket)) {
			return yield* Effect.fail(options.invalid());
		}
		const raw = yield* options.values
			.take(options.key(sha256Hex(ticket)))
			.pipe(Effect.mapError(options.unavailable));
		if (raw === null) {
			return yield* Effect.fail(options.invalid());
		}
		return yield* Schema.decodeEffect(options.codec)(raw).pipe(Effect.mapError(options.invalid));
	});
	return { create, consume };
};
