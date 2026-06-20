import { Effect, Schema } from "effect";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { encodePersistentClaimEnvelope } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";

import { buildReportSql, withReservedConnection } from "./shared";

const reportPhase = "application_cache -> integration progress persistent cache";

const consumedOnByLegacyProvider = new Map([
	["Audiobookshelf", ""],
	["Emby", "emby"],
	["Jellyfin", "jellyfin_sink"],
	["Kodi", "kodi"],
	["Komga", "komga"],
	["Plex", "plex_sink"],
	["Youtube Music", "youtube_music"],
]);

const LegacyProgressCacheRow = Schema.Struct({
	cacheId: Schema.String,
	userId: Schema.String,
	entityId: Schema.NullOr(Schema.String),
	animeEpisode: Schema.NullOr(Schema.String),
	mangaChapter: Schema.NullOr(Schema.String),
	mangaVolume: Schema.NullOr(Schema.String),
	expiresAtMs: Schema.Finite,
	providersConsumedOn: Schema.NullOr(Schema.Array(Schema.String)),
	validValue: Schema.Boolean,
});

export type LegacyProgressCacheRow = typeof LegacyProgressCacheRow.Type;

const decodeLegacyProgressCacheRows = Schema.decodeUnknownEffect(
	Schema.Array(LegacyProgressCacheRow),
);

const cacheRowsSql = `
WITH parsed AS (
	SELECT
		ac."id"::text AS cache_id,
		ac."expires_at",
		ac."value" ? 'MetadataProgressUpdateCompletedCache' AS valid_value,
		ac."key"::jsonb->'MetadataProgressUpdateCompletedCache' AS root
	FROM "application_cache" ac
	WHERE
		ac."expires_at" > clock_timestamp()
		AND ac."key"::jsonb ? 'MetadataProgressUpdateCompletedCache'
), cache_rows AS (
	SELECT
		cache_id,
		expires_at,
		valid_value,
		root->>'user_id' AS user_id,
		root->'input'->>'metadata_id' AS metadata_id,
		root->'input'->'common' AS common
	FROM parsed
)
SELECT
	cr.cache_id AS "cacheId",
	cr.user_id AS "userId",
	CASE
		WHEN e."entity_schema_slug" = 'show' THEN show_episode.entity_id
		WHEN e."entity_schema_slug" = 'podcast' THEN podcast_episode.entity_id
		ELSE e."id"
	END AS "entityId",
	cr.common->>'anime_episode_number' AS "animeEpisode",
	cr.common->>'manga_chapter_number' AS "mangaChapter",
	cr.common->>'manga_volume_number' AS "mangaVolume",
	extract(epoch FROM cr.expires_at)::double precision * 1000 AS "expiresAtMs",
	cr.common->'providers_consumed_on' AS "providersConsumedOn",
	cr.valid_value AS "validValue"
FROM cache_rows cr
LEFT JOIN "entity" e ON e."id" = cr.metadata_id
LEFT JOIN _legacy_show_episode_resolution show_episode
	ON e."entity_schema_slug" = 'show'
	AND show_episode.parent_entity_id = cr.metadata_id
	AND show_episode.season_number = cr.common->>'show_season_number'
	AND show_episode.episode_number = cr.common->>'show_episode_number'
LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
	ON e."entity_schema_slug" = 'podcast'
	AND podcast_episode.parent_entity_id = cr.metadata_id
	AND podcast_episode.episode_number = cr.common->>'podcast_episode_number'
ORDER BY cr.user_id, cr.metadata_id, cr.cache_id;
`;

export const readLegacyIntegrationProgressCache = Effect.fn("readLegacyIntegrationProgressCache")(
	function* (connection: SqlConnection.Connection) {
		const rows = yield* connection.execute(cacheRowsSql, [], undefined);
		return yield* Effect.orDie(decodeLegacyProgressCacheRows(rows));
	},
);

const integerFingerprintPart = (key: string, value: string | null) => {
	if (value === null) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		throw new Error(`Invalid legacy integration progress ${key}: ${value}`);
	}
	return `${key}=${String(parsed)}`;
};

