import { describe, expect, layer } from "@effect/vitest";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Clock, Effect, Layer } from "effect";
import Redis from "ioredis";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeRedisService } from "#lib/test-utils/effect";
import { testRedisServiceLayer, testRedisUrl } from "#lib/test-utils/redis";

import {
	makeProviderHttpAdmission,
	PROVIDER_HTTP_TICKET_LIMITS,
	ProviderHttpAdmissionCorruptState,
	type ProviderHttpAdmissionDeclaration,
	type ProviderHttpAdmissionTiming,
	ProviderHttpAdmissionUnavailable,
	type ProviderHttpPoll,
	type ProviderHttpTicket,
} from "./provider-http-admission";
import { redisKeys, RedisService } from "./redis";

type Client = RedisService["Service"]["client"];
type Admission = Effect.Success<ReturnType<typeof makeProviderHttpAdmission>>;

const productionTiming: ProviderHttpAdmissionTiming = {
	ticketLeaseMs: 120_000,
	tombstoneTtlMs: 600_000,
	minimumGrantLeaseMs: 1_000,
};

const call = <A>(run: () => Promise<A>) => Effect.tryPromise(run).pipe(Effect.orDie);

const makeAdmission = (timing: Partial<ProviderHttpAdmissionTiming> = {}) =>
	makeProviderHttpAdmission({ ...productionTiming, ...timing });

const usePolicy = Effect.fnUntraced(function* (
	overrides: Partial<ProviderHttpAdmissionDeclaration> = {},
) {
	const declaration = {
		requests: 1_000,
		intervalMs: 1_000,
		hash: "declaration-v1",
		key: `test.${crypto.randomUUID()}`,
		...overrides,
	};
	const { client } = yield* RedisService;
	const keys = Object.values(redisKeys.providerHttpAdmission(declaration.key));
	yield* Effect.addFinalizer(() => call(() => client.del(...keys)));
	return { keys, client, declaration, state: redisKeys.providerHttpAdmission(declaration.key) };
});

const ticket = (
	id: string,
	tenant: string,
	plugin = "plugin",
	lane: ExecutionLane = "interactive",
): ProviderHttpTicket => ({ id, lane, tenant, plugin });

const readKey = Effect.fnUntraced(function* (client: Client, key: string) {
	const type = yield* call(() => client.type(key));
	switch (type) {
		case "list":
			return yield* call(() => client.lrange(key, 0, -1));
		case "hash":
			return yield* call(() => client.hgetall(key));
		case "zset":
			return yield* call(() => client.zrange(key, 0, -1, "WITHSCORES"));
		default:
			return type;
	}
});

const snapshot = (client: Client, keys: ReadonlyArray<string>) =>
	Effect.forEach(sortBy(keys), (key) => Effect.map(readKey(client, key), (value) => [key, value]));

const stateField = (client: Client, key: string, field: string) =>
	Effect.map(
		call(() => client.hget(key, field)),
		(value) => Number(value),
	);

const ticketCount = (client: Client, key: string) => call(() => client.hlen(key));

/** Polls pending tickets in order, across instances, until one is admitted. */
const admitNext = Effect.fnUntraced(function* (
	instances: ReadonlyArray<Admission>,
	declaration: ProviderHttpAdmissionDeclaration,
	pending: Array<ProviderHttpTicket>,
	skip: (candidate: ProviderHttpTicket) => boolean = () => false,
) {
	for (let round = 0; round < 500; round += 1) {
		for (const [index, candidate] of pending.entries()) {
			const service = instances[(round + index) % instances.length];
			if (!service || skip(candidate)) {
				continue;
			}
			const polled = yield* service.poll(declaration, candidate);
			if (polled.status !== "granted") {
				continue;
			}
			const claimed = yield* service.claim(declaration, candidate, polled.nonce);
			if (claimed.status === "admitted") {
				pending.splice(index, 1);
				return candidate;
			}
		}
		yield* Effect.sleep(2);
	}
	return yield* Effect.die("no ticket was admitted");
});

const admitAll = Effect.fnUntraced(function* (
	instances: ReadonlyArray<Admission>,
	declaration: ProviderHttpAdmissionDeclaration,
	tickets: ReadonlyArray<ProviderHttpTicket>,
	count = tickets.length,
) {
	const pending = [...tickets];
	const admitted: Array<ProviderHttpTicket> = [];
	while (admitted.length < count) {
		admitted.push(yield* admitNext(instances, declaration, pending));
	}
	return admitted;
});

