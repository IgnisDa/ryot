import type { MigrationReportDetail } from "@ryot-app/contract/modules/god-mode/migration-report";
import { redisKeys, RedisService } from "@ryot-app/kernel-backend/lib/infrastructure/redis";
import { encodePersistentClaimEnvelope } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/runtime-host-functions";
import { Effect, Schema } from "effect";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import { buildReportSql, insertAnomalyReport, withReservedConnection } from "./shared";

const reportPhase = "application_cache -> integration progress persistent cache";

const targetByLegacyProvider = new Map([
	["Audiobookshelf", { consumedOn: "", provider: "audiobookshelf" }],
	["Emby", { provider: "emby", consumedOn: "emby" }],
	["Jellyfin", { provider: "jellyfin_sink", consumedOn: "jellyfin_sink" }],
	["Kodi", { provider: "kodi", consumedOn: "kodi" }],
	["Komga", { provider: "komga", consumedOn: "komga" }],
	["Plex", { provider: "plex_sink", consumedOn: "plex_sink" }],
	["Youtube Music", { provider: "youtube_music", consumedOn: "youtube_music" }],
]);

const LegacyProgressCacheRow = Schema.Struct({
	userId: Schema.String,
	cacheId: Schema.String,
	expiresAtMs: Schema.Finite,
	validValue: Schema.Boolean,
	entityId: Schema.NullOr(Schema.String),
	parentName: Schema.NullOr(Schema.String),
	metadataId: Schema.NullOr(Schema.String),
	showSeason: Schema.NullOr(Schema.String),
	mangaVolume: Schema.NullOr(Schema.String),
	animeEpisode: Schema.NullOr(Schema.String),
	mangaChapter: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.NullOr(Schema.String),
	requestedEpisode: Schema.NullOr(Schema.String),
	providersConsumedOn: Schema.NullOr(Schema.Array(Schema.String)),
});

export type LegacyProgressCacheRow = typeof LegacyProgressCacheRow.Type;

const decodeLegacyProgressCacheRows = Schema.decodeUnknownEffect(
	Schema.Array(LegacyProgressCacheRow),
);

