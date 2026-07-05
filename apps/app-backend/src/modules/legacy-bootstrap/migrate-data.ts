import { builtinMediaEntitySchemaSlugs } from "@ryot/plugin-media/schemas/media-schema-slugs";
import { and, isNotNull, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { sandboxScript } from "#lib/infrastructure/db/schema/tables/combined";
import { dbEffect, DbService } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
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
	const definitions = yield* DefinitionRegistry;

	const entitySchemas = Object.keys(definitions.getSnapshot().entitySchemas).map((slug) => ({
		id: slug,
		slug,
	}));
	const workoutSetEventSchemaResult = definitions.getEventSchema("exercise", "workout-set")
		? [{ id: "workout-set" }]
		: [];

	const sandboxScripts = yield* dbEffect(() =>
		db
			.select({ id: sandboxScript.id, slug: sandboxScript.slug })
			.from(sandboxScript)
			.where(
				and(
					isNull(sandboxScript.userId),
					or(
						isNotNull(sandboxScript.pluginSlug),
						and(isNull(sandboxScript.pluginSlug), isNotNull(sandboxScript.contentHash)),
					),
				),
			),
	);

	const relationshipSchemas = Object.keys(definitions.getSnapshot().relationshipSchemas).map(
		(slug) => ({ id: slug, slug }),
	);

	const entitySchemaSlugs = buildUniqueSlugMap(entitySchemas, "entity schema");
	const sandboxScriptIds = buildUniqueSlugMap(sandboxScripts, "sandbox script");
	const relationshipSchemaSlugs = buildUniqueSlugMap(relationshipSchemas, "relationship schema");
	const metadataEntitySchemaSlugByLot = buildUniqueLotEntitySchemaSlugMap(
		metadataMigrationTargets.map(({ lot, entitySchemaSlug }) => ({ lot, entitySchemaSlug })),
	);

	const resolvedMetadataTargets = resolveEntityMigrationTargets(
		metadataMigrationTargets,
		entitySchemaSlugs,
		sandboxScriptIds,
		"metadata",
	);
	const resolvedMetadataGroupEntityTargets = resolveEntityMigrationTargets(
		metadataGroupEntityTargets,
		entitySchemaSlugs,
		sandboxScriptIds,
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
		sandboxScriptIds,
		"person",
	);
	const resolvedCompanyEntityTargets = resolveEntityMigrationTargets(
		companyEntityTargets,
		entitySchemaSlugs,
		sandboxScriptIds,
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
		yield* Effect.logInfo("legacy user bootstrap backfill started").pipe(
			Effect.annotateLogs({ userCount: migratedUserRows.length }),
		);

		for (const user of migratedUserRows) {
			yield* bootstrapNewUser(user.id).pipe(
				Effect.tapError((error) =>
					Effect.logError("legacy user bootstrap failed", error).pipe(
						Effect.annotateLogs({ userId: user.id }),
					),
				),
				Effect.orDie,
			);
		}

		yield* Effect.logInfo("legacy user bootstrap backfill finished").pipe(
			Effect.annotateLogs({ userCount: migratedUserRows.length }),
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
						showSeasonEntitySchemaSlug,
						showEpisodeEntitySchemaSlug,
						podcastEpisodeEntitySchemaSlug,
						showToSeasonRelationshipSchemaSlug,
						seasonToEpisodeRelationshipSchemaSlug,
						podcastToEpisodeRelationshipSchemaSlug,
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
			.then(() => client.query(buildCollectionEntityMigrationSql(collectionEntitySchemaSlug)))
			.then(() => client.query(buildExerciseMigrationSql(resolvedExerciseTargets)))
			.then(() => client.query(buildMeasurementMigrationSql(measurementEntitySchemaSlug)))
			.then(() => client.query(buildWorkoutTemplateMigrationSql(workoutTemplateEntitySchemaSlug)))
			.then(() => client.query(buildWorkoutMigrationSql(workoutEntitySchemaSlug)))
			.then(() => client.query(buildWorkoutSetEventMigrationSql(workoutSetEventSchemaSlug)))
			.then(() =>
				client.query(
					buildWorkoutToTemplateRelationshipMigrationSql(
						workoutToWorkoutTemplateRelationshipSchemaSlug,
					),
				),
			)
			.then(() =>
				client.query(
					buildWorkoutRepeatedFromRelationshipMigrationSql(
						workoutRepeatedFromRelationshipSchemaSlug,
					),
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
				client.query(
					buildCollectionToEntityRelationshipMigrationSql(memberOfRelationshipSchemaSlug),
				),
			)
			.then(() => client.query(buildMetadataToMetadataRelationshipMigrationSql()))
			.then(() =>
				client.query(
					buildUserToEntityInLibraryMigrationSql(
						inLibraryRelationshipSchemaSlug,
						libraryEntitySchemaSlug,
					),
				),
			)
			.then(() =>
				client.query(buildOwnedCollectionOwnershipMigrationSql(inLibraryRelationshipSchemaSlug)),
			)
			.then(() =>
				client.query(
					buildMonitoringCollectionMigrationSql({
						libraryEntitySchemaSlug,
						monitorableEntitySchemaSlugs,
						mediaMonitoringRelationshipSchemaSlug,
					}),
				),
			)
			.then(() => client.query(buildIntegrationMigrationSql()))
			.then(() => client.query(buildNotificationPlatformMigrationSql())),
	);
});
