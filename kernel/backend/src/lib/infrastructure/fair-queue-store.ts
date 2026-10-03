import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	Cause,
	Clock,
	Deferred,
	Duration,
	Effect,
	Exit,
	Latch,
	Layer,
	Predicate,
	Schedule,
	Schema,
} from "effect";
import { PersistedQueue } from "effect/persistence";

import { RedisService } from "./redis";
import { recordDurableQueueDispatch } from "./runtime-metrics";

export const FairQueueFlow = Schema.Struct({
	lane: ExecutionLane,
	tenant: Schema.String,
	plugin: Schema.String,
});
export type FairQueueFlow = typeof FairQueueFlow.Type;

export type FairQueueOptions = {
	readonly prefix: string;
	readonly pollInterval: Duration.Input;
	readonly lockExpiration?: Duration.Input;
	readonly lockRefreshInterval?: Duration.Input;
	/** Per-process limits: `total` runs at once, of which at most `background` are background. */
	readonly capacity: { readonly total: number; readonly background: number };
	readonly flowOf: (element: unknown) => Effect.Effect<FairQueueFlow, Schema.SchemaError>;
};

const BACKGROUND_STARVATION_LIMIT = 4;
const DISPATCHER_RETRY_SPACING_MS = 500;
const interactive = "interactive" satisfies ExecutionLane;
const background = "background" satisfies ExecutionLane;
// Mirrors the tag the persisted queue factory puts on a take that fails to decode its element.
const DEAD_LETTER_TAG = "~effect/persistence/PersistedQueue/DeadLetter";

const StoredPayload = Schema.fromJsonString(
	Schema.Struct({ id: Schema.String, element: Schema.Unknown }),
);
const StoredFlow = Schema.fromJsonString(
	Schema.Struct({ ...FairQueueFlow.fields, offeredAt: Schema.Finite }),
);
const TakeResponse = Schema.NullOr(
	Schema.Tuple([Schema.String, Schema.Int, Schema.String, Schema.Literals([0, 1])]),
);
const encodePayload = Schema.encodeUnknownEffect(StoredPayload);
const encodeFlow = Schema.encodeUnknownEffect(StoredFlow);
const decodePayload = Schema.decodeUnknownEffect(StoredPayload);
const decodeFlow = Schema.decodeUnknownEffect(StoredFlow);
const decodeTakeResponse = Schema.decodeUnknownEffect(TakeResponse);

// Ring members and key segments are percent-encoded so a tenant or plugin cannot alias another key.
const luaPrelude = `
local function tenants_key(base, lane) return base .. ":tenants:" .. lane end
local function plugins_key(base, lane, tenant) return base .. ":plugins:" .. lane .. ":" .. tenant end
local function flow_key(base, lane, tenant, plugin)
  return base .. ":flow:" .. lane .. ":" .. tenant .. ":" .. plugin .. ":fifo"
end
local function lock_key(base, id) return base .. ":" .. id .. ":lock" end

-- A late acknowledgement must not touch an item a sweep already returned or a peer now holds.
local function owns(key_pending, key_lock, id, worker_id)
  if redis.call("SISMEMBER", key_pending, id) == 0 then
    return false
  end
  local holder = redis.call("GET", key_lock)
  return not holder or holder == worker_id
end

-- A plugin is in its tenant's ring, and a tenant in its lane's ring, exactly while it has ready items.
local function enqueue(base, flow, id, at_head)
  local key = flow_key(base, flow.lane, flow.tenant, flow.plugin)
  local length
  if at_head then
    length = redis.call("LPUSH", key, id)
  else
    length = redis.call("RPUSH", key, id)
  end
  if length == 1 then
    if redis.call("RPUSH", plugins_key(base, flow.lane, flow.tenant), flow.plugin) == 1 then
      redis.call("RPUSH", tenants_key(base, flow.lane), flow.tenant)
    end
  end
end

local function pop(base, lane)
  local tenants = tenants_key(base, lane)
  local tenant = redis.call("LPOP", tenants)
  if not tenant then
    return nil
  end
  local plugins = plugins_key(base, lane, tenant)
  local plugin = redis.call("LPOP", plugins)
  local fifo = flow_key(base, lane, tenant, plugin)
  local id = redis.call("LPOP", fifo)
  if redis.call("LLEN", fifo) > 0 then
    redis.call("RPUSH", plugins, plugin)
  end
  if redis.call("LLEN", plugins) > 0 then
    redis.call("RPUSH", tenants, tenant)
  end
  return id
end
`;

