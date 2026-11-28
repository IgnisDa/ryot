import { expect } from "bun:test";

import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import {
	insertUsers,
	legacyDatabaseLayer,
	mediaPluginId,
	migrateLegacyCustomMetadata,
} from "./legacy-database.test-support";
import { migrateLegacyMediaGenres } from "./media-genre-mapping";
import { withReservedConnection } from "./shared";

layer(legacyDatabaseLayer("legacy_genres"))((test) => {
	test.effect("skips a blank legacy genre and its link and reports each skipped link", () =>
		withReservedConnection((connection) =>
			Effect.gen(function* () {
				yield* insertUsers(connection, ["owner"]);
				yield* connection.executeRaw(
					`DO $$ BEGIN
					INSERT INTO "metadata" ("id", "lot", "source", "identifier", "title", "created_by_user_id")
					VALUES ('book', 'book', 'custom', 'book', 'Synthetic Book', 'owner');
					INSERT INTO "genre" ("id", "name") VALUES ('genre-drama', 'Drama'), ('genre-blank', '   ');
					INSERT INTO "metadata_to_genre" ("metadata_id", "genre_id")
					VALUES ('book', 'genre-drama'), ('book', 'genre-blank');
					INSERT INTO "sandbox_provider" ("id", "slug", "root_entity_schema_slug", "name", "information", "plugin_id")
					VALUES ('genre-provider', 'genre.media-catalog', 'genre', '{}', '{}', '${mediaPluginId}');
					END $$`,
					[],
				);
				yield* migrateLegacyCustomMetadata(connection);

				yield* migrateLegacyMediaGenres(connection, {
					pluginId: mediaPluginId,
					providerId: "genre-provider",
					genreSchema: { slug: "genre", pluginId: mediaPluginId },
					relationships: [{ slug: "book-to-genre", pluginId: mediaPluginId }],
				});

				expect(
					yield* connection.execute(
						`SELECT genre.external_id AS "externalId", genre.name, link.user_id AS "userId",
							link.source_entity_id AS "sourceId"
						FROM "entity" genre
						LEFT JOIN "relationship" link ON link.target_entity_id = genre.id
						WHERE genre.entity_schema_slug = 'genre'`,
						[],
						undefined,
					),
				).toEqual([{ name: "Drama", userId: "owner", sourceId: "book", externalId: "drama" }]);
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
						code: "genre-name-blank",
						phase: "media genres -> relationships",
						detail: {
							key: "book:genre-blank",
							label: "Synthetic Book",
							sentence:
								"Legacy genre genre-blank has a blank name, so this item's link to it was not carried over.",
							provenance: [
								{ key: "Media", value: "book" },
								{ key: "Legacy genre", value: "genre-blank" },
								{ value: '"   "', key: "Stored name" },
							],
						},
					},
				]);
			}),
		),
	);
});
