import { mediaGenre, recognizedMediaGenres } from "@ryot-app/media-plugin/shared/media-genres";
import { Clock, Effect, Exit, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import type { QualifiedSchema } from "./migration-resolution";
import { insertReportRows } from "./shared";

const GenreInput = Schema.Struct({
	id: Schema.String,
	source: Schema.String,
	schema: Schema.String,
	genres: Schema.Array(Schema.String),
	userId: Schema.NullOr(Schema.String),
});
const decodeInputs = Schema.decodeUnknownEffect(Schema.Array(GenreInput));
const encodeLinks = Schema.encodeSync(
	Schema.fromJsonString(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				schema: Schema.String,
				sourceId: Schema.String,
				externalId: Schema.String,
				userId: Schema.NullOr(Schema.String),
			}),
		),
	),
);

type GenreMigration = {
	pluginId: string;
	providerId: string;
	genreSchema: QualifiedSchema;
	relationships: readonly QualifiedSchema[];
};

const migrateGenres = Effect.fn("migrateGenres")(function* (
	connection: SqlConnection.Connection,
	input: GenreMigration,
) {
	const startedAt = yield* Clock.currentTimeMillis;
	if (
		input.genreSchema.slug !== "genre" ||
		input.genreSchema.pluginId !== input.pluginId ||
		input.relationships.some((schema) => schema.pluginId !== input.pluginId)
	) {
		return yield* Effect.die(
			new Error(
				"Legacy genres: mismatched active schema ownership. Keep the dump and report a migration defect.",
			),
		);
	}
	const relationships = new Set(input.relationships.map(({ slug }) => slug));
	yield* connection.executeRaw(
		`CREATE TEMP TABLE _legacy_media_genre_links (
		"sourceId" text NOT NULL, "userId" text, "externalId" text NOT NULL,
		name text NOT NULL, schema text NOT NULL, PRIMARY KEY ("sourceId", "externalId")
	) ON COMMIT DROP;`,
		[],
	);
	let cursor: null | string = null;
	let omitted = 0;
	for (;;) {
		const rows: ReadonlyArray<typeof GenreInput.Type> = yield* connection
			.execute(
				`
			WITH batch AS (
				SELECT metadata.id, metadata.source, entity.user_id, entity.entity_schema_slug
				FROM "metadata" metadata
				INNER JOIN "entity" entity ON entity.id = metadata.id
				WHERE entity.entity_schema_plugin_id = $1
					AND (metadata.source = 'custom' OR EXISTS (SELECT 1 FROM _populated_metadata_ids populated WHERE populated.id = metadata.id::text))
					AND ($2::text IS NULL OR metadata.id::text > $2)
				ORDER BY metadata.id::text LIMIT 250
			)
			SELECT batch.id::text AS id, batch.source::text AS source, batch.user_id AS "userId",
				batch.entity_schema_slug AS schema,
				COALESCE(jsonb_agg(genre.name ORDER BY genre.name) FILTER (WHERE genre.id IS NOT NULL), '[]'::jsonb) AS genres
			FROM batch
			LEFT JOIN "metadata_to_genre" membership ON membership.metadata_id = batch.id
			LEFT JOIN "genre" genre ON genre.id = membership.genre_id
			GROUP BY batch.id, batch.source, batch.user_id, batch.entity_schema_slug ORDER BY batch.id::text`,
				[input.pluginId, cursor],
				undefined,
			)
			.pipe(Effect.flatMap(decodeInputs), Effect.orDie);
		if (rows.length === 0) {
			break;
		}
		const links = [];
		for (const row of rows) {
			const schema = `${row.schema}-to-genre`;
			if (!relationships.has(schema)) {
				return yield* Effect.die(
					new Error(
						`Legacy genres: no active relationship ${schema} for ${row.id}. Use a build with the complete media schema, then restart.`,
					),
				);
			}
			const broadSource = [
				"vndb",
				"anilist",
				"audible",
				"giant_bomb",
				"openlibrary",
				"google_books",
				"manga_updates",
			].includes(row.source);
			const values = broadSource ? recognizedMediaGenres(row.genres) : row.genres;
			omitted += row.genres.length - values.length;
			for (const value of values) {
				const genre = mediaGenre(value);
				if (genre === null) {
					return yield* Effect.die(
						new Error(
							`Legacy genres: blank genre on ${row.id}. Correct the legacy genre name in the dump, then restart.`,
						),
					);
				}
				links.push({ schema, sourceId: row.id, userId: row.userId, ...genre });
			}
			cursor = row.id;
		}
		yield* connection.executeRaw(
			`INSERT INTO _legacy_media_genre_links
			SELECT * FROM jsonb_to_recordset($1::jsonb) AS link("sourceId" text, "userId" text, "externalId" text, name text, schema text)
			ON CONFLICT DO NOTHING`,
			[encodeLinks(links)],
		);
	}
	yield* connection.executeRaw(
		`CREATE TEMP TABLE _legacy_media_genres ON COMMIT DROP AS
		SELECT DISTINCT "externalId", name, md5(jsonb_build_array('media-genre', $1::text, "externalId")::text) AS id FROM _legacy_media_genre_links`,
		[input.pluginId],
	);
	const conflicts = yield* connection.execute(
		`SELECT existing.id
		FROM _legacy_media_genres intended JOIN "entity" existing ON existing.id = intended.id
		WHERE existing.external_id IS DISTINCT FROM intended."externalId" OR existing.entity_schema_slug <> 'genre'
			OR existing.entity_schema_plugin_id IS DISTINCT FROM $1 OR existing.provider_id IS DISTINCT FROM $2 OR existing.user_id IS NOT NULL`,
		[input.pluginId, input.providerId],
		undefined,
	);
	if (conflicts.length > 0) {
		return yield* Effect.die(
			new Error(
				"Legacy genres: deterministic entity IDs conflict with existing data. Keep the dump and report a migration defect; retrying cannot repair this conflict.",
			),
		);
	}
	yield* connection.executeRaw(
		`INSERT INTO "entity" (id, external_id, name, created_at, populated_at, user_id, properties, entity_schema_slug, entity_schema_plugin_id, provider_id, updated_at)
		SELECT intended.id, intended."externalId", intended.name, NOW(), NOW(), NULL, '{}'::jsonb, 'genre', $1, $2, NOW()
		FROM _legacy_media_genres intended
		WHERE NOT EXISTS (SELECT 1 FROM "entity" existing WHERE existing.external_id = intended."externalId"
			AND existing.entity_schema_slug = 'genre' AND existing.entity_schema_plugin_id = $1 AND existing.provider_id = $2 AND existing.user_id IS NULL)
		ON CONFLICT DO NOTHING`,
		[input.pluginId, input.providerId],
	);
	yield* connection.executeRaw(
		`CREATE TEMP TABLE _legacy_media_genre_relationships ON COMMIT DROP AS
		SELECT link.*, target.id AS "targetId", md5(jsonb_build_array('media-genre-link', $1::text, link."userId", link."sourceId", target.id, link.schema)::text) AS id
		FROM _legacy_media_genre_links link JOIN "entity" target ON target.external_id = link."externalId"
			AND target.entity_schema_slug = 'genre' AND target.entity_schema_plugin_id = $1 AND target.provider_id = $2 AND target.user_id IS NULL`,
		[input.pluginId, input.providerId],
	);
	const missing = yield* connection.execute(
		`SELECT link."sourceId" FROM _legacy_media_genre_links link
		WHERE NOT EXISTS (SELECT 1 FROM _legacy_media_genre_relationships resolved WHERE resolved."sourceId" = link."sourceId" AND resolved."externalId" = link."externalId")`,
		[],
		undefined,
	);
	if (missing.length > 0) {
		return yield* Effect.die(
			new Error(
				"Legacy genres: genre entity insertion left unresolved memberships. Keep the dump and report a migration defect.",
			),
		);
	}
	const relationshipConflicts = yield* connection.execute(
		`SELECT existing.id FROM _legacy_media_genre_relationships intended
		JOIN "relationship" existing ON existing.id = intended.id
		WHERE existing.user_id IS DISTINCT FROM intended."userId" OR existing.source_entity_id IS DISTINCT FROM intended."sourceId"
			OR existing.target_entity_id IS DISTINCT FROM intended."targetId" OR existing.relationship_schema_slug IS DISTINCT FROM intended.schema
			OR existing.relationship_schema_plugin_id IS DISTINCT FROM $1`,
		[input.pluginId],
		undefined,
	);
	if (relationshipConflicts.length > 0) {
		return yield* Effect.die(
			new Error(
				"Legacy genres: deterministic relationship IDs conflict with existing data. Keep the dump and report a migration defect; retrying cannot repair this conflict.",
			),
		);
	}
	yield* connection.executeRaw(
		`INSERT INTO "relationship" (id, user_id, source_entity_id, target_entity_id, relationship_schema_slug, relationship_schema_plugin_id, properties, created_at)
		SELECT intended.id, intended."userId", intended."sourceId", intended."targetId", intended.schema, $1, '{}'::jsonb, NOW()
		FROM _legacy_media_genre_relationships intended
		WHERE NOT EXISTS (SELECT 1 FROM "relationship" existing WHERE existing.user_id IS NOT DISTINCT FROM intended."userId"
			AND existing.source_entity_id = intended."sourceId" AND existing.target_entity_id = intended."targetId"
			AND existing.relationship_schema_slug = intended.schema AND existing.relationship_schema_plugin_id = $1)
		ON CONFLICT DO NOTHING`,
		[input.pluginId],
	);
	const counts = yield* connection
		.execute(
			`SELECT (SELECT count(*)::int FROM _legacy_media_genres) AS genres,
		(SELECT count(*)::int FROM _legacy_media_genre_relationships) AS links`,
			[],
			undefined,
		)
		.pipe(
			Effect.flatMap(
				Schema.decodeUnknownEffect(
					Schema.Array(Schema.Struct({ links: Schema.Finite, genres: Schema.Finite })),
				),
			),
			Effect.orDie,
		);
	const count = counts[0];
	if (count === undefined) {
		return yield* Effect.die(
			new Error(
				"Legacy genres: missing migration counts. Keep the dump and report a migration defect.",
			),
		);
	}
	yield* insertReportRows(connection, [
		{
			count: count.genres,
			message: "shared genre(s) retained",
			phase: "media genres -> relationships",
			elapsedSeconds: ((yield* Clock.currentTimeMillis) - startedAt) / 1000,
		},
		{
			count: count.links,
			elapsedSeconds: null,
			phase: "media genres -> relationships",
			message: "genre membership(s) retained",
		},
		{
			count: omitted,
			elapsedSeconds: null,
			phase: "media genres -> relationships",
			message: "unmapped broad classification(s) intentionally omitted",
		},
	]);
	return yield* Effect.void;
});

export const migrateLegacyMediaGenres = Effect.fn("migrateLegacyMediaGenres")(function* (
	connection: SqlConnection.Connection,
	input: GenreMigration,
) {
	return yield* Effect.acquireUseRelease(
		connection.executeRaw("BEGIN", []),
		() =>
			migrateGenres(connection, input).pipe(
				Effect.andThen(connection.executeRaw("COMMIT", [])),
				Effect.asVoid,
			),
		(_, exit) =>
			Exit.isFailure(exit) ? connection.executeRaw("ROLLBACK", []).pipe(Effect.orDie) : Effect.void,
	);
});