const offerScript = `${luaPrelude}
local key_items = KEYS[1]
local key_flows = KEYS[2]
local key_ids = KEYS[3]
local base = ARGV[1]
local id = ARGV[2]
local payload = ARGV[3]
local flow = ARGV[4]
local custom_id = ARGV[5]

-- park the dedupe entry outside the timeToLive trim range until the element completes
if custom_id == "1" and redis.call("ZADD", key_ids, "NX", "+inf", id) == 0 then
  return 0
end
redis.call("HSET", key_items, id, payload)
redis.call("HSET", key_flows, id, flow)
enqueue(base, cjson.decode(flow), id, false)
return 1
`;

const takeScript = `${luaPrelude}
local key_delayed = KEYS[1]
local key_items = KEYS[2]
local key_flows = KEYS[3]
local key_pending = KEYS[4]
local key_attempts = KEYS[5]
local base = ARGV[1]
local worker_id = ARGV[2]
local now = ARGV[3]
local pttl = ARGV[4]
local probe_lane = ARGV[5]

local due = redis.call("ZRANGEBYSCORE", key_delayed, "-inf", now, "LIMIT", 0, 100)
if #due > 0 then
  for i = #due, 1, -1 do
    enqueue(base, cjson.decode(redis.call("HGET", key_flows, due[i])), due[i], true)
  end
  redis.call("ZREM", key_delayed, unpack(due))
end

local probe_ready = 0
if redis.call("LLEN", tenants_key(base, probe_lane)) > 0 then
  probe_ready = 1
end

for index = 6, #ARGV do
  local lane = ARGV[index]
  while true do
    local id = pop(base, lane)
    if not id then
      break
    end
    local payload = redis.call("HGET", key_items, id)
    if payload then
      redis.call("SET", lock_key(base, id), worker_id, "PX", pttl)
      redis.call("SADD", key_pending, id)
      local attempts = redis.call("HINCRBY", key_attempts, id, 1)
      return { payload, attempts, redis.call("HGET", key_flows, id), probe_ready }
    end
  end
end
return false
`;

const completeScript = `${luaPrelude}
local key_pending = KEYS[1]
local key_lock = KEYS[2]
local key_attempts = KEYS[3]
local key_ids = KEYS[4]
local key_items = KEYS[5]
local key_flows = KEYS[6]
local id = ARGV[1]
local now = ARGV[2]
local worker_id = ARGV[3]

if not owns(key_pending, key_lock, id, worker_id) then
  return 0
end
redis.call("DEL", key_lock)
redis.call("SREM", key_pending, id)
redis.call("HDEL", key_attempts, id)
redis.call("HDEL", key_items, id)
redis.call("HDEL", key_flows, id)
redis.call("ZADD", key_ids, "XX", now, id)
`;

const failScript = `${luaPrelude}
local key_pending = KEYS[1]
local key_lock = KEYS[2]
local key_failed = KEYS[3]
local key_attempts = KEYS[4]
local key_ids = KEYS[5]
local key_items = KEYS[6]
local key_flows = KEYS[7]
local id = ARGV[1]
local record = ARGV[2]
local worker_id = ARGV[3]

if not owns(key_pending, key_lock, id, worker_id) then
  return 0
end
redis.call("DEL", key_lock)
redis.call("SREM", key_pending, id)
redis.call("HDEL", key_attempts, id)
redis.call("HDEL", key_items, id)
redis.call("HDEL", key_flows, id)
redis.call("RPUSH", key_failed, record)
-- failed ids keep their dedupe entry until failedTimeToLive removes the dead-letter record
redis.call("ZADD", key_ids, "XX", "+inf", id)
`;

