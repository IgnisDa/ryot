import {
	encodePersistentClaimEnvelope,
	sandboxPersistentCacheKey,
} from "@ryot-app/kernel-backend/modules/scripts/host/runtime-host-functions";
import { TransientValues } from "@ryot-app/kernel-backend/platform/transient-values";
import { Duration, Effect, Schema } from "effect";

import { buildReportSql, quoteSqlString, withReservedConnection } from "./shared";

const CacheRow = Schema.Struct({
	userId: Schema.String,
	songId: Schema.String,
	completed: Schema.Boolean,
	listenedOn: Schema.String,
	expiresAtMs: Schema.Finite,
});

const IntegrationRow = Schema.Struct({ id: Schema.String, userId: Schema.String });

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

const integrationRowsSql = (installationIds: ReadonlyArray<string>) => `
SELECT "id", "user_id" AS "userId"
FROM "integration"
WHERE "provider" = 'youtube_music'
	AND "plugin_installation_id" IN (${installationIds.map(quoteSqlString).join(", ") || "NULL"})
ORDER BY "user_id", "id";
`;

export const migrateYoutubeMusicCache = (input: {
	pluginId: string;
	scriptSlug: string;
	installationIds: ReadonlyArray<string>;
}) =>
	Effect.gen(function* () {
		const values = yield* TransientValues;
		const [rawCacheRows, rawIntegrationRows] = yield* withReservedConnection((connection) =>
			Effect.gen(function* () {
				const cacheRows = yield* connection.execute(cacheRowsSql, [], undefined);
				const integrationRows = yield* connection.execute(
					integrationRowsSql(input.installationIds),
					[],
					undefined,
				);
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
			const integrationIdsByUserId = Map.groupBy(integrationRows, ({ userId }) => userId);
			const cacheWrites = cacheRows.flatMap((row) =>
				(integrationIdsByUserId.get(row.userId) ?? []).flatMap(({ id: integrationId }) => {
					const key = `${integrationId}:${row.songId}:${row.listenedOn}`;
					const keys = [
						{
							expiresAtMs: row.expiresAtMs,
							key: sandboxPersistentCacheKey(
								row.userId,
								["plugin", input.pluginId],
								["script", input.scriptSlug],
								`${key}:seen`,
							),
						},
					];
					if (row.completed) {
						keys.push({
							expiresAtMs: row.expiresAtMs,
							key: sandboxPersistentCacheKey(
								row.userId,
								["plugin", input.pluginId],
								["script", input.scriptSlug],
								`${key}:completed`,
							),
						});
					}
					return keys;
				}),
			);

			yield* Effect.forEach(
				cacheWrites,
				({ key, expiresAtMs }) => {
					const ttlSeconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
					if (ttlSeconds <= 0) {
						return Effect.void;
					}
					return values
						.setIfAbsent(key, persistentClaimEnvelope, Duration.seconds(ttlSeconds))
						.pipe(
							Effect.orDie,
							Effect.tap((stored) => Effect.sync(() => (keysCreated += stored ? 1 : 0))),
						);
				},
				{ concurrency: 20 },
			);
		}

		yield* withReservedConnection((connection) =>
			connection.executeRaw(
				`DO $$ DECLARE started_at timestamptz := clock_timestamp(); cache_rows int := ${cacheRows.length}; keys_created int := ${keysCreated}; BEGIN
				${buildReportSql("application_cache -> YouTube Music persistent cache", [
					{ count: "cache_rows", message: "unexpired cache row(s) found" },
					{ count: "keys_created", message: "persistent cache value(s) created" },
				])}
			END $$;`,
				[],
			),
		);
		return undefined;
	});