const registerAll = (
	instances: ReadonlyArray<Admission>,
	declaration: ProviderHttpAdmissionDeclaration,
	tickets: ReadonlyArray<ProviderHttpTicket>,
) =>
	Effect.forEach(
		tickets,
		(candidate, index) => {
			const service = instances[index % instances.length];
			return service
				? service.register(declaration, candidate).pipe(Effect.orDie)
				: Effect.die("missing admission instance");
		},
		{ discard: true },
	);

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

const grantNonce = (polled: ProviderHttpPoll) =>
	polled.status === "granted" ? Effect.succeed(polled.nonce) : Effect.die("expected a grant");

layer(testRedisServiceLayer, { excludeTestServices: true })((test) => {
	describe("http_admission_is_fair_across_instances_users_and_plugins", () => {
		test.effect("alternates users within a round however many plugins one user rotates", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { declaration } = yield* usePolicy();
					const instances = [yield* makeAdmission(), yield* makeAdmission()];
					const userA = ["p1", "p2", "p3"].flatMap((plugin) =>
						range(4).map((n) => ticket(`a-${plugin}-${n}`, "user:a", plugin)),
					);
					const userB = range(6).map((n) => ticket(`b-${n}`, "user:b"));
					yield* registerAll(instances, declaration, [...userA, ...userB]);

					const admitted = yield* admitAll(instances, declaration, [...userA, ...userB], 12);

					expect(admitted.map(({ tenant }) => tenant)).toEqual(
						range(12).map((n) => (n % 2 === 0 ? "user:a" : "user:b")),
					);
					expect(admitted.filter(({ tenant }) => tenant === "user:a").map(({ id }) => id)).toEqual([
						"a-p1-0",
						"a-p2-0",
						"a-p3-0",
						"a-p1-1",
						"a-p2-1",
						"a-p3-1",
					]);
					expect(admitted.filter(({ tenant }) => tenant === "user:b").map(({ id }) => id)).toEqual(
						range(6).map((n) => `b-${n}`),
					);
				}),
			),
		);

		test.effect("a tenant at its cap does not block another tenant's registration", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { state, client, declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					yield* registerAll(
						[service],
						declaration,
						range(PROVIDER_HTTP_TICKET_LIMITS.tenant).map((n) => ticket(`a-${n}`, "user:a")),
					);

					expect(yield* service.register(declaration, ticket("a-over", "user:a"))).toMatchObject({
						status: "overloaded",
					});
					expect(yield* service.register(declaration, ticket("b-0", "user:b"))).toEqual({
						status: "registered",
					});
					expect(yield* ticketCount(client, state.tickets)).toBe(
						PROVIDER_HTTP_TICKET_LIMITS.tenant + 1,
					);
				}),
			),
		);

		test.effect(
			"a grantee that sleeps past its grant keeps its user's share and idles at most one grant lease",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const { declaration } = yield* usePolicy();
						const service = yield* makeAdmission({ minimumGrantLeaseMs: 300 });
						const [a1, a2, b1, b2] = [
							ticket("a1", "user:a"),
							ticket("a2", "user:a"),
							ticket("b1", "user:b"),
							ticket("b2", "user:b"),
						];
						yield* registerAll([service], declaration, [a1, a2, b1, b2]);

						expect(yield* service.poll(declaration, b1)).toMatchObject({ status: "wait" });
						const grantedAt = yield* Clock.currentTimeMillis;
						expect(yield* service.poll(declaration, a2)).toMatchObject({ status: "wait" });
						yield* Effect.sleep(350);

						expect(yield* service.poll(declaration, b1)).toMatchObject({ status: "wait" });
						const reassigned = yield* service.poll(declaration, a2);
						expect((yield* Clock.currentTimeMillis) - grantedAt).toBeLessThan(600);
						expect(reassigned).toMatchObject({ status: "granted" });
						if (reassigned.status === "granted") {
							expect(yield* service.claim(declaration, a2, reassigned.nonce)).toEqual({
								status: "admitted",
							});
						}
						const rest = yield* admitAll([service], declaration, [a1, b1, b2]);

						expect(rest.map(({ id }) => id)).toEqual(["b1", "a1", "b2"]);
					}),
				),
		);
	});

	describe("http_lanes_preserve_spacing_and_background_progress", () => {
		test.effect("admits interactive first and background no later than every fifth claim", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					const background = range(3).map((n) => ticket(`bg-${n}`, "user:a", "p", "background"));
					const interactive = range(10).map((n) => ticket(`in-${n}`, `user:${n % 2}`));
					yield* registerAll([service], declaration, [...background, ...interactive]);

					const admitted = yield* admitAll([service], declaration, [...background, ...interactive]);

					expect(admitted.map(({ lane }) => lane)).toEqual([
						...Array<ExecutionLane>(4).fill("interactive"),
						"background",
						...Array<ExecutionLane>(4).fill("interactive"),
						"background",
						"interactive",
						"interactive",
						"background",
					]);
				}),
			),
		);

		test.effect("never spaces admitted claims below the declared spacing", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { state, client, declaration } = yield* usePolicy({ requests: 1, intervalMs: 40 });
					const service = yield* makeAdmission({ minimumGrantLeaseMs: 60 });
					const tickets = range(6).map((n) => ticket(`t-${n}`, `user:${n % 3}`));
					yield* registerAll([service], declaration, tickets);
					const anchors: Array<number> = [];
					const pending = [...tickets];
					let sleeperAwake = false;
					while (pending.length > 0) {
						yield* admitNext(
							[service],
							declaration,
							pending,
							(candidate) => candidate.id === "t-1" && !sleeperAwake,
						);
						anchors.push(yield* stateField(client, state.state, "a"));
						sleeperAwake = anchors.length >= 2;
						expect(
							yield* service.claim(declaration, pending[0] ?? ticket("none", "x"), "stale"),
						).toMatchObject({ status: expect.stringMatching(/^(rejected|unknown)$/) });
					}

					const gaps = anchors.slice(1).map((anchor, index) => anchor - (anchors[index] ?? 0));
					expect(gaps.every((gap) => gap >= 40)).toBe(true);
					expect(anchors).toHaveLength(6);
				}),
			),
		);
	});

	describe("http_fair_tickets_preserve_durable_admission_protections", () => {
		test.effect("treats a duplicate registration as a no-op and a mismatched one as corrupt", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { keys, client, declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					const first = ticket("t-1", "user:a");
					yield* service.register(declaration, first);
					const before = yield* snapshot(client, keys);

					expect(yield* service.register(declaration, first)).toEqual({ status: "registered" });
					expect(yield* snapshot(client, keys)).toEqual(before);
					assertExitFails(
						yield* Effect.exit(service.register(declaration, { ...first, plugin: "other" })),
						new ProviderHttpAdmissionCorruptState({ message: "Redis admission state is corrupt" }),
					);
					expect(yield* snapshot(client, keys)).toEqual(before);
				}),
			),
		);

		test.effect("rejects a claim with another ticket's grant or a wrong nonce", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					const [first, second] = [ticket("t-1", "user:a"), ticket("t-2", "user:b")];
					yield* registerAll([service], declaration, [first, second]);
					const nonce = yield* grantNonce(yield* service.poll(declaration, first));

					expect(yield* service.claim(declaration, second, nonce)).toEqual({ status: "rejected" });
					expect(yield* service.claim(declaration, first, `${nonce}0`)).toEqual({
						status: "rejected",
					});
					expect(yield* service.claim(declaration, first, nonce)).toEqual({ status: "admitted" });
				}),
			),
		);

		test.effect("admits a retried claim after a lost reply once without spending a slot", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { keys, state, client, declaration } = yield* usePolicy({
						requests: 1,
						intervalMs: 60_000,
					});
					const service = yield* makeAdmission();
					const first = ticket("t-1", "user:a");
					yield* service.register(declaration, first);
					const nonce = yield* grantNonce(yield* service.poll(declaration, first));
					expect(yield* service.claim(declaration, first, nonce)).toEqual({ status: "admitted" });
					const anchor = yield* stateField(client, state.state, "a");
					const after = yield* snapshot(client, keys);

					expect(yield* service.claim(declaration, first, nonce)).toEqual({ status: "admitted" });
					expect(yield* service.register(declaration, first)).toEqual({ status: "claimed" });
					expect(yield* service.poll(declaration, first)).toEqual({ status: "claimed" });
					expect(yield* stateField(client, state.state, "a")).toBe(anchor);
					expect(yield* snapshot(client, keys)).toEqual(after);
				}),
			),
		);

		test.effect("enforces blocks and spacing at claim and wakes waiters after them", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { declaration } = yield* usePolicy({ requests: 1, intervalMs: 30_000 });
					const service = yield* makeAdmission();
					const [first, second] = [ticket("t-1", "user:a"), ticket("t-2", "user:b")];
					yield* registerAll([service], declaration, [first, second]);
					const nonce = yield* grantNonce(yield* service.poll(declaration, first));
					const blocked = yield* service.block(declaration, 90_000);

					expect(yield* service.claim(declaration, first, nonce)).toEqual({ status: "rejected" });
					const waiting = yield* service.poll(declaration, first);
					expect(waiting.status).toBe("wait");
					if (waiting.status === "wait" && blocked.status === "blocked") {
						expect(waiting.waitMs).toBeGreaterThanOrEqual(
							blocked.blockedUntilMs - blocked.observedAtMs - 50,
						);
					}
				}),
			),
		);

		test.effect("keeps a blocked waiter's ticket through a block longer than its lease", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { declaration } = yield* usePolicy();
					const service = yield* makeAdmission({ ticketLeaseMs: 200 });
					const waiter = ticket("waiter", "user:a");
					yield* service.register(declaration, waiter);
					yield* service.block(declaration, 600);
					const waiting = yield* service.poll(declaration, waiter);
					expect(waiting.status === "wait" && waiting.waitMs).toBeGreaterThanOrEqual(500);
					yield* Effect.sleep(400);

					expect(yield* service.register(declaration, ticket("other", "user:b"))).toEqual({
						status: "registered",
					});
					expect(yield* service.poll(declaration, waiter)).toMatchObject({ status: "wait" });
					yield* Effect.sleep(250);
					expect(yield* service.poll(declaration, waiter)).toMatchObject({ status: "granted" });
				}),
			),
		);

		test.effect("keeps the block and spacing anchor on a hash change and invalidates tickets", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { state, client, declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					const [first, stale, fresh] = [
						ticket("t-1", "user:a"),
						ticket("t-2", "user:b"),
						ticket("t-3", "user:c"),
					];
					yield* service.register(declaration, first);
					const nonce = yield* grantNonce(yield* service.poll(declaration, first));
					yield* service.claim(declaration, first, nonce);
					yield* service.block(declaration, 5_000);
					yield* service.register(declaration, stale);
					const anchor = yield* stateField(client, state.state, "a");
					const blockedUntil = yield* stateField(client, state.state, "b");
					const changed = { ...declaration, hash: "declaration-v2" };

					expect(yield* service.register(changed, fresh)).toEqual({ status: "registered" });
					expect(yield* stateField(client, state.state, "a")).toBe(anchor);
					expect(yield* stateField(client, state.state, "b")).toBe(blockedUntil);
					expect(yield* service.poll(declaration, stale)).toEqual({ status: "unknown" });
					expect(yield* service.poll(changed, stale)).toEqual({ status: "unknown" });
					expect(yield* service.register(changed, stale)).toEqual({ status: "registered" });
					expect(yield* ticketCount(client, state.tickets)).toBe(2);
				}),
			),
		);

		test.effect("expires cancelled and abandoned tickets within one lease", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { state, client, declaration } = yield* usePolicy();
					const service = yield* makeAdmission({ ticketLeaseMs: 200 });
					const [cancelled, abandoned, later] = [
						ticket("cancelled", "user:a"),
						ticket("abandoned", "user:b"),
						ticket("later", "user:c"),
					];
					yield* registerAll([service], declaration, [cancelled, abandoned]);
					yield* service.cancel(declaration, cancelled);
					expect(yield* call(() => client.hkeys(state.tickets))).toEqual(["abandoned"]);
					yield* Effect.sleep(250);

					yield* service.register(declaration, later);

					expect(yield* call(() => client.hkeys(state.tickets))).toEqual(["later"]);
					expect(yield* call(() => client.lrange(state.interactiveTenants, 0, -1))).toEqual([
						"user%3Ac",
					]);
					expect(yield* service.poll(declaration, abandoned)).toEqual({ status: "unknown" });
				}),
			),
		);

		test.effect("cleans more than one scan of stale tickets boundedly and retries", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { state, client, declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					yield* registerAll(
						[service],
						declaration,
						range(40).map((n) => ticket(`stale-${n}`, "user:a")),
					);
					const changed = { ...declaration, hash: "declaration-v2" };
					const caller = ticket("caller", "user:b");
					yield* service.register(changed, caller);

					const statuses = [];
					const counts = [];
					for (let attempt = 0; attempt < 4; attempt += 1) {
						statuses.push((yield* service.poll(changed, caller)).status);
						counts.push(yield* ticketCount(client, state.tickets));
					}

					expect(statuses).toEqual(["retry", "retry", "granted", "granted"]);
					expect(counts).toEqual([25, 9, 1, 1]);
				}),
			),
		);

		test.effect("fails a corrupt ticket or policy closed without refreshing its TTL", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { state, client, declaration } = yield* usePolicy();
					const service = yield* makeAdmission();
					const [broken, healthy] = [ticket("broken", "user:a"), ticket("healthy", "user:b")];
					yield* registerAll([service], declaration, [broken, healthy]);
					yield* call(() => client.hset(state.tickets, "broken", "{not json"));
					yield* call(() => client.pexpire(state.tickets, 5_000));
					const corrupt = new ProviderHttpAdmissionCorruptState({
						message: "Redis admission state is corrupt",
					});

					assertExitFails(yield* Effect.exit(service.poll(declaration, broken)), corrupt);
					expect(yield* call(() => client.pttl(state.tickets))).toBeLessThanOrEqual(5_000);
					expect(yield* service.poll(declaration, healthy)).toMatchObject({ status: "granted" });
					expect(yield* service.poll(declaration, broken)).toEqual({ status: "unknown" });

					yield* call(() => client.hset(state.state, "a", "not-a-number"));
					yield* call(() => client.pexpire(state.state, 5_000));
					assertExitFails(
						yield* Effect.exit(service.register(declaration, ticket("next", "user:c"))),
						corrupt,
					);
					assertExitFails(yield* Effect.exit(service.poll(declaration, healthy)), corrupt);
					assertExitFails(yield* Effect.exit(service.block(declaration, 1_000)), corrupt);
					expect(yield* call(() => client.pttl(state.state))).toBeLessThanOrEqual(5_000);
				}),
			),
		);

		test.effect("caps an honoured Retry-After at one hour", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const { declaration } = yield* usePolicy();
					const service = yield* makeAdmission();

					assertExitFails(
						yield* Effect.exit(
							service.block(declaration, PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs + 1),
						),
						new ProviderHttpAdmissionCorruptState({
							message: "Provider HTTP admission block delay is invalid",
						}),
					);
					const blocked = yield* service.block(
						declaration,
						PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs,
					);
					expect(
						blocked.status === "blocked" && blocked.blockedUntilMs - blocked.observedAtMs,
					).toBe(PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs);
				}),
			),
		);

		test.effect(
			"re-registers waiters whose tickets expired while every instance was down and keeps the schedule",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const { state, client, declaration } = yield* usePolicy({
							requests: 1,
							intervalMs: 400,
						});
						const before = yield* makeAdmission({ ticketLeaseMs: 300 });
						const [first, waiter] = [ticket("first", "user:a"), ticket("waiter", "user:b")];
						yield* registerAll([before], declaration, [first, waiter]);
						const nonce = yield* grantNonce(yield* before.poll(declaration, first));
						yield* before.claim(declaration, first, nonce);
						yield* before.block(declaration, 600);
						expect(yield* before.poll(declaration, waiter)).toMatchObject({ status: "wait" });
						const anchor = yield* stateField(client, state.state, "a");
						const blockedUntil = yield* stateField(client, state.state, "b");
						yield* Effect.sleep(Math.max(0, blockedUntil + 350 - (yield* Clock.currentTimeMillis)));

						const after = yield* makeAdmission({ ticketLeaseMs: 300 });
						expect(yield* after.poll(declaration, waiter)).toEqual({ status: "unknown" });
						expect(yield* stateField(client, state.state, "a")).toBe(anchor);
						expect(yield* stateField(client, state.state, "b")).toBe(blockedUntil);
						expect(yield* after.register(declaration, waiter)).toEqual({ status: "registered" });
						const admitted = yield* admitAll([after], declaration, [waiter]);

						expect(admitted.map(({ id }) => id)).toEqual(["waiter"]);
						const claimedAt = yield* stateField(client, state.state, "a");
						expect(claimedAt).toBeGreaterThanOrEqual(Math.max(anchor + 400, blockedUntil));
					}),
				),
		);

		test.effect("refuses registration at the policy and system tenant limits without writing", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const service = yield* makeAdmission();
					const system = yield* usePolicy();
					yield* registerAll(
						[service],
						system.declaration,
						range(PROVIDER_HTTP_TICKET_LIMITS.systemTenant).map((n) => ticket(`s-${n}`, "system")),
					);
					const systemBefore = yield* snapshot(system.client, system.keys);
					expect(
						yield* service.register(system.declaration, ticket("s-over", "system")),
					).toMatchObject({ status: "overloaded" });
					expect(yield* snapshot(system.client, system.keys)).toEqual(systemBefore);

					const full = yield* usePolicy();
					const perTenant = PROVIDER_HTTP_TICKET_LIMITS.tenant;
					yield* registerAll(
						[service],
						full.declaration,
						range(PROVIDER_HTTP_TICKET_LIMITS.policy).map((n) =>
							ticket(`p-${n}`, `user:${Math.floor(n / perTenant)}`),
						),
					);
					const fullBefore = yield* snapshot(full.client, full.keys);
					expect(
						yield* service.register(full.declaration, ticket("p-over", "user:other")),
					).toMatchObject({ status: "overloaded" });
					expect(yield* snapshot(full.client, full.keys)).toEqual(fullBefore);
					expect(yield* ticketCount(full.client, full.state.tickets)).toBe(
						PROVIDER_HTTP_TICKET_LIMITS.policy,
					);
				}),
			),
		);

		test.effect("reports an unreachable Redis as unavailable", () =>
			Effect.gen(function* () {
				const offline = new Redis(testRedisUrl(), { lazyConnect: true, enableOfflineQueue: false });
				const service = yield* makeAdmission().pipe(
					Effect.provideService(RedisService, makeRedisService({ client: offline })),
				);
				const error = yield* Effect.flip(
					service.register(
						{ requests: 1, intervalMs: 1_000, key: "unreachable", hash: "declaration-v1" },
						ticket("t", "user:a"),
					),
				);
				expect(error).toBeInstanceOf(ProviderHttpAdmissionUnavailable);
			}),
		);
	});
});