const retryScript = `${luaPrelude}
local key_pending = KEYS[1]
local key_lock = KEYS[2]
local key_delayed = KEYS[3]
local id = ARGV[1]
local visible_at = ARGV[2]
local worker_id = ARGV[3]

if not owns(key_pending, key_lock, id, worker_id) then
  return 0
end
redis.call("DEL", key_lock)
redis.call("SREM", key_pending, id)
redis.call("ZADD", key_delayed, visible_at, id)
`;

const requeueScript = `${luaPrelude}
local key_pending = KEYS[1]
local key_lock = KEYS[2]
local key_attempts = KEYS[3]
local key_flows = KEYS[4]
local base = ARGV[1]
local id = ARGV[2]
local worker_id = ARGV[3]

if not owns(key_pending, key_lock, id, worker_id) then
  return 0
end
redis.call("DEL", key_lock)
redis.call("SREM", key_pending, id)
if redis.call("HINCRBY", key_attempts, id, -1) <= 0 then
  redis.call("HDEL", key_attempts, id)
end
enqueue(base, cjson.decode(redis.call("HGET", key_flows, id)), id, true)
`;

const sweepScript = `${luaPrelude}
local key_items = KEYS[1]
local key_flows = KEYS[2]
local key_pending = KEYS[3]
local key_attempts = KEYS[4]
local key_failed = KEYS[5]
local key_ids = KEYS[6]
local base = ARGV[1]
local max_attempts = tonumber(ARGV[2])
local now = ARGV[3]

for _, id in ipairs(redis.call("SMEMBERS", key_pending)) do
  if redis.call("EXISTS", lock_key(base, id)) == 0 then
    local attempts = tonumber(redis.call("HGET", key_attempts, id) or "0")
    local payload = redis.call("HGET", key_items, id)
    local flow = redis.call("HGET", key_flows, id)
    redis.call("SREM", key_pending, id)
    if attempts >= max_attempts then
      -- compose the failed record by hand so the element payload does not go through cjson
      redis.call("RPUSH", key_failed, string.sub(payload, 1, -2) .. ',"attempts":' .. attempts ..
        ',"lastFailure":"Lock expired after final attempt","failedAt":' .. now .. '}')
      redis.call("HDEL", key_attempts, id)
      redis.call("HDEL", key_items, id)
      redis.call("HDEL", key_flows, id)
      redis.call("ZADD", key_ids, "XX", "+inf", id)
    else
      enqueue(base, cjson.decode(flow), id, true)
    end
  end
end
`;

const expireAllScript = `
local ttl = ARGV[1]
for _, key in ipairs(KEYS) do
  redis.call("PEXPIRE", key, ttl)
end
`;

const trimFailedBatchSize = 1000;

const trimFailedScript = `
local key_failed = KEYS[1]
local key_ids = KEYS[2]
local cutoff = tonumber(ARGV[1])
local removed = 0

while removed < ${trimFailedBatchSize} do
  local head = redis.call("LINDEX", key_failed, 0)
  if not head then break end
  local ok, decoded = pcall(cjson.decode, head)
  if ok then
    local failed_at = tonumber(decoded.failedAt)
    if failed_at ~= nil and failed_at >= cutoff then break end
    redis.call("LPOP", key_failed)
    if decoded.id ~= nil then
      redis.call("ZREM", key_ids, decoded.id)
    end
  else
    -- a corrupt head would otherwise block trimming of the whole list
    redis.call("LPOP", key_failed)
  end
  removed = removed + 1
end

return removed
`;

export const fairQueueKeys = (prefix: string, name: string) => {
	const base = `${prefix}${name}`;
	return {
		base,
		ids: `${base}:ids`,
		items: `${base}:items`,
		flows: `${base}:flows`,
		failed: `${base}:failed`,
		pending: `${base}:pending`,
		delayed: `${base}:delayed`,
		attempts: `${base}:attempts`,
		lock: (id: string) => `${base}:${id}:lock`,
	};
};

const ackRetrySchedule = (lockExpiration: Duration.Input) =>
	Schedule.min([Schedule.exponential(200, 1.5), Schedule.spaced(5000)]).pipe(
		Schedule.upTo({ duration: lockExpiration }),
	);

