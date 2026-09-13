import { assert, expect, layer } from "@effect/vitest";
import { EntityInterestTicketFailure } from "@ryot-app/contract/modules/entity-interest/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";
import Redis from "ioredis";
import { describe } from "vitest";

import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";
import { ImpersonationSessions } from "#modules/auth/impersonation-sessions";

import {
	ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS,
	EntityInterestInvalidTicket,
	EntityInterestTicketService,
} from "./ticket-service";

class FakeTicketStore extends Context.Service<
	FakeTicketStore,
	{
		readonly values: Effect.Effect<ReadonlyMap<string, string>>;
		readonly expiries: Effect.Effect<ReadonlyMap<string, number>>;
		readonly clear: Effect.Effect<void>;
		readonly put: (key: string, value: string) => Effect.Effect<void>;
	}
>()("test/FakeTicketStore") {}

const makeLayer = (
	options: {
		readonly activeImpersonation?: { readonly expiresAt: number } | null;
		readonly consumeUnavailable?: boolean;
		readonly createUnavailable?: boolean;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const values = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
			const expiries = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
			const runPromise = Effect.runPromiseWith(yield* Effect.context());
			const client: RedisService["Service"]["client"] = Object.assign(
				Object.create(Redis.prototype),
				{
					eval: (_script: string, _keyCount: number, key: string) =>
						options.consumeUnavailable
							? Promise.reject(new Error("Redis unavailable"))
							: runPromise(
									Ref.modify(values, (current) => {
										const next = new Map(current);
										next.delete(key);
										return [current.get(key) ?? null, next];
									}),
								),
					set: (key: string, value: string, _expiryMode: "EX", ttlSeconds: number) =>
						options.createUnavailable
							? Promise.reject(new Error("Redis unavailable"))
							: runPromise(
									Ref.update(values, (current) => new Map(current).set(key, value)).pipe(
										Effect.andThen(
											Ref.update(expiries, (current) => new Map(current).set(key, ttlSeconds)),
										),
										Effect.as("OK"),
									),
								),
				},
			);
			return Layer.provideMerge(
				EntityInterestTicketService.layer,
				Layer.merge(
					Layer.succeed(RedisService, makeRedisService({ client })),
					Layer.mock(ImpersonationSessions)({
						getActive: () => Effect.succeed(options.activeImpersonation ?? null),
					}),
				),
			).pipe(
				Layer.merge(
					Layer.succeed(FakeTicketStore, {
						values: Ref.get(values),
						expiries: Ref.get(expiries),
						clear: Ref.set(values, new Map()),
						put: (key, value) => Ref.update(values, (current) => new Map(current).set(key, value)),
					}),
				),
			);
		}),
	);

const failure = <A, E>(exit: Exit.Exit<A, E>) => {
	assert(Exit.isFailure(exit));
	const error = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(error));
	return error.value;
};

