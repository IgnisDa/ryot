import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "@ryot-app/kernel-backend/lib/property-schema/property-schema-runtime";
import { bootstrapNewUser } from "@ryot-app/kernel-backend/modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "@ryot-app/kernel-backend/modules/user-bootstrap/plugin-dispatch";
import { Clock, Effect } from "effect";

import {
	buildCollectionEntityMigrationSql,
	buildCollectionToEntityRelationshipMigrationSql,
	buildMonitoringCollectionMigrationSql,
	buildOwnedCollectionOwnershipMigrationSql,
} from "./collection-mapping";
import { buildLegacyEpisodicSubEntityMigrationSql } from "./episodic-sub-entity-mapping";
import {
	buildExerciseMigrationSql,
	exerciseEntityTargets,
	getInvalidExerciseGithubOwnership,
	getUnsupportedExerciseLots,
	getUnsupportedExerciseSources,
} from "./exercise-mapping";
import { buildIntegrationMigrationSql, readLegacyIntegrationSettings } from "./integration-mapping";
import {
	migrateIntegrationProgressCache,
	readLegacyIntegrationProgressCache,
} from "./integration-progress-cache-mapping";
import { buildLegacyS3AssetReportSql, migrateLegacyS3Assets } from "./legacy-asset-migration";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";
import {
	buildMetadataGroupEntityMigrationSql,
	buildMetadataGroupRelationshipMigrationSql,
	getUnsupportedMetadataGroupSources,
	metadataGroupEntityTargets,
	metadataGroupRelationshipTargets,
} from "./metadata-group-mapping";
import {
	buildMetadataMigrationSql,
	buildMetadataToMetadataRelationshipMigrationSql,
	getUnsupportedMetadataSources,
} from "./metadata-mapping";
import { metadataMigrationTargets } from "./metadata-mapping-targets";
import {
	buildUniqueLotEntitySchemaSlugMap,
	buildLegacyPackageResolution,
	requireEventSchema,
	requireInstallation,
	requireMapped,
	requireSchema,
	resolveEntityMigrationTargets,
	resolveRelationshipMigrationTargets,
} from "./migration-resolution";
import { buildNotificationPlatformMigrationSql } from "./notification-platform-mapping";
import {
	buildCompanyEntityMigrationSql,
	buildCompanyRelationshipMigrationSql,
	buildGroupPersonRelationshipMigrationSql,
	buildPersonEntityMigrationSql,
	buildPersonRelationshipMigrationSql,
	companyEntityTargets,
	getUnsupportedPersonSources,
	personEntityTargets,
} from "./person-mapping";
import { buildReviewMigrationSql } from "./review-mapping";
import { buildLegacySavedViewStateMigrationSql } from "./saved-view-mapping";
import { buildSeenEpisodicCompletionMigrationSql } from "./seen-completion-mapping";
import { buildSeenMigrationSql } from "./seen-mapping";
import {
	buildReferencedGlobalEntityIdsSql,
	getLatestReportSequence,
	legacyBootstrapGate,
	logReportRows,
	withReservedConnection,
} from "./shared";
import {
	buildLegacyUserAuthMigrationSql,
	buildLegacyUserLibraryMigrationSql,
} from "./user-auth-mapping";
import { buildMeasurementMigrationSql } from "./user-measurement-mapping";
import { buildUserToEntityInLibraryMigrationSql } from "./user-to-entity-mapping";
import {
	buildWorkoutMigrationSql,
	buildWorkoutRepeatedFromRelationshipMigrationSql,
	buildWorkoutSetEventMigrationSql,
	buildWorkoutTemplateMigrationSql,
	buildWorkoutToTemplateRelationshipMigrationSql,
} from "./workout-mapping";
import { migrateYoutubeMusicCache } from "./youtube-music-cache-mapping";