export const integrationProgressCacheRowsSql = `
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
	cr.metadata_id AS "metadataId",
	e."name" AS "parentName",
	cr.common->>'show_season_number' AS "showSeason",
	COALESCE(cr.common->>'show_episode_number', cr.common->>'podcast_episode_number') AS "requestedEpisode",
	CASE
		WHEN e."entity_schema_slug" = 'show' THEN show_episode.entity_id
		WHEN e."entity_schema_slug" = 'podcast' THEN podcast_episode.entity_id
		ELSE e."id"
	END AS "entityId",
	CASE
		WHEN e."entity_schema_slug" = 'show' THEN 'show-episode'
		WHEN e."entity_schema_slug" = 'podcast' THEN 'podcast-episode'
		ELSE e."entity_schema_slug"
	END AS "entitySchemaSlug",
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
		const rows = yield* connection.execute(integrationProgressCacheRowsSql, [], undefined);
		return yield* Effect.orDie(decodeLegacyProgressCacheRows(rows));
	},
);

const integerFingerprintPart = (key: string, value: string | null) => {
	if (value === null) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		throw new Error(
			`application_cache -> integration progress persistent cache: legacy progress field "${key}" holds ${JSON.stringify(value)}, which is not a number, so the claim fingerprint cannot be built. Fix or delete that cache row in the V1 database, then start the server again.`,
		);
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
	integrations: ReadonlyArray<{ id: string; provider: string; userId: string }>;
	installationIdsByUserId: ReadonlyMap<string, string>;
	scriptId: string;
}) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const { claimsByIdentity, unresolvedDetails, unsupportedProviderDetails } =
			resolveIntegrationProgressClaims(input);
		const duplicateRows =
			input.cacheRows.length -
			unsupportedProviderDetails.length -
			unresolvedDetails.length -
			claimsByIdentity.size;
		let keysCreated = 0;
		if (claimsByIdentity.size > 0) {
			const persistentClaimEnvelope = yield* encodePersistentClaimEnvelope({
				value: true,
				owner: null,
			}).pipe(Effect.orDie);

			yield* Effect.forEach(
				claimsByIdentity.values(),
				({ userId, claimKey, expiresAtMs }) => {
					const ttlSeconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
					if (ttlSeconds <= 0) {
						return Effect.void;
					}
					const key = redisKeys.sandboxCache(userId, input.scriptId, claimKey);
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
			{ count: "cache_rows", message: "unexpired completed marker row(s) found" },
			{ count: "resolved_claims", message: "distinct persistent claim(s) resolved" },
			{ count: "duplicate_rows", message: "duplicate claim row(s) collapsed" },
			{ count: "keys_created", message: "persistent Redis key(s) created" },
		];
		yield* withReservedConnection((connection) =>
			connection.executeRaw(
				`DO $$ DECLARE
					started_at timestamptz := clock_timestamp();
					cache_rows int := ${input.cacheRows.length};
					resolved_claims int := ${claimsByIdentity.size};
					duplicate_rows int := ${duplicateRows};
					keys_created int := ${keysCreated};
				BEGIN
					${buildReportSql(reportPhase, reportEntries)}
				END $$;`,
				[],
			),
		);

		// Dropping a debounce marker loses no watch history: the marker only suppressed a repeat
		// report, so the integration re-reports the item on its next run.
		if (unsupportedProviderDetails.length > 0) {
			yield* withReservedConnection((connection) =>
				insertAnomalyReport(connection, {
					phase: reportPhase,
					elapsedSeconds: null,
					details: unsupportedProviderDetails,
					count: unsupportedProviderDetails.length,
					code: "integration-cache-provider-unmapped",
					message:
						"Some in-flight integration progress markers were dropped because their legacy service did not resolve to exactly one migrated integration. No watch history was lost - these markers only stopped an item being reported twice, and each integration will report the item again on its next run.",
				}),
			);
		}

		if (unresolvedDetails.length > 0) {
			yield* withReservedConnection((connection) =>
				insertAnomalyReport(connection, {
					phase: reportPhase,
					elapsedSeconds: null,
					details: unresolvedDetails,
					count: unresolvedDetails.length,
					code: "integration-cache-entity-unresolved",
					message:
						"Some in-flight integration progress markers were dropped because the item they point at was not migrated, so there is nothing in V2 to attach them to. No watch history was lost - these markers only stopped an item being reported twice, and each integration will report the item again on its next run.",
				}),
			);
		}

		return undefined;
	});

export const resolveIntegrationProgressClaims = (input: {
	cacheRows: ReadonlyArray<LegacyProgressCacheRow>;
	integrations: ReadonlyArray<{ id: string; provider: string; userId: string }>;
	installationIdsByUserId: ReadonlyMap<string, string>;
}) => {
	const claimsByIdentity = new Map<
		string,
		{ claimKey: string; expiresAtMs: number; userId: string }
	>();
	const unresolvedDetails: MigrationReportDetail[] = [];
	const unsupportedProviderDetails: MigrationReportDetail[] = [];

	for (const row of input.cacheRows) {
		if (!input.installationIdsByUserId.has(row.userId)) {
			throw new Error(
				`application_cache -> integration progress persistent cache: user ${row.userId} owns a cache row but has no ready media plugin installation, so there is nothing in V2 to attach the claim to. Installations are created earlier in this same run, so this is a defect in this migration. Keep the dump and report it; retrying will not change the result.`,
			);
		}
		if (!row.validValue) {
			throw new Error(
				`application_cache -> integration progress persistent cache: cache row ${row.cacheId} does not hold a completed-marker value, so this migration cannot tell what it recorded. Delete that cache row in the V1 database, then start the server again.`,
			);
		}
		if (row.entityId === null || row.entitySchemaSlug === null) {
			unresolvedDetails.push({
				userId: row.userId,
				legacyCacheId: row.cacheId,
				parentName: row.parentName,
				requestedSeason: row.showSeason,
				legacyMetadataId: row.metadataId,
				requestedEpisode: row.requestedEpisode,
				code: "integration-cache-entity-unresolved",
			});
			continue;
		}
		const [legacyProvider] = row.providersConsumedOn ?? [];
		if (row.providersConsumedOn?.length !== 1 || legacyProvider === undefined) {
			unsupportedProviderDetails.push({
				userId: row.userId,
				legacyCacheId: row.cacheId,
				legacyProvider: legacyProvider ?? null,
				code: "integration-cache-provider-unmapped",
				providersConsumedOn: row.providersConsumedOn ?? [],
			});
			continue;
		}
		const target = targetByLegacyProvider.get(legacyProvider);
		const integrations = target
			? input.integrations.filter(
					(integration) =>
						integration.userId === row.userId && integration.provider === target.provider,
				)
			: [];
		const integration = integrations[0];
		if (!target || integrations.length !== 1 || !integration) {
			unsupportedProviderDetails.push({
				legacyProvider,
				userId: row.userId,
				legacyCacheId: row.cacheId,
				code: "integration-cache-provider-unmapped",
				providersConsumedOn: row.providersConsumedOn,
			});
			continue;
		}

		const parts = [
			integerFingerprintPart("animeEpisode", row.animeEpisode),
			integerFingerprintPart("mangaVolume", row.mangaVolume),
			numberFingerprintPart("mangaChapter", row.mangaChapter),
		].filter((part) => part !== null);
		const claimKey = JSON.stringify([
			"media.integration-progress.v1",
			integration.id,
			row.entityId,
			row.entitySchemaSlug,
			"progress",
			target.consumedOn,
			parts.join(","),
		]);
		const identity = `${row.userId}\u0000${claimKey}`;
		const existing = claimsByIdentity.get(identity);
		if (!existing || existing.expiresAtMs < row.expiresAtMs) {
			claimsByIdentity.set(identity, {
				claimKey,
				userId: row.userId,
				expiresAtMs: row.expiresAtMs,
			});
		}
	}
	return { claimsByIdentity, unresolvedDetails, unsupportedProviderDetails };
};
