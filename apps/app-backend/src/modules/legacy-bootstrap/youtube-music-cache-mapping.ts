import { Effect, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { encodePersistentClaimEnvelope } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";
import { PluginLoader } from "#modules/plugins/loader";
import { findActiveScriptInPluginSnapshot } from "#modules/plugins/runtime-resolver";

import { buildReportSql, withReservedConnection } from "./shared";

const pluginSlug = "media";
const scriptSlug = "integration.youtube-music";

const CacheRow = Schema.Struct({
	userId: Schema.String,
	songId: Schema.String,
	completed: Schema.Boolean,
	listenedOn: Schema.String,
	expiresAtMs: Schema.Finite,
});

const IntegrationRow = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
});

const decodeCacheRows = Schema.decodeUnknownEffect(Schema.Array(CacheRow));
const decodeIntegrationRows = Schema.decodeUnknownEffect(Schema.Array(IntegrationRow));

const cacheRowsSql = `
SELECT
	("key"::jsonb->'YoutubeMusicSongListened'->>'user_id') AS "userId",
	("key"::jsonb->'YoutubeMusicSongListened'->'input'->>'id') AS "songId",
	("value"->>'YoutubeMusicSongListened')::boolean AS "completed",
	("key"::jsonb->'YoutubeMusicSongListened'->'input'->>'listened_on') AS "listenedOn",
	extract(epoch FROM "expires_at")::double precision * 1000 AS "expiresAtMs"
FROM "application_cache"
WHERE
	"expires_at" > clock_timestamp()
	AND "key"::jsonb ? 'YoutubeMusicSongListened'
ORDER BY "userId", "songId", "listenedOn";
`;

const integrationRowsSql = `
SELECT "id", "user_id" AS "userId"
FROM "integration"
WHERE "provider" = 'youtube_music'
ORDER BY "user_id", "id";
`;

export const migrateYoutubeMusicCache = Effect.gen(function* () {
	const loader = yield* PluginLoader;
	const redis = yield* RedisService;
	const [rawCacheRows, rawIntegrationRows] = yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			const cacheRows = yield* connection.execute(cacheRowsSql, [], undefined);
			const integrationRows = yield* connection.execute(integrationRowsSql, [], undefined);
			return [cacheRows, integrationRows] as const;
		}),
	);
	const cacheRows = yield* Effect.orDie(decodeCacheRows(rawCacheRows));
	const integrationRows = yield* Effect.orDie(decodeIntegrationRows(rawIntegrationRows));

	let keysCreated = 0;
	if (cacheRows.length > 0 && integrationRows.length > 0) {
		const persistentClaimEnvelope = yield* encodePersistentClaimEnvelope({
			value: true,
			owner: null,
		}).pipe(Effect.orDie);
		const script = yield* findActiveScriptInPluginSnapshot(loader.getSnapshot(), {
			pluginSlug,
			scriptSlug,
		});
		if (!script) {
			return yield* Effect.die(
				new Error(`Active sandbox script not found: ${pluginSlug}/${scriptSlug}`),
			);
		}

		const integrationIdsByUserId = Map.groupBy(integrationRows, ({ userId }) => userId);
		const redisWrites = cacheRows.flatMap((row) =>
			(integrationIdsByUserId.get(row.userId) ?? []).flatMap(({ id: integrationId }) => {
				const key = `${integrationId}:${row.songId}:${row.listenedOn}`;
				const keys = [
					{
						expiresAtMs: row.expiresAtMs,
						key: redisKeys.sandboxCache(row.userId, script.id, `${key}:seen`),
					},
				];
				if (row.completed) {
					keys.push({
						expiresAtMs: row.expiresAtMs,
						key: redisKeys.sandboxCache(row.userId, script.id, `${key}:completed`),
					});
				}
				return keys;
			}),
		);

		yield* Effect.forEach(
			redisWrites,
			({ expiresAtMs, key }) => {
				const ttlSeconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
				if (ttlSeconds <= 0) {
					return Effect.void;
				}
				return Effect.tryPromise(() =>
					redis.client.set(key, persistentClaimEnvelope, "EX", ttlSeconds, "NX"),
				).pipe(
					Effect.tap((result) => Effect.sync(() => (keysCreated += result === null ? 0 : 1))),
					Effect.orDie,
				);
			},
			{ concurrency: 20 },
		);
	}

	yield* withReservedConnection((connection) =>
		connection.executeRaw(
			`DO $$ DECLARE started_at timestamptz := clock_timestamp(); cache_rows int := ${cacheRows.length}; keys_created int := ${keysCreated}; BEGIN
				${buildReportSql("application_cache -> YouTube Music persistent cache", [
					{ message: "unexpired cache row(s) found", count: "cache_rows" },
					{ message: "persistent Redis key(s) created", count: "keys_created" },
				])}
			END $$;`,
			[],
		),
	);
	return undefined;
});