const invalidResponses = [
	{ response: ["corrupt"], message: "Redis admission state is corrupt" },
	{ response: ["granted", "", "0", ""], message: "Redis returned an empty grant nonce" },
	{
		response: ["granted", "1-1", "1e3", ""],
		message: "Redis returned an invalid ticket wait timestamp",
	},
	{
		response: ["wait", "10", "elsewhere"],
		message: "Redis returned an invalid admission response",
	},
	{ response: ["admitted", "extra"], message: "Redis returned an invalid admission response" },
	{ response: { status: "granted" }, message: "Redis returned an invalid admission response" },
	{ response: ["registered"], message: "Redis returned an unexpected poll response" },
];

layer(Layer.empty)((test) => {
	test.effect("strictly validates Lua replies", () =>
		Effect.gen(function* () {
			for (const { message, response } of invalidResponses) {
				const client = Object.assign(Object.create(null), {
					eval: () => Promise.resolve(response),
				}) satisfies Client;
				const service = yield* makeAdmission().pipe(
					Effect.provideService(RedisService, makeRedisService({ client })),
				);
				const exit = yield* Effect.exit(
					service.poll(
						{ requests: 1, key: "replies", intervalMs: 1_000, hash: "declaration-v1" },
						ticket("t", "user:a"),
					),
				);
				assertExitFails(exit, new ProviderHttpAdmissionCorruptState({ message }));
			}
		}),
	);
});
