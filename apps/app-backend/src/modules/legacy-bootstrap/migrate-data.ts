import { builtinMediaEntitySchemaSlugs } from "@ryot/media-plugin/schemas/media-schema-slugs";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";

import { plugin, sandboxProvider } from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginLoader } from "#modules/plugins/loader";
import { bootstrapNewUser } from "#modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";

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
import { buildIntegrationMigrationSql } from "./integration-mapping";
import {
	migrateIntegrationProgressCache,
	readLegacyIntegrationProgressCache,
} from "./integration-progress-cache-mapping";
import { buildLegacyS3AssetReportSql, migrateLegacyS3Assets } from "./legacy-asset-migration";
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
	requireDefined,
	requireSchemaId,
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
	buildUniqueSlugMap,
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
		return;
	}

	const database = yield* Database;
	const loader = yield* PluginLoader;
	const definitions = yield* DefinitionRegistry;

	const entitySchemas = Object.keys(definitions.getSnapshot().entitySchemas).map((slug) => ({
		id: slug,
		slug,
	}));
	const workoutSetEventSchemaResult = definitions.getEventSchema("exercise", "workout-set")
		? [{ id: "workout-set" }]
		: [];
	const addEntityToCollectionEventSchemaResult = definitions.getEventSchema(
		"collection",
		"add-entity-to-collection",
	)
		? [{ id: "add-entity-to-collection" }]
		: [];

	const persistedProviders = yield* mapDatabaseErrors(
		database
			.select({
				id: sandboxProvider.id,
				slug: sandboxProvider.slug,
				pluginSlug: plugin.slug,
			})
			.from(sandboxProvider)
			.innerJoin(plugin, eq(plugin.id, sandboxProvider.pluginId)),
	);

	// A persisted `sandbox_provider` row is only live when the active loader snapshot's plugin still
	// declares it; repository upserts never remove stale declarations. Mirrors `findActiveProvider`
	// in `#modules/plugins/runtime-resolver`.
	const declaredProviderKeys = new Set(
		Object.values(loader.getSnapshot().plugins).flatMap((entry) =>
			entry.manifest.providers.map(({ slug }) => `${entry.slug}|${slug}`),
		),
	);
	const activeProviders = persistedProviders.filter((provider) =>
		declaredProviderKeys.has(`${provider.pluginSlug}|${provider.slug}`),
	);

	const relationshipSchemas = Object.keys(definitions.getSnapshot().relationshipSchemas).map(
		(slug) => ({ id: slug, slug }),
	);

	const entitySchemaSlugs = buildUniqueSlugMap(entitySchemas, "entity schema");
	const providerIds = buildUniqueSlugMap(activeProviders, "sandbox provider");
	const relationshipSchemaSlugs = buildUniqueSlugMap(relationshipSchemas, "relationship schema");
	const metadataEntitySchemaSlugByLot = buildUniqueLotEntitySchemaSlugMap(
		metadataMigrationTargets.map(({ lot, entitySchemaSlug }) => ({ lot, entitySchemaSlug })),
	);

	const resolvedMetadataTargets = resolveEntityMigrationTargets(
		metadataMigrationTargets,
		entitySchemaSlugs,
		providerIds,
		"metadata",
	);
	const resolvedMetadataGroupEntityTargets = resolveEntityMigrationTargets(
		metadataGroupEntityTargets,
		entitySchemaSlugs,
		providerIds,
		"metadata group",
	);
	const resolvedMetadataGroupRelationshipTargets = metadataGroupRelationshipTargets.map(
		(target) => ({
			lot: target.lot,
			relationshipSchemaSlug: requireSchemaId(
				relationshipSchemaSlugs,
				target.relationshipSchemaSlug,
				"relationship schema",
			),
		}),
	);
	const resolvedPersonEntityTargets = resolveEntityMigrationTargets(
		personEntityTargets,
		entitySchemaSlugs,
		providerIds,
		"person",
	);
	const resolvedCompanyEntityTargets = resolveEntityMigrationTargets(
		companyEntityTargets,
		entitySchemaSlugs,
		providerIds,
		"company",
	);
	const resolvedPersonRelationshipTargets = resolveRelationshipMigrationTargets({
		relationshipSchemaSlugs,
		sourceEntitySchemaSlug: "person",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
	});
	const resolvedCompanyRelationshipTargets = resolveRelationshipMigrationTargets({
		relationshipSchemaSlugs,
		sourceEntitySchemaSlug: "company",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
	});

	const groupPersonRelationshipLots = [
		{ lot: "music", relationshipSchemaSlug: "person-to-music-group" },
		{ lot: "video_game", relationshipSchemaSlug: "person-to-video-game-group" },
	] as const;
	const resolvedGroupPersonRelationshipTargets = groupPersonRelationshipLots.map((target) => ({
		lot: target.lot,
		relationshipSchemaSlug: requireSchemaId(
			relationshipSchemaSlugs,
			target.relationshipSchemaSlug,
			"relationship schema",
		),
	}));

	const collectionEntitySchemaSlug = requireSchemaId(
		entitySchemaSlugs,
		"collection",
		"entity schema",
	);

	const memberOfRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"member-of",
		"relationship schema",
	);
	const addEntityToCollectionEventSchemaSlug = requireDefined(
		addEntityToCollectionEventSchemaResult[0],
		'Missing event schema for slug "add-entity-to-collection"',
	).id;

	const measurementEntitySchemaSlug = requireSchemaId(
		entitySchemaSlugs,
		"measurement",
		"entity schema",
	);

	const workoutEntitySchemaSlug = requireSchemaId(entitySchemaSlugs, "workout", "entity schema");

	const workoutTemplateEntitySchemaSlug = requireSchemaId(
		entitySchemaSlugs,
		"workout-template",
		"entity schema",
	);

	const workoutSetEventSchemaSlug = requireDefined(
		workoutSetEventSchemaResult[0],
		'Missing event schema for slug "workout-set"',
	).id;

	const workoutToWorkoutTemplateRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"workout-to-workout-template",
		"relationship schema",
	);

	const workoutRepeatedFromRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"workout-repeated-from",
		"relationship schema",
	);

	const libraryEntitySchemaSlug = requireSchemaId(entitySchemaSlugs, "library", "entity schema");

	const inLibraryRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"in-library",
		"relationship schema",
	);

	const mediaMonitoringRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"media-monitoring",
		"relationship schema",
	);

	const monitorableEntitySchemaSlugs = ["company", "person", ...builtinMediaEntitySchemaSlugs].map(
		(slug) => requireSchemaId(entitySchemaSlugs, slug, "entity schema"),
	);

	const showSeasonEntitySchemaSlug = requireSchemaId(
		entitySchemaSlugs,
		"show-season",
		"entity schema",
	);

	const showEpisodeEntitySchemaSlug = requireSchemaId(
		entitySchemaSlugs,
		"show-episode",
		"entity schema",
	);

	const podcastEpisodeEntitySchemaSlug = requireSchemaId(
		entitySchemaSlugs,
		"podcast-episode",
		"entity schema",
	);

	const showToSeasonRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"show-to-show-season",
		"relationship schema",
	);

	const seasonToEpisodeRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"show-season-to-show-episode",
		"relationship schema",
	);

	const podcastToEpisodeRelationshipSchemaSlug = requireSchemaId(
		relationshipSchemaSlugs,
		"podcast-to-podcast-episode",
		"relationship schema",
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
		entitySchemaSlugs,
		providerIds,
		"exercise",
	);
	let reportSequence = yield* withReservedConnection(getLatestReportSequence);

	// Phase 1: Migrate legacy users and get migrated user IDs
	const migratedUserRows = yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			yield* connection.executeRaw(buildLegacyUserAuthMigrationSql(), []);
			yield* connection.executeRaw(buildLegacyUserLibraryMigrationSql(libraryEntitySchemaSlug), []);
			const rows: ReadonlyArray<{ id: string }> = yield* connection.execute(
				`SELECT "id" FROM "old_user" ORDER BY "created_on", "id"`,
				[],
				undefined,
			);
			return rows;
		}),
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

		yield* withReservedConnection((connection) =>
			connection.executeRaw(buildLegacySavedViewStateMigrationSql(), []),
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
					showSeasonEntitySchemaSlug,
					showEpisodeEntitySchemaSlug,
					podcastEpisodeEntitySchemaSlug,
					showToSeasonRelationshipSchemaSlug,
					seasonToEpisodeRelationshipSchemaSlug,
					podcastToEpisodeRelationshipSchemaSlug,
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
			yield* connection.executeRaw(
				buildCollectionEntityMigrationSql(collectionEntitySchemaSlug),
				[],
			);
			yield* connection.executeRaw(buildExerciseMigrationSql(resolvedExerciseTargets), []);
			yield* connection.executeRaw(buildMeasurementMigrationSql(measurementEntitySchemaSlug), []);
			yield* connection.executeRaw(
				buildWorkoutTemplateMigrationSql(workoutTemplateEntitySchemaSlug),
				[],
			);
			yield* connection.executeRaw(buildWorkoutMigrationSql(workoutEntitySchemaSlug), []);
			yield* connection.executeRaw(buildWorkoutSetEventMigrationSql(workoutSetEventSchemaSlug), []);
			yield* connection.executeRaw(
				buildWorkoutToTemplateRelationshipMigrationSql(
					workoutToWorkoutTemplateRelationshipSchemaSlug,
				),
				[],
			);
			yield* connection.executeRaw(
				buildWorkoutRepeatedFromRelationshipMigrationSql(workoutRepeatedFromRelationshipSchemaSlug),
				[],
			);
			yield* connection.executeRaw(buildReviewMigrationSql(), []);
			yield* connection.executeRaw(buildSeenMigrationSql(), []);
			yield* connection.executeRaw(buildSeenEpisodicCompletionMigrationSql(), []);
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
					addEntityToCollectionEventSchemaSlug,
					memberOfRelationshipSchemaSlug,
				),
				[],
			);
			yield* connection.executeRaw(buildMetadataToMetadataRelationshipMigrationSql(), []);
			yield* connection.executeRaw(
				buildUserToEntityInLibraryMigrationSql(
					inLibraryRelationshipSchemaSlug,
					libraryEntitySchemaSlug,
				),
				[],
			);
			yield* connection.executeRaw(
				buildOwnedCollectionOwnershipMigrationSql(inLibraryRelationshipSchemaSlug),
				[],
			);
			yield* connection.executeRaw(
				buildMonitoringCollectionMigrationSql({
					libraryEntitySchemaSlug,
					monitorableEntitySchemaSlugs,
					mediaMonitoringRelationshipSchemaSlug,
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
	yield* withReservedConnection((connection) =>
		connection.executeRaw(buildIntegrationMigrationSql(), []),
	);
	yield* migrateIntegrationProgressCache(legacyIntegrationProgressCache);
	yield* migrateYoutubeMusicCache;
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
});
