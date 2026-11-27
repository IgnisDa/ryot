import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import { normalizeStoredTmdbArtwork } from "@ryot-app/media-plugin/backend/lib/vendors/tmdb-artwork";
import {
	curateProviderImages,
	MediaImageListSchema,
	MediaImageSchema,
} from "@ryot-app/media-plugin/shared/media-image";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

const phase = "media artwork -> curated artwork";
const ArtworkRows = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		images: MediaImageListSchema,
		localized: Schema.Record(Schema.String, MediaImageSchema),
	}),
);
const decodeArtworkRows = Schema.decodeUnknownEffect(ArtworkRows);

export const MediaArtworkCutoverLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.transaction(
			Effect.gen(function* () {
				const [completion] = yield* session.run((db) =>
					db.execute<{ completed: boolean }>(
						sql`SELECT EXISTS (SELECT 1 FROM "migration_report" WHERE phase = ${phase}) AS completed`,
						"objects",
					),
				);
				if (completion === undefined) {
					return yield* Effect.die(
						new Error(
							"Media artwork migration could not read its completion state. Keep the database and report this migration defect.",
						),
					);
				}
				if (completion.completed) {
					return yield* Effect.void;
				}

				let cursor: null | string = null;
				let count = 0;
				for (;;) {
					const page = yield* session.run((db) =>
						db.execute<{ id: string }>(
							sql`
					SELECT id FROM "entity"
					${cursor === null ? sql`` : sql`WHERE id > ${cursor}`}
					ORDER BY id LIMIT 500
				`,
							"objects",
						),
					);
					const pageEnd = page.at(-1);
					if (pageEnd === undefined) {
						break;
					}
					cursor = pageEnd.id;
					const rows: typeof ArtworkRows.Type = yield* session
						.run((db) =>
							db.execute(
								sql`
					SELECT entity.id, entity.properties -> 'images' AS images, artwork.localized
					FROM "entity" entity
					JOIN "plugin" owner ON owner.id = entity.entity_schema_plugin_id
					JOIN "sandbox_provider" provider ON provider.id = entity.provider_id
					CROSS JOIN LATERAL (
						SELECT COALESCE(jsonb_object_agg(translation.language, translation.properties -> 'images' -> 0), '{}') AS localized
						FROM "entity_translation" translation
						WHERE translation.entity_id = entity.id
							AND jsonb_typeof(translation.properties -> 'images' -> 0) = 'object'
					) artwork
					WHERE owner.package_id = ${PLUGIN_PACKAGE_ID} AND owner.owner_user_id IS NULL
						AND provider.slug LIKE '%.tmdb'
						AND (jsonb_typeof(entity.properties -> 'images') = 'array' OR artwork.localized <> '{}')
						AND entity.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(page.map(({ id }) => id))}::jsonb))
				`,
								"objects",
							),
						)
						.pipe(Effect.flatMap(decodeArtworkRows));
					const patches = rows.map(({ id, images, localized }) => ({
						id,
						images:
							images === null ? null : curateProviderImages(images.map(normalizeStoredTmdbArtwork)),
						localized: Object.fromEntries(
							Object.entries(localized).map(([language, image]) => [
								language,
								normalizeStoredTmdbArtwork(image),
							]),
						),
					}));
					const [updated] = yield* session.run((db) =>
						db.execute<{ count: number }>(
							sql`
					WITH patch AS (
						SELECT *
						FROM jsonb_to_recordset(${JSON.stringify(patches)}::jsonb) AS row_patch(id text, images jsonb, localized jsonb)
					), changed AS (
						UPDATE "entity" entity
						SET properties = jsonb_set(entity.properties, '{images}', patch.images),
							content_generation = entity.content_generation + 1
						FROM patch
						WHERE entity.id = patch.id AND patch.images IS NOT NULL
							AND entity.properties -> 'images' IS DISTINCT FROM patch.images
						RETURNING entity.id, entity.content_generation
					), translations AS (
						UPDATE "entity_translation" translation
						SET source_content_generation = CASE
								WHEN translation.source_content_generation = changed.content_generation - 1
								THEN changed.content_generation ELSE translation.source_content_generation END,
							properties = CASE WHEN patch.localized ? translation.language
								THEN (translation.properties - 'images') ||
									jsonb_build_object('localizedArtwork', patch.localized -> translation.language)
								ELSE translation.properties END
						FROM patch LEFT JOIN changed ON changed.id = patch.id
						WHERE translation.entity_id = patch.id
							AND (translation.source_content_generation = changed.content_generation - 1
								OR patch.localized ? translation.language)
					)
					SELECT count(*)::int AS count FROM changed
				`,
							"objects",
						),
					);
					if (updated === undefined) {
						return yield* Effect.die(
							new Error(
								"Media artwork migration could not read its update count. Keep the database and report this migration defect.",
							),
						);
					}
					count += updated.count;
				}

				yield* session.run((db) =>
					db.execute(sql`
				UPDATE "entity_translation" translation
				SET properties = (translation.properties - 'images') ||
					CASE WHEN jsonb_typeof(translation.properties -> 'images' -> 0) = 'object'
						THEN jsonb_build_object('localizedArtwork', translation.properties -> 'images' -> 0)
						ELSE '{}'::jsonb END
				FROM "entity" entity
				JOIN "plugin" owner ON owner.id = entity.entity_schema_plugin_id
				WHERE translation.entity_id = entity.id AND owner.package_id = ${PLUGIN_PACKAGE_ID}
					AND owner.owner_user_id IS NULL AND translation.properties ? 'images'
			`),
				);
				return yield* session
					.run((db) =>
						db.execute(sql`
				INSERT INTO "migration_report" (phase, level, message, count)
				VALUES (${phase}, 'info', 'provider artwork lists updated', ${count})
			`),
					)
					.pipe(Effect.asVoid);
			}),
		);
	}),
);