const numberFingerprintPart = (key: string, value: string | null) => {
	if (value === null) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid legacy integration progress ${key}: ${value}`);
	}
	return `${key}=${String(parsed)}`;
};

export const migrateIntegrationProgressCache = (input: {
	cacheRows: ReadonlyArray<LegacyProgressCacheRow>;
	installationIdsByUserId: ReadonlyMap<string, string>;
	scriptId: string;
}) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const claimsByIdentity = new Map<
			string,
			{ expiresAtMs: number; fingerprint: string; userId: string }
		>();
		let unresolvedRows = 0;
		let unsupportedProviderRows = 0;

		for (const row of input.cacheRows) {
			if (!input.installationIdsByUserId.has(row.userId)) {
				return yield* Effect.die(
					new Error(
						`Missing resolved media installation for integration progress cache owner: ${row.userId}`,
					),
				);
			}
			if (!row.validValue) {
				return yield* Effect.die(
					new Error(`Invalid legacy integration progress cache value: ${row.cacheId}`),
				);
			}
			if (row.entityId === null) {
				unresolvedRows += 1;
				continue;
			}
			const [legacyProvider] = row.providersConsumedOn ?? [];
			if (row.providersConsumedOn?.length !== 1 || legacyProvider === undefined) {
				unsupportedProviderRows += 1;
				continue;
			}
			const consumedOn = consumedOnByLegacyProvider.get(legacyProvider);
			if (consumedOn === undefined) {
				unsupportedProviderRows += 1;
				continue;
			}

			const parts = [
				integerFingerprintPart("animeEpisode", row.animeEpisode),
				integerFingerprintPart("mangaVolume", row.mangaVolume),
				numberFingerprintPart("mangaChapter", row.mangaChapter),
			].filter((part) => part !== null);
			const fingerprint = `${row.entityId}|progress|${consumedOn}|${parts.join(",")}`;
			const identity = `${row.userId}\u0000${fingerprint}`;
			const existing = claimsByIdentity.get(identity);
			if (!existing || existing.expiresAtMs < row.expiresAtMs) {
				claimsByIdentity.set(identity, {
					expiresAtMs: row.expiresAtMs,
					fingerprint,
					userId: row.userId,
				});
			}
		}

		const duplicateRows =
			input.cacheRows.length - unsupportedProviderRows - unresolvedRows - claimsByIdentity.size;
		let keysCreated = 0;
		if (claimsByIdentity.size > 0) {
			const persistentClaimEnvelope = yield* encodePersistentClaimEnvelope({
				value: true,
				owner: null,
			}).pipe(Effect.orDie);

			yield* Effect.forEach(
				claimsByIdentity.values(),
				({ expiresAtMs, fingerprint, userId }) => {
					const ttlSeconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
					if (ttlSeconds <= 0) {
						return Effect.void;
					}
					const key = redisKeys.sandboxCache(userId, input.scriptId, fingerprint);
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

		const reportEntries = [
			{ message: "unexpired completed marker row(s) found", count: "cache_rows" },
			{ message: "distinct persistent claim(s) resolved", count: "resolved_claims" },
			{ message: "duplicate claim row(s) collapsed", count: "duplicate_rows" },
			{ message: "persistent Redis key(s) created", count: "keys_created" },
			...(unsupportedProviderRows > 0
				? [
						{
							level: "warning" as const,
							count: "unsupported_provider_rows",
							message:
								"cache row(s) skipped because their provider identity cannot be mapped to V2",
						},
					]
				: []),
			...(unresolvedRows > 0
				? [
						{
							level: "warning" as const,
							count: "unresolved_rows",
							message: "cache row(s) skipped because their target entity could not be resolved",
						},
					]
				: []),
		];
		yield* withReservedConnection((connection) =>
			connection.executeRaw(
				`DO $$ DECLARE
					started_at timestamptz := clock_timestamp();
					cache_rows int := ${input.cacheRows.length};
					resolved_claims int := ${claimsByIdentity.size};
					duplicate_rows int := ${duplicateRows};
					keys_created int := ${keysCreated};
					unsupported_provider_rows int := ${unsupportedProviderRows};
					unresolved_rows int := ${unresolvedRows};
				BEGIN
					${buildReportSql(reportPhase, reportEntries)}
				END $$;`,
				[],
			),
		);
		return undefined;
	});
