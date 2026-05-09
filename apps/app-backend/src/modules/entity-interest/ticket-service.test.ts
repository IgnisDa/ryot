import { assert, expect, it } from "@effect/vitest";
import { EntityInterestTicketFailure } from "@ryot/contract/modules/entity-interest/contract";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import Redis from "ioredis";
import { describe } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";

import {
	ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS,
	EntityInterestTicketService,
	entityInterestTicketKey,
} from "./ticket-service";

const makeLayer = () => {
	const values = new Map<string, string>();
	const expiries = new Map<string, number>();
	const client: RedisService["Service"]["client"] = Object.assign(Object.create(Redis.prototype), {
		set: (key: string, value: string, _expiryMode: "EX", ttlSeconds: number) => {
			values.set(key, value);
			expiries.set(key, ttlSeconds);
			return Promise.resolve("OK");
		},
		eval: (_script: string, _keyCount: number, key: string) => {
			const value = values.get(key) ?? null;
			values.delete(key);
			return Promise.resolve(value);
		},
	});
	const layer = Layer.provideMerge(
		EntityInterestTicketService.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
	);
	return { values, expiries, layer };
};

const failure = <A>(exit: Exit.Exit<A, EntityInterestTicketFailure>) => {
	assert(Exit.isFailure(exit));
	const error = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(error));
	return error.value;
};

describe("EntityInterestTicketService", () => {
	it.effect("creates a 32-byte opaque ticket with a 30-second expiry", () => {
		const { values, expiries, layer } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* EntityInterestTicketService;
			const created = yield* service.create({
				preferredLanguage: "es",
				userId: UserId.make("user-1"),
			});

			expect(created.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(Buffer.from(created.ticket, "base64url")).toHaveLength(32);
			expect([...values.keys()][0]).not.toContain(created.ticket);
			expect([...values.keys()][0]).toMatch(
				new RegExp(`^${entityInterestTicketKey("")}[a-f0-9]{64}$`),
			);
			expect([...values.values()]).toEqual(['{"userId":"user-1","preferredLanguage":"es"}']);
			expect([...expiries.values()]).toEqual([ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS]);
			expect(Date.parse(created.expiresAt)).toBeGreaterThan(0);
		}).pipe(Effect.provide(layer));
	});

	it.effect("consumes a ticket only once", () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* EntityInterestTicketService;
			const created = yield* service.create({
				preferredLanguage: null,
				userId: UserId.make("user-1"),
			});

			expect(yield* service.consume(created.ticket)).toEqual({
				userId: "user-1",
				preferredLanguage: null,
			});
			const reused = yield* Effect.exit(service.consume(created.ticket));
			expect(failure(reused)).toEqual(
				new EntityInterestTicketFailure({ reason: { code: "invalid-ticket" } }),
			);
		}).pipe(Effect.provide(layer));
	});

	it.effect("allows only one concurrent consumer", () => {
		const { layer } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* EntityInterestTicketService;
			const created = yield* service.create({
				preferredLanguage: "fr",
				userId: UserId.make("user-1"),
			});
			const exits = yield* Effect.all(
				[service.consume(created.ticket), service.consume(created.ticket)].map(Effect.exit),
				{ concurrency: "unbounded" },
			);

			expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
			expect(exits.filter(Exit.isFailure)).toHaveLength(1);
		}).pipe(Effect.provide(layer));
	});

	it.effect("returns the same generic failure for missing, expired, and malformed tickets", () => {
		const { values, layer } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* EntityInterestTicketService;
			const created = yield* service.create({
				preferredLanguage: null,
				userId: UserId.make("user-1"),
			});
			values.clear();

			for (const ticket of [created.ticket, "malformed", "A".repeat(43)]) {
				const exit = yield* Effect.exit(service.consume(ticket));
				expect(failure(exit)).toEqual(
					new EntityInterestTicketFailure({ reason: { code: "invalid-ticket" } }),
				);
			}
		}).pipe(Effect.provide(layer));
	});

	it.effect("rejects malformed Redis values without exposing the ticket", () => {
		const { values, layer } = makeLayer();
		return Effect.gen(function* () {
			const service = yield* EntityInterestTicketService;
			const created = yield* service.create({
				preferredLanguage: null,
				userId: UserId.make("user-1"),
			});
			const [key] = values.keys();
			assert(key !== undefined);
			values.set(key, '{"userId":1,"preferredLanguage":null}');

			const exit = yield* Effect.exit(service.consume(created.ticket));
			const error = failure(exit);
			expect(error).toEqual(
				new EntityInterestTicketFailure({ reason: { code: "invalid-ticket" } }),
			);
			expect(String(error)).not.toContain(created.ticket);
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).not.toContain(created.ticket);
			}
		}).pipe(Effect.provide(layer));
	});
});
