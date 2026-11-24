import { expect } from "bun:test";

import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { legacyDatabaseLayer, mediaPluginId } from "./legacy-database.test-support";
import { migrateLegacyOriginalLanguages } from "./original-language-mapping";
import { withReservedConnection } from "./shared";

layer(legacyDatabaseLayer("legacy_original_languages"))((test) => {
	test.effect(
		"maps the TMDB Oriya label to Odia and reports an unknown language without setting one",
		() =>
			withReservedConnection((connection) =>
				Effect.gen(function* () {
					yield* connection.executeRaw(
						`DO $$ BEGIN
						INSERT INTO "metadata" ("id", "lot", "source", "identifier", "title", "original_language")
						VALUES ('odia', 'movie', 'tmdb', '1', 'Synthetic Movie', 'Oriya'),
							('unknown', 'show', 'tmdb', '2', 'Synthetic Show', ' Elvish ');
						INSERT INTO "entity" ("id", "external_id", "name", "entity_schema_slug", "entity_schema_plugin_id")
						VALUES ('odia', '1', 'Synthetic Movie', 'movie', '${mediaPluginId}'),
							('unknown', '2', 'Synthetic Show', 'show', '${mediaPluginId}');
						END $$`,
						[],
					);

					yield* migrateLegacyOriginalLanguages(connection);

					expect(
						yield* connection.execute(
							`SELECT "id", "properties" FROM "entity" ORDER BY "id"`,
							[],
							undefined,
						),
					).toEqual([
						{ id: "odia", properties: { originalLanguage: "or" } },
						{ id: "unknown", properties: {} },
					]);
					expect(
						yield* connection.execute(
							`SELECT report.level, report.code, report.count, report.message, detail.detail
							FROM "migration_report" report
							LEFT JOIN "migration_report_detail" detail ON detail.report_seq = report.seq
							ORDER BY report.seq`,
							[],
							undefined,
						),
					).toEqual([
						{
							count: 1,
							level: "warning",
							code: "original-language-unmapped",
							message:
								"Some movies and shows were migrated without an original language because the stored language name has no unambiguous language code. Each affected item is listed below with the stored value.",
							detail: {
								key: "unknown",
								label: "Synthetic Show",
								sentence:
									'The stored original language "Elvish" has no unambiguous language code, so no original language was set.',
								provenance: [
									{ key: "Media", value: "unknown" },
									{ key: "Source", value: "tmdb" },
									{ value: "Elvish", key: "Stored language" },
								],
							},
						},
						{
							count: 1,
							code: null,
							detail: null,
							level: "info",
							message: "original language value(s) migrated",
						},
					]);
				}),
			),
	);
});
