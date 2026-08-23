import { PreparedClientPageIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import Redis from "ioredis";

import { AppConfig } from "./config/service";

export const CLIENT_PAGE_SESSION_TTL_SECONDS = 900;
export const ENTITY_INTEREST_SESSION_TTL_SECONDS = 15 * 60;
export const ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS = 30;
export const IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS = 24 * 60 * 60;
export const IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS = 24 * 60 * 60;
export const PROVIDER_SEARCH_OPTIONS_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS = 5 * 60;

export const ImportSourceState = Schema.Struct({
	source: Schema.String,
	pluginId: Schema.String,
	workflowScriptId: SandboxScriptId,
	pluginInstallationId: Schema.String,
	uploadIntentIds: Schema.Array(Schema.String),
	sourcePayload: Schema.Record(Schema.String, jsonValueSchema),
	namedArtifactPaths: Schema.Record(Schema.String, Schema.String),
});

export type ImportSourceState = typeof ImportSourceState.Type;

export const ImportSourceStateFromJson = Schema.fromJsonString(ImportSourceState);

const ClientPageSessionPayload = strictStruct({
	userId: UserId,
	identity: PreparedClientPageIdentity,
});

export const ClientPageSessionPayloadFromJson = Schema.fromJsonString(ClientPageSessionPayload);

export const hashClientPageSessionToken = sha256Hex;

export const redisKeys = {
	entityUpdatedChannel: "ryot:entity:updated",
	pluginRegistryChannel: "ryot:plugins:registry",
	uploadIntentExpiry: "ryot:upload:intents:expiry",
	pluginCatalogUserChannel: "ryot:plugins:catalog:user",
	uploadToken: (token: string) => `ryot:upload:token:${token}`,
	uploadIntent: (intentId: string) => `ryot:upload:intent:${intentId}`,
	godModePendingReset: (email: string) => `ryot:god-mode:pending:${email}`,
	uploadIntentLock: (intentId: string) => `ryot:upload:intent-lock:${intentId}`,
	importAdapterResult: (runId: string) => `ryot:imports:adapter-result:${runId}`,
	importSourceState: (stateId: string) => `ryot:imports:source-state:${stateId}`,
	clientPageSession: (sessionId: string) => `ryot:client-pages:session:${sessionId}`,
	godModeResetChannel: (correlationId: string) => `ryot:god-mode:reset:${correlationId}`,
	entityInterestSession: (sessionId: string) => `ryot:entity-interest:session:${sessionId}`,
	sandboxWorkflowJournal: (executionId: string) => `ryot:sandbox:workflow:${executionId}:journal`,
	entityInterestSessions: (entityId: string) => `ryot:entity-interest:entity:${entityId}:sessions`,
	entityInterestProgressionLease: (entityId: string) => `ryot:entity-interest:progress:${entityId}`,
	entityInterestSessionEntities: (sessionId: string) =>
		`ryot:entity-interest:session:${sessionId}:entities`,
	integrationCache: (integrationId: string, key: string) =>
		`ryot:integrations:cache:${integrationId}:${key}`,
	providerHttpAdmission: (policyKey: string) =>
		`ryot:provider-http-admission:${encodeURIComponent(policyKey)}`,
	importSourceStateClaim: (stateId: string, claimId: string) =>
		`ryot:imports:source-state:${stateId}:claim:${claimId}`,
	providerSearchOptions: (providerId: string, scriptId: string) =>
		`ryot:provider:search-options:${providerId}:${scriptId}`,
	sandboxCache: (userId: string | null, scriptId: string, key: string) =>
		`ryot:sandbox:cache:${userId === null ? "kernel" : `user:${userId}`}:${scriptId}:${key}`,
	sandboxRunCache: (serverRunId: string, userId: string | null, scriptId: string, key: string) =>
		`ryot:sandbox:cache:run:${serverRunId}:${userId === null ? "kernel" : `user:${userId}`}:${scriptId}:${key}`,
};

export class RedisService extends Context.Service<RedisService>()("RedisService", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const client = new Redis(Redacted.value(config.redisUrl), {
			lazyConnect: true,
			maxRetriesPerRequest: 3,
		});
		yield* Effect.tryPromise(() => client.connect()).pipe(Effect.orDie);
		yield* Effect.addFinalizer(() => Effect.promise(() => client.quit()).pipe(Effect.orDie));

		return {
			client,
			get: (key: string) => Effect.tryPromise(() => client.get(key)).pipe(Effect.orDie),
			del: (...keys: ReadonlyArray<string>) =>
				Effect.tryPromise(() => client.del(...keys)).pipe(Effect.orDie),
			publish: (channel: string, message: string) =>
				Effect.tryPromise(() => client.publish(channel, message)).pipe(Effect.orDie),
			zadd: (key: string, score: number, member: string) =>
				Effect.tryPromise(() => client.zadd(key, score, member)).pipe(Effect.asVoid, Effect.orDie),
			zrem: (key: string, ...members: ReadonlyArray<string>) =>
				Effect.tryPromise(() => client.zrem(key, ...members)).pipe(Effect.asVoid, Effect.orDie),
			zrangeByScore: (key: string, max: number, limit: number) =>
				Effect.tryPromise(() => client.zrangebyscore(key, 0, max, "LIMIT", 0, limit)).pipe(
					Effect.orDie,
				),
			set: (key: string, value: string, ttlSeconds?: number) =>
				Effect.tryPromise(() =>
					ttlSeconds ? client.set(key, value, "EX", ttlSeconds) : client.set(key, value),
				).pipe(Effect.asVoid, Effect.orDie),
			setAndRemoveFromIndex: (key: string, value: string, indexKey: string, member: string) =>
				Effect.tryPromise(() => client.multi().set(key, value).zrem(indexKey, member).exec()).pipe(
					Effect.asVoid,
					Effect.orDie,
				),
			setAndIndex: (key: string, value: string, indexKey: string, score: number, member: string) =>
				Effect.tryPromise(() =>
					client.multi().set(key, value).zadd(indexKey, score, member).exec(),
				).pipe(Effect.asVoid, Effect.orDie),
			releaseLease: (key: string, owner: string) =>
				Effect.tryPromise(() =>
					client.eval(
						"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
						1,
						key,
						owner,
					),
				).pipe(Effect.asVoid, Effect.orDie),
			acquireLease: (key: string, ttlSeconds: number) =>
				Effect.gen(function* () {
					const owner = crypto.randomUUID();
					const result = yield* Effect.tryPromise(() =>
						client.set(key, owner, "EX", ttlSeconds, "NX"),
					);
					return result === null ? null : owner;
				}).pipe(Effect.orDie),
			setAndIndexAndDelete: (
				key: string,
				value: string,
				indexKey: string,
				score: number,
				member: string,
				deleteKey: string,
			) =>
				Effect.tryPromise(() =>
					client.multi().set(key, value).zadd(indexKey, score, member).del(deleteKey).exec(),
				).pipe(Effect.asVoid, Effect.orDie),
			renewLease: (key: string, owner: string, ttlSeconds: number) =>
				Effect.tryPromise(() =>
					client.eval(
						"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
						1,
						key,
						owner,
						String(ttlSeconds),
					),
				).pipe(
					Effect.map((result) => result === 1),
					Effect.orDie,
				),
			setAndIndexAndSet: (
				key: string,
				value: string,
				indexKey: string,
				score: number,
				member: string,
				secondaryKey: string,
				secondaryValue: string,
				secondaryTtlSeconds: number,
			) =>
				Effect.tryPromise(() =>
					client
						.multi()
						.set(key, value)
						.zadd(indexKey, score, member)
						.set(secondaryKey, secondaryValue, "EX", secondaryTtlSeconds)
						.exec(),
				).pipe(Effect.asVoid, Effect.orDie),
			claim: (key: string, claimKey: string, ttlSeconds: number) =>
				Effect.tryPromise(() =>
					client.eval(
						"local claimed = redis.call('get', KEYS[2]); if claimed then return claimed end; local pending = redis.call('get', KEYS[1]); if not pending then return false end; redis.call('set', KEYS[2], pending, 'EX', ARGV[1]); redis.call('del', KEYS[1]); return pending",
						2,
						key,
						claimKey,
						String(ttlSeconds),
					),
				).pipe(
					Effect.map((value) => (typeof value === "string" ? value : null)),
					Effect.orDie,
				),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
