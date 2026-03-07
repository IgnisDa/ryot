import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import {
	entitySchema,
	eventSchema,
	relationshipSchema,
	sandboxScript,
} from "#lib/infrastructure/db/schema/tables/combined";
import { dbEffect, DbService } from "#lib/infrastructure/db/service";
import { builtinMediaEntitySchemaSlugs } from "#modules/builtins/media-schema-slugs";
import { bootstrapNewUser } from "#modules/user-bootstrap/bootstrap";

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
import { buildSeenEpisodicCompletionMigrationSql } from "./seen-completion-mapping";
import { buildSeenMigrationSql } from "./seen-mapping";
import {
	buildReferencedGlobalEntityIdsSql,
	buildUniqueSlugMap,
	legacyBootstrapGate,
	withRawPgClient,
} from "./shared";
import { buildLegacyUserAuthMigrationSql } from "./user-auth-mapping";
import { buildMeasurementMigrationSql } from "./user-measurement-mapping";
import { buildUserToEntityInLibraryMigrationSql } from "./user-to-entity-mapping";
import {
	buildWorkoutMigrationSql,
	buildWorkoutRepeatedFromRelationshipMigrationSql,
	buildWorkoutSetEventMigrationSql,
	buildWorkoutTemplateMigrationSql,
	buildWorkoutToTemplateRelationshipMigrationSql,
} from "./workout-mapping";