describe("EntityInterestTicketService", () => {
	layer(makeLayer())((test) => {
		test.effect("creates a 32-byte opaque ticket with a 30-second expiry", () =>
			Effect.gen(function* () {
				const store = yield* FakeTicketStore;
				const service = yield* EntityInterestTicketService;
				const created = yield* service.create({
					preferredLanguage: "es",
					userId: UserId.make("user-1"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});

				expect(created.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
				expect(Buffer.from(created.ticket, "base64url")).toHaveLength(32);
				expect([...(yield* store.values).keys()][0]).not.toContain(created.ticket);
				expect([...(yield* store.values).keys()][0]).toMatch(
					new RegExp(`^${redisKeys.entityInterestTicket("")}[a-f0-9]{64}$`),
				);
				expect([...(yield* store.values).values()]).toEqual([
					'{"userId":"user-1","accountGeneration":{"userId":"user-1","token":"test-account-generation"},"preferredLanguage":"es"}',
				]);
				expect([...(yield* store.expiries).values()]).toEqual([
					ENTITY_INTEREST_SOCKET_TICKET_TTL_SECONDS,
				]);
				expect(Date.parse(created.expiresAt)).toBeGreaterThan(0);
			}),
		);
	});

	layer(makeLayer({ createUnavailable: true }))((test) => {
		test.effect("exposes store unavailability when ticket creation fails", () =>
			Effect.gen(function* () {
				const service = yield* EntityInterestTicketService;
				const exit = yield* Effect.exit(
					service.create({
						preferredLanguage: null,
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					}),
				);

				expect(failure(exit)).toEqual(
					new EntityInterestTicketFailure({ reason: { code: "ticket-store-unavailable" } }),
				);
			}),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("consumes a ticket only once", () =>
			Effect.gen(function* () {
				const service = yield* EntityInterestTicketService;
				const created = yield* service.create({
					preferredLanguage: null,
					userId: UserId.make("user-1"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});

				expect(yield* service.consume(created.ticket)).toEqual({
					userId: "user-1",
					preferredLanguage: null,
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});
				const reused = yield* Effect.exit(service.consume(created.ticket));
				expect(failure(reused)).toEqual(new EntityInterestInvalidTicket());
			}),
		);
	});

	layer(makeLayer())((test) => {
		test.effect(
			"rejects an impersonation ticket when its auth session ended before consumption",
			() =>
				Effect.gen(function* () {
					const service = yield* EntityInterestTicketService;
					const created = yield* service.create({
						preferredLanguage: null,
						userId: UserId.make("user-1"),
						impersonation: { sessionId: "auth-session-1", expiresAt: Number.MAX_SAFE_INTEGER },
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					});

					const exit = yield* Effect.exit(service.consume(created.ticket));
					expect(failure(exit)).toEqual(new EntityInterestInvalidTicket());
				}),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("allows only one concurrent consumer", () =>
			Effect.gen(function* () {
				const service = yield* EntityInterestTicketService;
				const created = yield* service.create({
					preferredLanguage: "fr",
					userId: UserId.make("user-1"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});
				const exits = yield* Effect.forEach(
					[service.consume(created.ticket), service.consume(created.ticket)],
					Effect.exit,
					{ concurrency: "unbounded" },
				);

				expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
				expect(exits.filter(Exit.isFailure)).toHaveLength(1);
			}),
		);
	});

	layer(makeLayer({ consumeUnavailable: true }))((test) => {
		test.effect("distinguishes ticket-store outages from invalid tickets", () =>
			Effect.gen(function* () {
				const service = yield* EntityInterestTicketService;
				const exit = yield* Effect.exit(service.consume("A".repeat(43)));

				expect(failure(exit)).toEqual(
					new EntityInterestTicketFailure({ reason: { code: "ticket-store-unavailable" } }),
				);
			}),
		);
	});

	layer(makeLayer())((test) => {
		test.effect(
			"returns the same generic failure for missing, expired, and malformed tickets",
			() =>
				Effect.gen(function* () {
					const store = yield* FakeTicketStore;
					const service = yield* EntityInterestTicketService;
					const created = yield* service.create({
						preferredLanguage: null,
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					});
					yield* store.clear;

					for (const ticket of [created.ticket, "malformed", "A".repeat(43)]) {
						const exit = yield* Effect.exit(service.consume(ticket));
						expect(failure(exit)).toEqual(new EntityInterestInvalidTicket());
					}
				}),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("rejects malformed Redis values without exposing the ticket", () =>
			Effect.gen(function* () {
				const store = yield* FakeTicketStore;
				const service = yield* EntityInterestTicketService;
				const created = yield* service.create({
					preferredLanguage: null,
					userId: UserId.make("user-1"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});
				const [key] = (yield* store.values).keys();
				assert(key !== undefined);
				yield* store.put(key, '{"userId":1,"preferredLanguage":null}');

				const exit = yield* Effect.exit(service.consume(created.ticket));
				const error = failure(exit);
				expect(error).toEqual(new EntityInterestInvalidTicket());
				expect(String(error)).not.toContain(created.ticket);
				if (Exit.isFailure(exit)) {
					expect(Cause.pretty(exit.cause)).not.toContain(created.ticket);
				}
			}),
		);
	});
});