const hasDeadLetter = (cause: Cause.Cause<unknown>) =>
	cause.reasons.some(
		(reason) => Cause.isFailReason(reason) && Predicate.isTagged(reason.error, DEAD_LETTER_TAG),
	);

const decodeTaken = Effect.fn("FairQueueStore.decodeTaken")(function* (response: unknown) {
	const tuple = yield* decodeTakeResponse(response);
	if (tuple === null) {
		return null;
	}
	const [payload, attempts, flow, backgroundReady] = tuple;
	const { id, element } = yield* decodePayload(payload);
	return { id, payload, element, attempts, backgroundReady, flow: yield* decodeFlow(flow) };
});
type Taken = NonNullable<Effect.Success<ReturnType<typeof decodeTaken>>>;

type Taker = { item: Taken | undefined; readonly deferred: Deferred.Deferred<Taken> };

type QueueState = {
	starved: number;
	maxAttempts: number;
	readonly kick: Latch.Latch;
	readonly takers: Array<Taker>;
	readonly inflight: Record<ExecutionLane, number>;
};

const redisCall = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (cause) =>
			new PersistedQueue.PersistedQueueError({ cause, message: "Fair queue Redis command failed" }),
	});

export const makeFairQueueStore = Effect.fnUntraced(function* (options: FairQueueOptions) {
	const { client } = yield* RedisService;
	const scope = yield* Effect.scope;
	const pollInterval = Duration.max(
		Duration.fromInputUnsafe(options.pollInterval),
		Duration.millis(1),
	);
	const lockRefreshMillis = Math.max(
		options.lockRefreshInterval
			? Duration.toMillis(Duration.fromInputUnsafe(options.lockRefreshInterval))
			: 30_000,
		1,
	);
	const lockExpirationMillis = Math.max(
		options.lockExpiration
			? Duration.toMillis(Duration.fromInputUnsafe(options.lockExpiration))
			: 90_000,
		1,
	);
	const workerId = crypto.randomUUID();
	const retryAck = ackRetrySchedule(lockExpirationMillis);
	const states = new Map<string, QueueState>();
	const activeLocks = new Set<string>();

	const command = (
		script: string,
		keys: ReadonlyArray<string>,
		args: ReadonlyArray<string | number>,
	) => redisCall(() => client.eval(script, keys.length, ...keys, ...args));

	const acknowledge = <A, E>(effect: Effect.Effect<A, E>) =>
		effect.pipe(Effect.retry(retryAck), Effect.orDie);

	const resilient = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.tapCause(Effect.logWarning),
			Effect.sandbox,
			Effect.retry(Schedule.spaced(DISPATCHER_RETRY_SPACING_MS)),
			Effect.forkIn(scope),
		);

	const requeue = (name: string, taken: Taken) => {
		const keys = fairQueueKeys(options.prefix, name);
		return command(
			requeueScript,
			[keys.pending, keys.lock(taken.id), keys.attempts, keys.flows],
			[keys.base, taken.id, workerId],
		);
	};

	const release = (state: QueueState, lane: ExecutionLane) =>
		Effect.sync(() => {
			state.inflight[lane] -= 1;
			state.kick.openUnsafe();
		});

	const allowedLanes = (state: QueueState): ReadonlyArray<ExecutionLane> => {
		const { inflight } = state;
		if (
			state.takers.length === 0 ||
			inflight.interactive + inflight.background >= options.capacity.total
		) {
			return [];
		}
		if (inflight.background >= options.capacity.background) {
			return [interactive];
		}
		return inflight.background === 0 && state.starved >= BACKGROUND_STARVATION_LIMIT
			? [background, interactive]
			: [interactive, background];
	};

	const handOff = (name: string, state: QueueState, taken: Taken) => {
		const taker = state.takers.shift();
		if (taker === undefined) {
			return acknowledge(requeue(name, taken));
		}
		const { lane } = taken.flow;
		if (lane === background) {
			state.starved = 0;
		} else if (taken.backgroundReady === 1 && state.inflight.background === 0) {
			state.starved += 1;
		}
		state.inflight[lane] += 1;
		taker.item = taken;
		Deferred.doneUnsafe(taker.deferred, Exit.succeed(taken));
		return Effect.void;
	};

	const dispatchOnce = Effect.fnUntraced(function* (name: string, state: QueueState) {
		const keys = fairQueueKeys(options.prefix, name);
		state.kick.closeUnsafe();
		const lanes = allowedLanes(state);
		if (lanes.length === 0) {
			yield* state.kick.await;
			return;
		}
		const now = yield* Clock.currentTimeMillis;
		const response = yield* command(
			takeScript,
			[keys.delayed, keys.items, keys.flows, keys.pending, keys.attempts],
			[keys.base, workerId, now, lockExpirationMillis, background, ...lanes],
		);
		const taken = yield* decodeTaken(response);
		if (taken === null) {
			yield* Effect.race(Effect.sleep(pollInterval), state.kick.await);
			return;
		}
		yield* handOff(name, state, taken);
	});

	const sweepExpiredLocks = Effect.fnUntraced(function* (name: string, state: QueueState) {
		const keys = fairQueueKeys(options.prefix, name);
		const now = yield* Clock.currentTimeMillis;
		yield* command(
			sweepScript,
			[keys.items, keys.flows, keys.pending, keys.attempts, keys.failed, keys.ids],
			[keys.base, state.maxAttempts, now],
		);
	});

	const queueFor = (name: string, maxAttempts: number) =>
		Effect.suspend(() => {
			const existing = states.get(name);
			if (existing !== undefined) {
				existing.maxAttempts = maxAttempts;
				return Effect.succeed(existing);
			}
			const state: QueueState = {
				starved: 0,
				takers: [],
				maxAttempts,
				kick: Latch.makeUnsafe(false),
				inflight: { background: 0, interactive: 0 },
			};
			states.set(name, state);
			return Effect.all(
				[
					resilient(Effect.forever(dispatchOnce(name, state))),
					resilient(
						Effect.suspend(() => sweepExpiredLocks(name, state)).pipe(
							Effect.andThen(Effect.sleep(lockRefreshMillis)),
							Effect.forever,
						),
					),
				],
				{ discard: true },
			).pipe(Effect.as(state));
		});

	yield* Effect.suspend(() =>
		command(expireAllScript, Array.from(activeLocks), [lockExpirationMillis]),
	).pipe(
		Effect.ignore,
		Effect.andThen(Effect.sleep(lockRefreshMillis)),
		Effect.forever,
		Effect.forkIn(scope),
	);

	const scanKeys = Effect.fnUntraced(function* (pattern: string) {
		const found: Array<string> = [];
		let cursor = "0";
		do {
			const [next, batch] = yield* redisCall(() =>
				client.scan(cursor, "MATCH", pattern, "COUNT", 100),
			);
			cursor = next;
			found.push(...batch);
		} while (cursor !== "0");
		return found;
	});

	const store = PersistedQueue.PersistedQueueStore.of({
		offer: Effect.fn("FairQueueStore.offer")(
			function* ({ id, name, element, isCustomId }) {
				const flow = yield* options.flowOf(element);
				const now = yield* Clock.currentTimeMillis;
				const payload = yield* encodePayload({ id, element });
				const storedFlow = yield* encodeFlow({
					...flow,
					offeredAt: now,
					tenant: encodeURIComponent(flow.tenant),
					plugin: encodeURIComponent(flow.plugin),
				});
				const keys = fairQueueKeys(options.prefix, name);
				yield* command(
					offerScript,
					[keys.items, keys.flows, keys.ids],
					[keys.base, id, payload, storedFlow, isCustomId ? "1" : "0"],
				);
				states.get(name)?.kick.openUnsafe();
			},
			Effect.mapError((cause) =>
				cause instanceof PersistedQueue.PersistedQueueError
					? cause
					: new PersistedQueue.PersistedQueueError({
							cause,
							message: "Failed to offer element to persisted queue",
						}),
			),
		),
		cleanup: Effect.fn("FairQueueStore.cleanup")(function* ({ timeToLive, failedTimeToLive }) {
			const now = yield* Clock.currentTimeMillis;
			const idsKeys = yield* scanKeys(`${options.prefix}*:ids`);
			const cutoff = now - Duration.toMillis(timeToLive);
			yield* Effect.forEach(
				idsKeys,
				(key) => redisCall(() => client.zremrangebyscore(key, "-inf", `(${cutoff}`)),
				{ discard: true, concurrency: 16 },
			);
			if (failedTimeToLive !== undefined) {
				const failedCutoff = now - Duration.toMillis(failedTimeToLive);
				const failedKeys = yield* scanKeys(`${options.prefix}*:failed`);
				yield* Effect.forEach(
					failedKeys,
					(key) =>
						command(
							trimFailedScript,
							[key, `${key.slice(0, -":failed".length)}:ids`],
							[failedCutoff],
						).pipe(Effect.repeat({ while: (removed) => Number(removed) >= trimFailedBatchSize })),
					{ discard: true, concurrency: 16 },
				);
			}
		}),
		take: ({ name, retryDelay, maxAttempts }) =>
			Effect.uninterruptibleMask((restore) =>
				Effect.gen(function* () {
					const state = yield* queueFor(name, maxAttempts);
					const keys = fairQueueKeys(options.prefix, name);
					const taker: Taker = { item: undefined, deferred: Deferred.makeUnsafe<Taken>() };
					state.takers.push(taker);
					state.kick.openUnsafe();
					const taken = yield* restore(Deferred.await(taker.deferred)).pipe(
						Effect.onInterrupt(() =>
							Effect.suspend(() => {
								const { item } = taker;
								if (item === undefined) {
									state.takers.splice(state.takers.indexOf(taker), 1);
									return Effect.void;
								}
								return acknowledge(requeue(name, item)).pipe(
									Effect.ensuring(release(state, item.flow.lane)),
								);
							}),
						),
					);
					const lock = keys.lock(taken.id);
					activeLocks.add(lock);
					const { lane } = taken.flow;
					yield* Effect.addFinalizer((exit) =>
						Effect.gen(function* () {
							const now = yield* Clock.currentTimeMillis;
							const failElement = (cause: Cause.Cause<unknown>) =>
								command(
									failScript,
									[
										keys.pending,
										lock,
										keys.failed,
										keys.attempts,
										keys.ids,
										keys.items,
										keys.flows,
									],
									[
										taken.id,
										JSON.stringify({
											id: taken.id,
											failedAt: now,
											element: taken.element,
											attempts: taken.attempts,
											lastFailure: Cause.pretty(cause),
										}),
										workerId,
									],
								);
							if (Exit.isSuccess(exit)) {
								return yield* command(
									completeScript,
									[keys.pending, lock, keys.attempts, keys.ids, keys.items, keys.flows],
									[taken.id, now, workerId],
								);
							}
							if (hasDeadLetter(exit.cause)) {
								return yield* failElement(exit.cause);
							}
							if (Cause.hasInterruptsOnly(exit.cause)) {
								return yield* requeue(name, taken);
							}
							if (taken.attempts >= maxAttempts) {
								return yield* failElement(exit.cause);
							}
							const delay = yield* retryDelay(taken.attempts);
							return yield* command(
								retryScript,
								[keys.pending, lock, keys.delayed],
								[taken.id, now + Duration.toMillis(delay), workerId],
							);
						}).pipe(
							acknowledge,
							Effect.ensuring(
								Effect.suspend(() => {
									activeLocks.delete(lock);
									return release(state, lane);
								}),
							),
						),
					);
					yield* recordDurableQueueDispatch({
						lane,
						waitMs:
							taken.attempts === 1
								? Math.max(0, (yield* Clock.currentTimeMillis) - taken.flow.offeredAt)
								: undefined,
					});
					return { id: taken.id, element: taken.element, attempts: taken.attempts };
				}),
			),
	});

	return {
		store,
		inflight: (name: string) => ({
			background: states.get(name)?.inflight.background ?? 0,
			interactive: states.get(name)?.inflight.interactive ?? 0,
		}),
	};
});

export const fairQueueStoreLayer = (options: FairQueueOptions) =>
	Layer.effect(
		PersistedQueue.PersistedQueueStore,
		Effect.map(makeFairQueueStore(options), ({ store }) => store),
	);
