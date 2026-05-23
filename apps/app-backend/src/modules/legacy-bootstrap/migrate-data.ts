import { and, eq, isNull } from "drizzle-orm";
import type { Client, PoolClient } from "pg";

import type { DbClient } from "~/lib/db";
import { entitySchema, eventSchema, relationshipSchema, sandboxScript } from "~/lib/db/schema";
import { bootstrapNewUser } from "~/modules/builtins";

import { buildCollectionEntityMigrationSql } from "./collection-mapping";
import {
	buildExerciseMigrationSql,
	exerciseEntityTargets,
	getInvalidExerciseGithubOwnership,
	getUnsupportedExerciseLots,
	getUnsupportedExerciseSources,
} from "./exercise-mapping";
import {
	buildMetadataGroupEntityMigrationSql,
	buildMetadataGroupRelationshipMigrationSql,
	getUnsupportedMetadataGroupSources,
	metadataGroupEntityTargets,
	metadataGroupRelationshipTargets,
} from "./metadata-group-mapping";
import {
	buildMetadataMigrationSql,
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
import {
	buildUniqueSlugMap,
	shouldRunLegacyBootstrap,
	withLegacyBootstrapNoticeClient,
} from "./shared";
import { buildLegacyUserAuthMigrationSql } from "./user-auth-mapping";
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

		return {
			...target,
			entitySchemaId,
			sandboxScriptId,
		};
	});

