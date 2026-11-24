import { expect } from "bun:test";

import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import {
	buildCollectionEntityMigrationSql,
	buildCollectionToEntityRelationshipMigrationSql,
} from "./collection-mapping";
import { buildLegacyCustomMediaCopySql } from "./custom-media-copy-sql";
import {
	insertUsers,
	legacyDatabaseLayer,
	mediaPluginId,
	migrateLegacyCustomMetadata,
} from "./legacy-database.test-support";
import { buildReviewMigrationSql } from "./review-mapping";
import { buildSeenMigrationSql } from "./seen-mapping";
import { withReservedConnection } from "./shared";
import { buildUserToEntityInLibraryMigrationSql } from "./user-to-entity-mapping";

const BookEntity = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	userId: Schema.String,
	properties: Schema.Record(Schema.String, Schema.Unknown),
});

layer(legacyDatabaseLayer("legacy_custom_media"))((test) => {
	test.effect(
		"moves a user's records on another user's custom media to a copy that user owns",
		() =>
			withReservedConnection((connection) =>
				Effect.gen(function* () {
					yield* insertUsers(connection, ["owner", "reader"]);
					yield* connection.executeRaw(
						`DO $$ BEGIN
						INSERT INTO "entity" ("id", "name", "user_id", "entity_schema_slug", "entity_schema_plugin_id")
						VALUES ('owner-library', 'Media Library', 'owner', 'media-library', '${mediaPluginId}'),
							('reader-library', 'Media Library', 'reader', 'media-library', '${mediaPluginId}');
						INSERT INTO "metadata" ("id", "lot", "source", "identifier", "title", "description", "created_by_user_id", "book_specifics")
						VALUES ('book', 'book', 'custom', 'book', 'Synthetic Book', 'A synthetic book.', 'owner', '{"pages": 320}');
						INSERT INTO "genre" ("id", "name") VALUES ('genre-drama', 'Drama');
						INSERT INTO "metadata_to_genre" ("metadata_id", "genre_id") VALUES ('book', 'genre-drama');
						INSERT INTO "seen" ("id", "user_id", "metadata_id", "state", "progress", "finished_on", "updated_at")
						VALUES ('seen-owner', 'owner', 'book', 'completed', 100, '2024-01-02', ARRAY['2024-01-02'::timestamptz]),
							('seen-reader', 'reader', 'book', 'completed', 100, '2024-02-03', ARRAY['2024-02-03'::timestamptz]);
						INSERT INTO "review" ("id", "user_id", "metadata_id", "rating", "text", "posted_on")
						VALUES ('review-reader', 'reader', 'book', 80, 'Synthetic review.', '2024-02-04');
						INSERT INTO "user_to_entity" ("id", "user_id", "metadata_id")
						VALUES ('library-owner', 'owner', 'book'), ('library-reader', 'reader', 'book');
						INSERT INTO "collection" ("id", "user_id", "name") VALUES ('shelf', 'reader', 'Shelf');
						INSERT INTO "collection_to_entity" ("id", "collection_id", "metadata_id")
						VALUES ('shelf-book', 'shelf', 'book');
						END $$`,
						[],
					);

					yield* connection.executeRaw(buildLegacyCustomMediaCopySql(), []);
					yield* migrateLegacyCustomMetadata(connection);
					yield* Effect.forEach(
						[
							buildReviewMigrationSql(mediaPluginId),
							buildSeenMigrationSql(mediaPluginId),
							buildUserToEntityInLibraryMigrationSql({
								libraryEligibleEntitySchemaSlugs: ["book"],
								libraryEntitySchema: { slug: "media-library", pluginId: mediaPluginId },
								inLibraryRelationshipSchema: { pluginId: mediaPluginId, slug: "in-media-library" },
							}),
							buildCollectionEntityMigrationSql({ pluginId: null, slug: "collection" }),
							buildCollectionToEntityRelationshipMigrationSql(
								{ pluginId: null, slug: "add-entity-to-collection" },
								{ pluginId: null, slug: "member-of" },
							),
						],
						(statement) => connection.executeRaw(statement, []),
						{ discard: true },
					);

					const [original, copy] = yield* connection
						.execute(
							`SELECT "id", "user_id" AS "userId", "name", "properties" FROM "entity"
							WHERE "entity_schema_slug" = 'book' ORDER BY "user_id"`,
							[],
							undefined,
						)
						.pipe(
							Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([BookEntity, BookEntity]))),
						);
					expect(original).toEqual({
						id: "book",
						userId: "owner",
						name: "Synthetic Book",
						properties: copy.properties,
					});
					expect(copy).toMatchObject({ userId: "reader", name: "Synthetic Book" });
					expect(copy.id).not.toBe("book");
					expect(copy.properties).toMatchObject({ pages: 320, description: "A synthetic book." });
					expect(
						yield* connection.execute(
							`SELECT "metadata_id" AS "metadataId" FROM "metadata_to_genre" ORDER BY "metadata_id" = 'book' DESC`,
							[],
							undefined,
						),
					).toEqual([{ metadataId: "book" }, { metadataId: copy.id }]);
					expect(
						yield* connection.execute(
							`SELECT record.user_id AS "userId", record.slug, record.entity_id AS "entityId",
								media.user_id AS "entityOwner"
							FROM (
								SELECT user_id, event_schema_slug AS slug, entity_id FROM "event"
								UNION ALL
								SELECT user_id, relationship_schema_slug, source_entity_id FROM "relationship"
							) record
							INNER JOIN "entity" media ON media.id = record.entity_id AND media.entity_schema_slug = 'book'
							ORDER BY record.user_id, record.slug`,
							[],
							undefined,
						),
					).toEqual([
						...["add-to-media-library", "complete", "in-media-library"].map((slug) => ({
							slug,
							userId: "owner",
							entityId: "book",
							entityOwner: "owner",
						})),
						...["add-to-media-library", "complete", "in-media-library", "member-of", "review"].map(
							(slug) => ({ slug, userId: "reader", entityId: copy.id, entityOwner: "reader" }),
						),
					]);
					expect(
						yield* connection.execute(
							`SELECT report.phase, report.code, report.count, detail.detail
							FROM "migration_report" report
							INNER JOIN "migration_report_detail" detail ON detail.report_seq = report.seq
							WHERE report.level = 'warning'`,
							[],
							undefined,
						),
					).toEqual([
						{
							count: 1,
							code: "custom-media-copied",
							phase: "legacy custom media ownership",
							detail: {
								key: copy.id,
								label: "Synthetic Book",
								sentence:
									"This user's records on this media now point at a copy the user owns: 1 seen, 1 review, 1 library and 1 collection record(s).",
								provenance: [
									{ key: "Copy", value: copy.id },
									{ value: "book", key: "Original" },
									{ value: "owner", key: "Original owner" },
									{ key: "User", value: "reader" },
									{ key: "Kind", value: "book" },
								],
							},
						},
					]);
				}),
			),
	);
});
