import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Effect, Schema } from "effect";

import type { RedisService } from "./redis";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONSUME_TICKET_SCRIPT =
	"local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]) end; return value";

export const makeOpaqueTickets = <A, E, F>(options: {
	readonly invalid: () => E;
	readonly ttlSeconds: number;
	readonly key: (hash: string) => string;
	readonly codec: Schema.Codec<A, string>;
	readonly redis: RedisService["Service"];
	readonly unavailable: (cause: unknown) => F;
}) => {
	const create = Effect.fn("OpaqueTickets.create")(function* (value: A) {
		const ticket = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
		const encoded = yield* Schema.encodeEffect(options.codec)(value).pipe(Effect.orDie);
		const now = yield* Clock.currentTimeMillis;
		yield* Effect.tryPromise({
			catch: options.unavailable,
			try: () =>
				options.redis.client.set(options.key(sha256Hex(ticket)), encoded, "EX", options.ttlSeconds),
		});
		return { ticket, expiresAt: now + options.ttlSeconds * 1000 };
	});
	const consume = Effect.fn("OpaqueTickets.consume")(function* (ticket: string) {
		if (!TICKET_PATTERN.test(ticket)) {
			return yield* Effect.fail(options.invalid());
		}
		const raw = yield* Effect.tryPromise({
			catch: options.unavailable,
			try: () =>
				options.redis.client.eval(CONSUME_TICKET_SCRIPT, 1, options.key(sha256Hex(ticket))),
		});
		if (typeof raw !== "string") {
			return yield* Effect.fail(options.invalid());
		}
		return yield* Schema.decodeEffect(options.codec)(raw).pipe(Effect.mapError(options.invalid));
	});
	return { create, consume };
};