export const migrateLegacyTables = Effect.gen(function* () {
	const gate = yield* legacyBootstrapGate;
	const startedAtMs = yield* Clock.currentTimeMillis;
	if (!gate) {
		return yield* Effect.void;
	}

	let reportSequence = yield* withReservedConnection(getLatestReportSequence);
	const migratedUserRows = yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			yield* connection.executeRaw(buildLegacyUserAuthMigrationSql(), []);
			const rows: ReadonlyArray<{ id: string }> = yield* connection.execute(
				`SELECT "id" FROM "old_user" ORDER BY "created_on", "id"`,
				[],
				undefined,
			);
			return rows;
		}),
	);
	const userIds = migratedUserRows.map(({ id }) => id);
	const resolution = yield* buildLegacyPackageResolution(userIds);
	const mediaPluginId = resolution.mediaPluginId;
	const fitnessPluginId = resolution.fitnessPluginId;
	const entitySchema = (pluginId: string | null, slug: string) =>
		requireSchema(resolution.entitySchemas, pluginId, slug, "entity schema");
	const relationshipSchema = (pluginId: string | null, slug: string) =>
		requireSchema(resolution.relationshipSchemas, pluginId, slug, "relationship schema");
	const metadataEntitySchemaSlugByLot = buildUniqueLotEntitySchemaSlugMap(
		metadataMigrationTargets.map(({ lot, entitySchemaSlug }) => ({ lot, entitySchemaSlug })),
	);
	const resolvedMetadataTargets = resolveEntityMigrationTargets(
		metadataMigrationTargets,
		resolution,
		mediaPluginId,
	);
	const resolvedMetadataGroupEntityTargets = resolveEntityMigrationTargets(
		metadataGroupEntityTargets,
		resolution,
		mediaPluginId,
	);
	const resolvedMetadataGroupRelationshipTargets = metadataGroupRelationshipTargets.map(
		(target) => {
			const resolved = relationshipSchema(mediaPluginId, target.relationshipSchemaSlug);
			return {
				lot: target.lot,
				relationshipSchemaPluginId: resolved.pluginId,
				relationshipSchemaSlug: resolved.slug,
			};
		},
	);
	const resolvedPersonEntityTargets = resolveEntityMigrationTargets(
		personEntityTargets,
		resolution,
		mediaPluginId,
	);
	const resolvedCompanyEntityTargets = resolveEntityMigrationTargets(
		companyEntityTargets,
		resolution,
		mediaPluginId,
	);
	const resolvedPersonRelationshipTargets = resolveRelationshipMigrationTargets({
		pluginId: mediaPluginId,
		resolution,
		sourceEntitySchemaSlug: "person",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
	});
	const resolvedCompanyRelationshipTargets = resolveRelationshipMigrationTargets({
		pluginId: mediaPluginId,
		resolution,
		sourceEntitySchemaSlug: "company",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
	});
	const resolvedGroupPersonRelationshipTargets = [
		{ lot: "music", slug: "person-to-music-group" },
		{ lot: "video_game", slug: "person-to-video-game-group" },
	].map(({ lot, slug }) => {
		const resolved = relationshipSchema(mediaPluginId, slug);
		return {
			lot,
			relationshipSchemaPluginId: resolved.pluginId,
			relationshipSchemaSlug: resolved.slug,
		};
	});
	const collectionEntitySchema = entitySchema(null, "collection");
	const libraryEntitySchema = entitySchema(mediaPluginId, "library");
	const memberOfRelationshipSchema = relationshipSchema(null, "member-of");
	const inLibraryRelationshipSchema = relationshipSchema(mediaPluginId, "in-library");
	const collectionsSavedView = requireSchema(
		resolution.savedViews,
		null,
		"collections",
		"saved view",
	);
	const addEntityToCollectionEventSchema = requireEventSchema(
		resolution,
		null,
		"collection",
		"add-entity-to-collection",
	);
	const measurementEntitySchema = entitySchema(fitnessPluginId, "measurement");
	const workoutEntitySchema = entitySchema(fitnessPluginId, "workout");
	const workoutTemplateEntitySchema = entitySchema(fitnessPluginId, "workout-template");
	const workoutSetEventSchema = requireEventSchema(
		resolution,
		fitnessPluginId,
		"exercise",
		"workout-set",
	);
	const workoutToWorkoutTemplateRelationshipSchema = relationshipSchema(
		fitnessPluginId,
		"workout-to-workout-template",
	);
	const workoutRepeatedFromRelationshipSchema = relationshipSchema(
		fitnessPluginId,
		"workout-repeated-from",
	);
	const mediaMonitoringRelationshipSchema = relationshipSchema(mediaPluginId, "media-monitoring");
	const monitorableEntitySchemaSlugs = ["company", "person", ...builtinMediaEntitySchemaSlugs].map(
		(slug) => entitySchema(mediaPluginId, slug).slug,
	);
	const showSeasonEntitySchema = entitySchema(mediaPluginId, "show-season");
	const showEpisodeEntitySchema = entitySchema(mediaPluginId, "show-episode");
	const podcastEpisodeEntitySchema = entitySchema(mediaPluginId, "podcast-episode");
	const showToSeasonRelationshipSchema = relationshipSchema(mediaPluginId, "show-to-show-season");
	const seasonToEpisodeRelationshipSchema = relationshipSchema(
		mediaPluginId,
		"show-season-to-show-episode",
	);
	const podcastToEpisodeRelationshipSchema = relationshipSchema(
		mediaPluginId,
		"podcast-to-podcast-episode",
	);
	const integrationProviderSlugs = [
		"audiobookshelf",
		"komga",
		"plex_yank",
		"youtube_music",
		"kodi",
		"emby",
		"plex_sink",
		"jellyfin_sink",
		"ryot_browser_extension",
		"radarr",
		"sonarr",
		"jellyfin_push",
	] as const;
	for (const slug of integrationProviderSlugs) {
		requireMapped(resolution.integrationProviders, mediaPluginId, slug, "integration provider");
	}
	const mediaInstallations = migratedUserRows.map(({ id: userId }) => ({
		userId,
		installationId: requireInstallation(resolution, userId, mediaPluginId),
	}));
	const mediaInstallationIdsByUserId = new Map(
		mediaInstallations.map(({ installationId, userId }) => [userId, installationId]),
	);
	const integrationProgressScript = requireMapped(
		resolution.scripts,
		mediaPluginId,
		"trigger.integration-progress-policy",
		"script",
	);
	const youtubeMusicScript = requireMapped(
		resolution.scripts,
		mediaPluginId,
		"integration.youtube-music",
		"script",
	);

	const unsupportedMetadataSources = yield* getUnsupportedMetadataSources;
	yield* unsupportedMetadataSources.length > 0
		? Effect.die(
				new Error(
					`Unsupported legacy metadata sources: ${unsupportedMetadataSources
						.map(({ lot, source }) => `${lot}|${source}`)
						.join(", ")}`,
				),
			)
		: Effect.void;

	const unsupportedMetadataGroupSources = yield* getUnsupportedMetadataGroupSources;
	yield* unsupportedMetadataGroupSources.length > 0
		? Effect.die(
				new Error(
					`Unsupported legacy metadata group sources: ${unsupportedMetadataGroupSources
						.map(({ lot, source }) => `${lot}|${source}`)
						.join(", ")}`,
				),
			)
		: Effect.void;

	const unsupportedPersonSources = yield* getUnsupportedPersonSources;
	yield* unsupportedPersonSources.length > 0
		? Effect.die(
				new Error(
					`Unsupported legacy person sources: ${unsupportedPersonSources
						.map(({ entity_kind, source }) => `${entity_kind}|${source}`)
						.join(", ")}`,
				),
			)
		: Effect.void;

	const unsupportedExerciseSources = yield* getUnsupportedExerciseSources;
	yield* unsupportedExerciseSources.length > 0
		? Effect.die(
				new Error(
					`Unsupported legacy exercise sources: ${unsupportedExerciseSources
						.map(({ source }) => source)
						.join(", ")}`,
				),
			)
		: Effect.void;

	const unsupportedExerciseLots = yield* getUnsupportedExerciseLots;
	yield* unsupportedExerciseLots.length > 0
		? Effect.die(
				new Error(
					`Unsupported legacy exercise lots: ${unsupportedExerciseLots
						.map(({ lot }) => lot)
						.join(", ")}`,
				),
			)
		: Effect.void;

	const invalidExerciseGithubOwnership = yield* getInvalidExerciseGithubOwnership;
	yield* invalidExerciseGithubOwnership.length > 0
		? Effect.die(
				new Error(
					`Legacy github exercise rows must not have a creator user id: ${invalidExerciseGithubOwnership
						.map(({ id }) => id)
						.join(", ")}`,
				),
			)
		: Effect.void;

	const resolvedExerciseTargets = resolveEntityMigrationTargets(
		exerciseEntityTargets,
		resolution,
		fitnessPluginId,
	);
	yield* withReservedConnection((connection) =>
		connection.executeRaw(buildLegacyUserLibraryMigrationSql(libraryEntitySchema), []),
	);
	reportSequence = yield* withReservedConnection((connection) =>
		logReportRows(connection, reportSequence),
	);

	// Phase 2: Backfill bootstrap data for migrated users
	if (migratedUserRows.length > 0) {
		yield* Effect.logInfo("legacy user bootstrap backfill started").pipe(
			Effect.annotateLogs({ userCount: migratedUserRows.length }),
		);

		for (const user of migratedUserRows) {
			yield* bootstrapNewUser(user.id).pipe(
				Effect.provideService(PluginUserBootstrapDispatcher, {
					dispatchAll: () => Effect.sync((): undefined => undefined),
				}),
				Effect.tapError((error) =>
					Effect.logError("legacy user bootstrap failed", error).pipe(
						Effect.annotateLogs({ userId: user.id }),
					),
				),
				Effect.orDie,
			);
		}

		const savedViewInstallations = migratedUserRows.map(({ id: userId }) => ({
			userId,
			mediaInstallationId: requireInstallation(resolution, userId, mediaPluginId),
			fitnessInstallationId: requireInstallation(resolution, userId, fitnessPluginId),
		}));
		yield* withReservedConnection((connection) =>
			connection.executeRaw(
				buildLegacySavedViewStateMigrationSql(savedViewInstallations, collectionsSavedView.slug),
				[],
			),
		);

		yield* Effect.logInfo("legacy user bootstrap backfill finished").pipe(
			Effect.annotateLogs({ userCount: migratedUserRows.length }),
		);
	}
	reportSequence = yield* withReservedConnection((connection) =>
		logReportRows(connection, reportSequence),
	);

	// Phase 3: Migrate entities, events, and relationships
	//
	// Slim migration: provider-sourced ("global") entities are reconstructed on demand by V2's
	// entity population workflow, so we materialize only the subset referenced by user data (plus
	// all user-authored custom entities). The referenced-id set is collected up front and consumed
	// by the metadata / person / company / metadata_group entity migrations.
	const legacyIntegrationProgressCache = yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			yield* connection.executeRaw(buildReferencedGlobalEntityIdsSql(), []);
			yield* connection.executeRaw(buildMetadataMigrationSql(resolvedMetadataTargets), []);
			yield* connection.executeRaw(
				buildLegacyEpisodicSubEntityMigrationSql({
					showSeasonEntitySchema,
					showEpisodeEntitySchema,
					podcastEpisodeEntitySchema,
					showToSeasonRelationshipSchema,
					seasonToEpisodeRelationshipSchema,
					podcastToEpisodeRelationshipSchema,
				}),
				[],
			);
			yield* connection.executeRaw(
				buildMetadataGroupEntityMigrationSql(resolvedMetadataGroupEntityTargets),
				[],
			);
			yield* connection.executeRaw(
				buildMetadataGroupRelationshipMigrationSql(resolvedMetadataGroupRelationshipTargets),
				[],
			);
			yield* connection.executeRaw(buildPersonEntityMigrationSql(resolvedPersonEntityTargets), []);
			yield* connection.executeRaw(
				buildCompanyEntityMigrationSql(resolvedCompanyEntityTargets),
				[],
			);
			yield* connection.executeRaw(buildCollectionEntityMigrationSql(collectionEntitySchema), []);
			yield* connection.executeRaw(buildExerciseMigrationSql(resolvedExerciseTargets), []);
			yield* connection.executeRaw(buildMeasurementMigrationSql(measurementEntitySchema), []);
			yield* connection.executeRaw(
				buildWorkoutTemplateMigrationSql(workoutTemplateEntitySchema),
				[],
			);
			yield* connection.executeRaw(buildWorkoutMigrationSql(workoutEntitySchema), []);
			yield* connection.executeRaw(buildWorkoutSetEventMigrationSql(workoutSetEventSchema), []);
			yield* connection.executeRaw(
				buildWorkoutToTemplateRelationshipMigrationSql(workoutToWorkoutTemplateRelationshipSchema),
				[],
			);
			yield* connection.executeRaw(
				buildWorkoutRepeatedFromRelationshipMigrationSql(workoutRepeatedFromRelationshipSchema),
				[],
			);
			yield* connection.executeRaw(buildReviewMigrationSql(), []);
			yield* connection.executeRaw(buildSeenMigrationSql(mediaPluginId), []);
			yield* connection.executeRaw(buildSeenEpisodicCompletionMigrationSql(mediaPluginId), []);
			yield* connection.executeRaw(
				`
					DO $$
					DECLARE
						rec RECORD;
					BEGIN
						FOR rec IN
							SELECT schemaname, tablename
							FROM pg_tables
							WHERE schemaname = ANY (current_schemas(false))
							ORDER BY schemaname, tablename
						LOOP
							EXECUTE format('ANALYZE %I.%I', rec.schemaname, rec.tablename);
						END LOOP;
					END $$;
				`,
				[],
			);
			yield* connection.executeRaw(
				buildPersonRelationshipMigrationSql(resolvedPersonRelationshipTargets),
				[],
			);
			yield* connection.executeRaw(
				buildCompanyRelationshipMigrationSql(resolvedCompanyRelationshipTargets),
				[],
			);
			yield* connection.executeRaw(
				buildGroupPersonRelationshipMigrationSql(resolvedGroupPersonRelationshipTargets),
				[],
			);
			yield* connection.executeRaw(
				buildCollectionToEntityRelationshipMigrationSql(
					addEntityToCollectionEventSchema,
					memberOfRelationshipSchema,
				),
				[],
			);
			yield* connection.executeRaw(buildMetadataToMetadataRelationshipMigrationSql(), []);
			yield* connection.executeRaw(
				buildUserToEntityInLibraryMigrationSql(inLibraryRelationshipSchema, libraryEntitySchema),
				[],
			);
			yield* connection.executeRaw(
				buildOwnedCollectionOwnershipMigrationSql(inLibraryRelationshipSchema),
				[],
			);
			yield* connection.executeRaw(
				buildMonitoringCollectionMigrationSql({
					libraryEntitySchema,
					monitorableEntitySchemaSlugs,
					mediaMonitoringRelationshipSchema,
				}),
				[],
			);
			return yield* readLegacyIntegrationProgressCache(connection);
		}),
	);
	const legacyS3AssetMigration = yield* migrateLegacyS3Assets;
	yield* withReservedConnection((connection) =>
		connection.executeRaw(buildLegacyS3AssetReportSql(legacyS3AssetMigration), []),
	);
	reportSequence = yield* withReservedConnection((connection) =>
		logReportRows(connection, reportSequence),
	);
	const integrationSettings = yield* withReservedConnection(readLegacyIntegrationSettings);
	for (const row of integrationSettings) {
		const provider = requireMapped(
			resolution.integrationProviders,
			mediaPluginId,
			row.provider,
			"integration provider",
		);
		if (provider.lot !== row.lot) {
			return yield* Effect.die(
				new Error(
					`Legacy integration lot does not match the current resolved provider for ${row.id}: ${row.lot}/${provider.lot}`,
				),
			);
		}
		yield* parseAppSchemaProperties({
			properties: row.settings,
			kind: `${row.provider} legacy integration`,
			propertiesSchema: provider.settingsSchema,
		}).pipe(
			Effect.mapError(
				(error) =>
					new Error(
						`Legacy integration settings failed current schema validation for ${row.id}: ${formatPropertyIssues(error.issues)}`,
					),
			),
			Effect.orDie,
		);
	}
	yield* withReservedConnection((connection) =>
		connection.executeRaw(
			buildIntegrationMigrationSql({
				installations: mediaInstallations,
				providerSlugs: integrationProviderSlugs,
			}),
			[],
		),
	);
	yield* migrateIntegrationProgressCache({
		cacheRows: legacyIntegrationProgressCache,
		installationIdsByUserId: mediaInstallationIdsByUserId,
		scriptId: integrationProgressScript.id,
	});
	yield* migrateYoutubeMusicCache({
		installationIds: mediaInstallations.map(({ installationId }) => installationId),
		scriptId: youtubeMusicScript.id,
	});
	yield* withReservedConnection((connection) =>
		connection.executeRaw(buildNotificationPlatformMigrationSql(), []),
	);
	reportSequence = yield* withReservedConnection((connection) =>
		logReportRows(connection, reportSequence),
	);

	const elapsedSeconds = Math.round(((yield* Clock.currentTimeMillis) - startedAtMs) / 1000);
	yield* Effect.logInfo("legacy data migration finished").pipe(
		Effect.annotateLogs({ elapsedSeconds }),
	);
	return yield* Effect.void;
});
