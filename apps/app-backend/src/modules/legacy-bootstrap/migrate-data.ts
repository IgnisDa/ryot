import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { bootstrapNewUser } from "~/lib/builtins/bootstrap";
import { dbEffect, DbService } from "~/lib/db";
import { entitySchema, eventSchema, relationshipSchema, sandboxScript } from "~/lib/db/schema";

import {
	buildCollectionEntityMigrationSql,
	buildCollectionToEntityRelationshipMigrationSql,
	buildOwnedCollectionOwnershipMigrationSql,
} from "./collection-mapping";
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
	metadataMigrationTargets,
} from "./metadata-mapping";
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
import { buildUniqueSlugMap, legacyBootstrapGate, withRawPgClient } from "./shared";
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

const buildUniqueLotEntitySchemaSlugMap = (
	targets: readonly { lot: string; entitySchemaSlug: string }[],
) => {
	const lotToEntitySchemaSlug = new Map<string, string>();
	for (const target of targets) {
		const existing = lotToEntitySchemaSlug.get(target.lot);
		if (existing !== undefined && existing !== target.entitySchemaSlug) {
			throw new Error(
				`Conflicting entity schema slugs for legacy lot "${target.lot}" (${existing} vs ${target.entitySchemaSlug})`,
			);
		}

		lotToEntitySchemaSlug.set(target.lot, target.entitySchemaSlug);
	}

	return lotToEntitySchemaSlug;
};

const resolveEntityMigrationTargets = <
	T extends { source: string; entitySchemaSlug: string; sandboxScriptSlug: string | null },
>(
	targets: readonly T[],
	entitySchemaIds: Map<string, string>,
	sandboxScriptIds: Map<string, string>,
	kindLabel: string,
): Array<T & { entitySchemaId: string; sandboxScriptId: string | null }> =>
	targets.map((target) => {
		const entitySchemaId = entitySchemaIds.get(target.entitySchemaSlug);
		if (entitySchemaId === undefined) {
			throw new Error(
				`Missing entity schema id for ${kindLabel} slug "${target.entitySchemaSlug}"`,
			);
		}

		const sandboxScriptId: string | null =
			target.sandboxScriptSlug === null
				? null
				: (sandboxScriptIds.get(target.sandboxScriptSlug) ?? null);
		if (target.sandboxScriptSlug !== null && sandboxScriptId === null) {
			throw new Error(`Missing sandbox script id for slug "${target.sandboxScriptSlug}"`);
		}

		return { ...target, entitySchemaId, sandboxScriptId };
	});

const resolveRelationshipMigrationTargets = (input: {
	lotToEntitySchemaSlug: Map<string, string>;
	relationshipSchemaIds: Map<string, string>;
	sourceEntitySchemaSlug: "person" | "company";
}) => {
	const targets: Array<{ lot: string; relationshipSchemaId: string }> = [];

	for (const [lot, targetEntitySchemaSlug] of input.lotToEntitySchemaSlug.entries()) {
		const relationshipSchemaSlug = `${input.sourceEntitySchemaSlug}-to-${targetEntitySchemaSlug}`;
		const relationshipSchemaId = input.relationshipSchemaIds.get(relationshipSchemaSlug);
		if (relationshipSchemaId === undefined) {
			throw new Error(`Missing relationship schema id for slug "${relationshipSchemaSlug}"`);
		}

		targets.push({ lot, relationshipSchemaId });
	}

	return targets;
};

const requireDefined = <T>(value: T | undefined, message: string): T => {
	if (value === undefined) {
		throw new Error(message);
	}
	return value;
};

const requireSchemaId = (map: Map<string, string>, slug: string, kind: string) => {
	const id = map.get(slug);
	if (id === undefined) {
		throw new Error(`Missing ${kind} id for slug "${slug}"`);
	}
	return id;
};

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

	const mediaSuggestionRelationshipSchemaId = requireSchemaId(
		relationshipSchemaIds,
		"media-suggestion",
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
				Effect.catchAll((cause) =>
					Effect.logError("[legacy-bootstrap] bootstrapNewUser failed for user", user.id, cause),
				),
			);
		}

		yield* Effect.logInfo(
			`[legacy-bootstrap] finished V2 bootstrap backfill for ${migratedUserRows.length} migrated user(s)`,
		);
	}

	// Phase 3: Migrate entities, events, and relationships
	yield* withRawPgClient((client) =>
		client
			.query(buildMetadataMigrationSql(resolvedMetadataTargets))
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
			.then(() =>
				client.query(
					buildMetadataToMetadataRelationshipMigrationSql(mediaSuggestionRelationshipSchemaId),
				),
			)
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
			.then(() => client.query(buildIntegrationMigrationSql())),
	);
});