const resolveRelationshipMigrationTargets = (input: {
	sourceEntitySchemaSlug: "person" | "company";
	lotToEntitySchemaSlug: Map<string, string>;
	relationshipSchemaIds: Map<string, string>;
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

type LegacyBootstrapNoticeClient = Client | PoolClient;

const backfillBootstrapDataForLegacyUsers = async (client: LegacyBootstrapNoticeClient) => {
	const migratedUsers = await client.query<{ id: string }>(`
		SELECT "id"
		FROM "old_user"
		ORDER BY "created_on", "id"
	`);

	if (migratedUsers.rows.length === 0) {
		return;
	}

	console.info(
		`[legacy-bootstrap] backfilling V2 bootstrap data for ${migratedUsers.rows.length} migrated user(s)`,
	);

	for (const migratedUser of migratedUsers.rows) {
		// oxlint-disable-next-line no-await-in-loop
		await bootstrapNewUser(migratedUser.id);
	}

	console.info(
		`[legacy-bootstrap] finished V2 bootstrap backfill for ${migratedUsers.rows.length} migrated user(s)`,
	);
};

export const migrateLegacyTables = async (database: DbClient) => {
	if (!(await shouldRunLegacyBootstrap(database))) {
		return;
	}

	const entitySchemas = await database
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
		})
		.from(entitySchema)
		.where(isNull(entitySchema.userId));

	const workoutSetEventSchemaResult = await database
		.select({ id: eventSchema.id })
		.from(eventSchema)
		.where(and(isNull(eventSchema.userId), eq(eventSchema.slug, "workout-set")));

	const sandboxScripts = await database
		.select({
			id: sandboxScript.id,
			slug: sandboxScript.slug,
		})
		.from(sandboxScript)
		.where(and(isNull(sandboxScript.userId), eq(sandboxScript.isBuiltin, true)));

	const relationshipSchemas = await database
		.select({
			id: relationshipSchema.id,
			slug: relationshipSchema.slug,
		})
		.from(relationshipSchema)
		.where(isNull(relationshipSchema.userId));

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
		(target) => {
			const relationshipSchemaId = relationshipSchemaIds.get(target.relationshipSchemaSlug);
			if (relationshipSchemaId === undefined) {
				throw new Error(
					`Missing relationship schema id for slug "${target.relationshipSchemaSlug}"`,
				);
			}

			return { lot: target.lot, relationshipSchemaId };
		},
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
		sourceEntitySchemaSlug: "person",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
		relationshipSchemaIds,
	});
	const resolvedCompanyRelationshipTargets = resolveRelationshipMigrationTargets({
		sourceEntitySchemaSlug: "company",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
		relationshipSchemaIds,
	});

	const groupPersonRelationshipLots = [
		{ lot: "music", relationshipSchemaSlug: "person-to-music-group" },
		{ lot: "video_game", relationshipSchemaSlug: "person-to-video-game-group" },
	] as const;
	const resolvedGroupPersonRelationshipTargets = groupPersonRelationshipLots.map((target) => {
		const relationshipSchemaId = relationshipSchemaIds.get(target.relationshipSchemaSlug);
		if (relationshipSchemaId === undefined) {
			throw new Error(`Missing relationship schema id for slug "${target.relationshipSchemaSlug}"`);
		}

		return { lot: target.lot, relationshipSchemaId };
	});

	const collectionEntitySchemaId = entitySchemaIds.get("collection");
	if (collectionEntitySchemaId === undefined) {
		throw new Error('Missing entity schema id for collection slug "collection"');
	}

	const workoutEntitySchemaId = entitySchemaIds.get("workout");
	if (workoutEntitySchemaId === undefined) {
		throw new Error('Missing entity schema id for slug "workout"');
	}

	const workoutTemplateEntitySchemaId = entitySchemaIds.get("workout-template");
	if (workoutTemplateEntitySchemaId === undefined) {
		throw new Error('Missing entity schema id for slug "workout-template"');
	}

	const workoutSetEventSchemaRow = workoutSetEventSchemaResult[0];
	if (workoutSetEventSchemaRow === undefined) {
		throw new Error('Missing event schema for slug "workout-set"');
	}
	const workoutSetEventSchemaId = workoutSetEventSchemaRow.id;

	const workoutToWorkoutTemplateRelationshipSchemaId = relationshipSchemaIds.get(
		"workout-to-workout-template",
	);
	if (workoutToWorkoutTemplateRelationshipSchemaId === undefined) {
		throw new Error('Missing relationship schema id for slug "workout-to-workout-template"');
	}

	const workoutRepeatedFromRelationshipSchemaId =
		relationshipSchemaIds.get("workout-repeated-from");
	if (workoutRepeatedFromRelationshipSchemaId === undefined) {
		throw new Error('Missing relationship schema id for slug "workout-repeated-from"');
	}

	const unsupportedMetadataSources = await getUnsupportedMetadataSources(database);
	if (unsupportedMetadataSources.length > 0) {
		throw new Error(
			`Unsupported legacy metadata sources: ${unsupportedMetadataSources
				.map(({ lot, source }) => `${lot}|${source}`)
				.join(", ")}`,
		);
	}

	const unsupportedMetadataGroupSources = await getUnsupportedMetadataGroupSources(database);
	if (unsupportedMetadataGroupSources.length > 0) {
		throw new Error(
			`Unsupported legacy metadata group sources: ${unsupportedMetadataGroupSources
				.map(({ lot, source }) => `${lot}|${source}`)
				.join(", ")}`,
		);
	}

	const unsupportedPersonSources = await getUnsupportedPersonSources(database);
	if (unsupportedPersonSources.length > 0) {
		throw new Error(
			`Unsupported legacy person sources: ${unsupportedPersonSources
				.map(({ entity_kind, source }) => `${entity_kind}|${source}`)
				.join(", ")}`,
		);
	}

	const unsupportedExerciseSources = await getUnsupportedExerciseSources(database);
	if (unsupportedExerciseSources.length > 0) {
		throw new Error(
			`Unsupported legacy exercise sources: ${unsupportedExerciseSources
				.map(({ source }) => source)
				.join(", ")}`,
		);
	}

	const unsupportedExerciseLots = await getUnsupportedExerciseLots(database);
	if (unsupportedExerciseLots.length > 0) {
		throw new Error(
			`Unsupported legacy exercise lots: ${unsupportedExerciseLots
				.map(({ lot }) => lot)
				.join(", ")}`,
		);
	}

	const invalidExerciseGithubOwnership = await getInvalidExerciseGithubOwnership(database);
	if (invalidExerciseGithubOwnership.length > 0) {
		throw new Error(
			`Legacy github exercise rows must not have a creator user id: ${invalidExerciseGithubOwnership
				.map(({ id }) => id)
				.join(", ")}`,
		);
	}

	const resolvedExerciseTargets = resolveEntityMigrationTargets(
		exerciseEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"exercise",
	);

	await withLegacyBootstrapNoticeClient(database, async (client) => {
		await client.query(buildLegacyUserAuthMigrationSql());
		await backfillBootstrapDataForLegacyUsers(client);
		await client.query(buildMetadataMigrationSql(resolvedMetadataTargets));
		await client.query(buildMetadataGroupEntityMigrationSql(resolvedMetadataGroupEntityTargets));
		await client.query(
			buildMetadataGroupRelationshipMigrationSql(resolvedMetadataGroupRelationshipTargets),
		);
		await client.query(buildPersonEntityMigrationSql(resolvedPersonEntityTargets));
		await client.query(buildCompanyEntityMigrationSql(resolvedCompanyEntityTargets));
		await client.query(buildCollectionEntityMigrationSql(collectionEntitySchemaId));
		await client.query(buildExerciseMigrationSql(resolvedExerciseTargets));
		await client.query(buildWorkoutTemplateMigrationSql(workoutTemplateEntitySchemaId));
		await client.query(buildWorkoutMigrationSql(workoutEntitySchemaId));
		await client.query(buildWorkoutSetEventMigrationSql(workoutSetEventSchemaId));
		await client.query(
			buildWorkoutToTemplateRelationshipMigrationSql(workoutToWorkoutTemplateRelationshipSchemaId),
		);
		await client.query(
			buildWorkoutRepeatedFromRelationshipMigrationSql(workoutRepeatedFromRelationshipSchemaId),
		);
		await client.query(buildReviewMigrationSql());
		await client.query(buildSeenMigrationSql());
		await client.query(buildSeenEpisodicCompletionMigrationSql());
		await client.query(`
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
		`);
		await client.query(buildPersonRelationshipMigrationSql(resolvedPersonRelationshipTargets));
		await client.query(buildCompanyRelationshipMigrationSql(resolvedCompanyRelationshipTargets));
		await client.query(
			buildGroupPersonRelationshipMigrationSql(resolvedGroupPersonRelationshipTargets),
		);
	});
};