export const migrateLegacyTables = Effect.gen(function* () {
	const gate = yield* legacyBootstrapGate;
	if (!gate) {
		return;
	}

	const { db } = yield* DbService;

	const entitySchemas = yield* dbEffect(() =>
		db
			.select({ id: entitySchema.id, slug: entitySchema.slug })
			.from(entitySchema)
			.where(isNull(entitySchema.userId)),
	);

	const workoutSetEventSchemaResult = yield* dbEffect(() =>
		db
			.select({ id: eventSchema.id })
			.from(eventSchema)
			.where(and(isNull(eventSchema.userId), eq(eventSchema.slug, "workout-set"))),
	);

	const sandboxScripts = yield* dbEffect(() =>
		db
			.select({ id: sandboxScript.id, slug: sandboxScript.slug })
			.from(sandboxScript)
			.where(and(isNull(sandboxScript.userId), eq(sandboxScript.isBuiltin, true))),
	);

	const relationshipSchemas = yield* dbEffect(() =>
		db
			.select({ id: relationshipSchema.id, slug: relationshipSchema.slug })
			.from(relationshipSchema)
			.where(isNull(relationshipSchema.userId)),
	);

	const entitySchemaIds = buildUniqueSlugMap(entitySchemas, "entity schema");
	const sandboxScriptIds = buildUniqueSlugMap(sandboxScripts, "sandbox script");
	const relationshipSchemaIds = buildUniqueSlugMap(relationshipSchemas, "relationship schema");
	const metadataEntitySchemaSlugByLot = buildUniqueLotEntitySchemaSlugMap(
		metadataMigrationTargets.map(({ lot, entitySchemaSlug }) => ({ lot, entitySchemaSlug })),
	);

	const resolvedMetadataTargets = resolveEntityMigrationTargets(
		metadataMigrationTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"metadata",
	);
	const resolvedMetadataGroupEntityTargets = resolveEntityMigrationTargets(
		metadataGroupEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"metadata group",
	);
	const resolvedMetadataGroupRelationshipTargets = metadataGroupRelationshipTargets.map(
		(target) => ({
			lot: target.lot,
			relationshipSchemaId: requireSchemaId(
				relationshipSchemaIds,
				target.relationshipSchemaSlug,
				"relationship schema",
			),
		}),
	);
	const resolvedPersonEntityTargets = resolveEntityMigrationTargets(
		personEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"person",
	);
	const resolvedCompanyEntityTargets = resolveEntityMigrationTargets(
		companyEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"company",
	);
	const resolvedPersonRelationshipTargets = resolveRelationshipMigrationTargets({
		relationshipSchemaIds,
		sourceEntitySchemaSlug: "person",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
	});
	const resolvedCompanyRelationshipTargets = resolveRelationshipMigrationTargets({
		relationshipSchemaIds,
		sourceEntitySchemaSlug: "company",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
	});

	const groupPersonRelationshipLots = [
		{ lot: "music", relationshipSchemaSlug: "person-to-music-group" },
		{ lot: "video_game", relationshipSchemaSlug: "person-to-video-game-group" },
	] as const;
	const resolvedGroupPersonRelationshipTargets = groupPersonRelationshipLots.map((target) => ({
		lot: target.lot,
		relationshipSchemaId: requireSchemaId(
			relationshipSchemaIds,
			target.relationshipSchemaSlug,
			"relationship schema",
		),
	}));

	const collectionEntitySchemaId = requireSchemaId(entitySchemaIds, "collection", "entity schema");

	const memberOfRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"member-of",
		"relationship schema",
	);

	const measurementEntitySchemaId = requireSchemaId(
		entitySchemaIds,
		"measurement",
		"entity schema",
	);

	const workoutEntitySchemaId = requireSchemaId(entitySchemaIds, "workout", "entity schema");

	const workoutTemplateEntitySchemaId = requireSchemaId(
		entitySchemaIds,
		"workout-template",
		"entity schema",
	);

	const workoutSetEventSchemaId = requireDefined(
		workoutSetEventSchemaResult[0],
		'Missing event schema for slug "workout-set"',
	).id;

	const workoutToWorkoutTemplateRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"workout-to-workout-template",
		"relationship schema",
	);

	const workoutRepeatedFromRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"workout-repeated-from",
		"relationship schema",
	);

	const libraryEntitySchemaId = requireSchemaId(entitySchemaIds, "library", "entity schema");

	const inLibraryRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"in-library",
		"relationship schema",
	);

	const mediaMonitoringRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"media-monitoring",
		"relationship schema",
	);

	const monitorableEntitySchemaIds = ["company", "person", ...builtinMediaEntitySchemaSlugs].map(
		(slug) => requireSchemaId(entitySchemaIds, slug, "entity schema"),
	);

	const showSeasonEntitySchemaId = requireSchemaId(entitySchemaIds, "show-season", "entity schema");

	const showEpisodeEntitySchemaId = requireSchemaId(
		entitySchemaIds,
		"show-episode",
		"entity schema",
	);

	const podcastEpisodeEntitySchemaId = requireSchemaId(
		entitySchemaIds,
		"podcast-episode",
		"entity schema",
	);

	const showToSeasonRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"show-to-show-season",
		"relationship schema",
	);

	const seasonToEpisodeRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"show-season-to-show-episode",
		"relationship schema",
	);

	const podcastToEpisodeRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
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
		entitySchemaIds,
		sandboxScriptIds,
		"exercise",
	);

	// Phase 1: Migrate legacy users and get migrated user IDs
	const migratedUserRows = yield* withRawPgClient((client) =>
		client
			.query(buildLegacyUserAuthMigrationSql())
			.then(() =>
				client.query<{ id: string }>(`SELECT "id" FROM "old_user" ORDER BY "created_on", "id"`),
			)
			.then((result) => result.rows),
	);

	// Phase 2: Backfill bootstrap data for migrated users
	if (migratedUserRows.length > 0) {
		yield* Effect.logInfo(
			`[legacy-bootstrap] backfilling V2 bootstrap data for ${migratedUserRows.length} migrated user(s)`,
		);

		for (const user of migratedUserRows) {
			yield* bootstrapNewUser(user.id).pipe(
				Effect.tapError((cause) =>
					Effect.logError("[legacy-bootstrap] bootstrapNewUser failed for user", user.id, cause),
				),
				Effect.orDie,
			);
		}

		yield* Effect.logInfo(
			`[legacy-bootstrap] finished V2 bootstrap backfill for ${migratedUserRows.length} migrated user(s)`,
		);
	}

	// Phase 3: Migrate entities, events, and relationships
	//
	// Slim migration: provider-sourced ("global") entities are reconstructed on demand by V2's
	// entity population workflow, so we materialize only the subset referenced by user data (plus
	// all user-authored custom entities). The referenced-id set is collected up front and consumed
	// by the metadata / person / company / metadata_group entity migrations.
	yield* withRawPgClient((client) =>
		client
			.query(buildReferencedGlobalEntityIdsSql())
			.then(() => client.query(buildMetadataMigrationSql(resolvedMetadataTargets)))
			.then(() =>
				client.query(
					buildLegacyEpisodicSubEntityMigrationSql({
						showSeasonEntitySchemaId,
						showEpisodeEntitySchemaId,
						podcastEpisodeEntitySchemaId,
						showToSeasonRelationshipSchemaId,
						seasonToEpisodeRelationshipSchemaId,
						podcastToEpisodeRelationshipSchemaId,
					}),
				),
			)
			.then(() =>
				client.query(buildMetadataGroupEntityMigrationSql(resolvedMetadataGroupEntityTargets)),
			)
			.then(() =>
				client.query(
					buildMetadataGroupRelationshipMigrationSql(resolvedMetadataGroupRelationshipTargets),
				),
			)
			.then(() => client.query(buildPersonEntityMigrationSql(resolvedPersonEntityTargets)))
			.then(() => client.query(buildCompanyEntityMigrationSql(resolvedCompanyEntityTargets)))
			.then(() => client.query(buildCollectionEntityMigrationSql(collectionEntitySchemaId)))
			.then(() => client.query(buildExerciseMigrationSql(resolvedExerciseTargets)))
			.then(() => client.query(buildMeasurementMigrationSql(measurementEntitySchemaId)))
			.then(() => client.query(buildWorkoutTemplateMigrationSql(workoutTemplateEntitySchemaId)))
			.then(() => client.query(buildWorkoutMigrationSql(workoutEntitySchemaId)))
			.then(() => client.query(buildWorkoutSetEventMigrationSql(workoutSetEventSchemaId)))
			.then(() =>
				client.query(
					buildWorkoutToTemplateRelationshipMigrationSql(
						workoutToWorkoutTemplateRelationshipSchemaId,
					),
				),
			)
			.then(() =>
				client.query(
					buildWorkoutRepeatedFromRelationshipMigrationSql(workoutRepeatedFromRelationshipSchemaId),
				),
			)
			.then(() => client.query(buildReviewMigrationSql()))
			.then(() => client.query(buildSeenMigrationSql()))
			.then(() => client.query(buildSeenEpisodicCompletionMigrationSql()))
			.then(() =>
				client.query(`
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
				`),
			)
			.then(() =>
				client.query(buildPersonRelationshipMigrationSql(resolvedPersonRelationshipTargets)),
			)
			.then(() =>
				client.query(buildCompanyRelationshipMigrationSql(resolvedCompanyRelationshipTargets)),
			)
			.then(() =>
				client.query(
					buildGroupPersonRelationshipMigrationSql(resolvedGroupPersonRelationshipTargets),
				),
			)
			.then(() =>
				client.query(buildCollectionToEntityRelationshipMigrationSql(memberOfRelationshipSchemaId)),
			)
			.then(() => client.query(buildMetadataToMetadataRelationshipMigrationSql()))
			.then(() =>
				client.query(
					buildUserToEntityInLibraryMigrationSql(
						inLibraryRelationshipSchemaId,
						libraryEntitySchemaId,
					),
				),
			)
			.then(() =>
				client.query(buildOwnedCollectionOwnershipMigrationSql(inLibraryRelationshipSchemaId)),
			)
			.then(() =>
				client.query(
					buildMonitoringCollectionMigrationSql({
						libraryEntitySchemaId,
						monitorableEntitySchemaIds,
						mediaMonitoringRelationshipSchemaId,
					}),
				),
			)
			.then(() => client.query(buildIntegrationMigrationSql()))
			.then(() => client.query(buildNotificationPlatformMigrationSql())),
	);
});
