import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Duration, Effect, Schema } from "effect";

import type { TransientValues } from "../transient-values";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type StoreError = Effect.Error<ReturnType<TransientValues["Service"]["get"]>>;

export const generateOpaqueTicket = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const isOpaqueTicket = (ticket: string) => TICKET_PATTERN.test(ticket);

export const makeOpaqueTickets = <A, E, F>(options: {
	readonly invalid: () => E;
	readonly ttlSeconds: number;
	readonly key: (hash: string) => string;
	readonly codec: Schema.Codec<A, string>;
	readonly values: TransientValues["Service"];
	readonly unavailable: (cause: StoreError) => F;
}) => {
	const create = Effect.fn("OpaqueTickets.create")(function* (
		value: A,
		ttl: Duration.Duration = Duration.seconds(options.ttlSeconds),
	) {
		const ticket = generateOpaqueTicket();
		const encoded = yield* Schema.encodeEffect(options.codec)(value).pipe(Effect.orDie);
		const now = yield* Clock.currentTimeMillis;
		yield* options.values
			.set(options.key(sha256Hex(ticket)), encoded, ttl)
			.pipe(Effect.mapError(options.unavailable));
		return { ticket, expiresAt: now + Duration.toMillis(ttl) };
	});
	const lookup = Effect.fnUntraced(function* (
		ticket: string,
		load: (key: string) => Effect.Effect<null | string, StoreError>,
	) {
		if (!isOpaqueTicket(ticket)) {
			return yield* Effect.fail(options.invalid());
		}
		const hash = sha256Hex(ticket);
		const raw = yield* load(options.key(hash)).pipe(Effect.mapError(options.unavailable));
		if (raw === null) {
			return yield* Effect.fail(options.invalid());
		}
		const value = yield* Schema.decodeEffect(options.codec)(raw).pipe(
			Effect.mapError(options.invalid),
		);
		return { hash, value };
	});
	const consume = Effect.fn("OpaqueTickets.consume")(function* (ticket: string) {
		return (yield* lookup(ticket, options.values.take)).value;
	});
	const read = Effect.fn("OpaqueTickets.read")(function* (ticket: string) {
		return yield* lookup(ticket, options.values.get);
	});
	return { read, create, consume };
};
