import { expect } from "bun:test";

import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { buildCollectionEntityMigrationSql } from "./collection-mapping";
import { insertUsers, legacyDatabaseLayer } from "./legacy-database.test-support";
import { withReservedConnection } from "./shared";

layer(legacyDatabaseLayer("legacy_collections"))((test) => {
	test.effect(
		"keeps the earliest of one user's trimmed-duplicate collection names and gives later ones the next unused suffix",
		() =>
			withReservedConnection((connection) =>
				Effect.gen(function* () {
					yield* insertUsers(connection, ["reader", "other"]);
					yield* connection.executeRaw(
						`INSERT INTO "collection" ("id", "user_id", "name", "created_on") VALUES
						('taken', 'reader', 'Reading (2)', '2020-01-01'),
						('first', 'reader', 'Reading', '2020-01-02'),
						('second', 'reader', 'Reading ', '2020-01-03'),
						('third', 'reader', ' Reading', '2020-01-03'),
						('elsewhere', 'other', 'Reading', '2020-01-04')`,
						[],
					);

					yield* connection.executeRaw(
						buildCollectionEntityMigrationSql({ pluginId: null, slug: "collection" }),
						[],
					);

					expect(
						yield* connection.execute(
							`SELECT "id", "user_id" AS "userId", "name" FROM "entity"
							WHERE "entity_schema_slug" = 'collection' ORDER BY "id"`,
							[],
							undefined,
						),
					).toEqual([
						{ id: "elsewhere", userId: "other", name: "Reading" },
						{ id: "first", name: "Reading", userId: "reader" },
						{ id: "second", userId: "reader", name: "Reading (3)" },
						{ id: "taken", userId: "reader", name: "Reading (2)" },
						{ id: "third", userId: "reader", name: "Reading (4)" },
					]);
					expect(
						yield* connection.execute(
							`SELECT report.phase, report.code, report.count, detail.detail
							FROM "migration_report" report
							INNER JOIN "migration_report_detail" detail ON detail.report_seq = report.seq
							WHERE report.level = 'warning' ORDER BY detail.detail ->> 'key'`,
							[],
							undefined,
						),
					).toEqual(
						[
							["second", "Reading (3)", '"Reading "'],
							["third", "Reading (4)", '" Reading"'],
						].map(([id, name, legacyName]) => ({
							count: 2,
							phase: "collection -> entity",
							code: "collection-name-duplicate-renamed",
							detail: {
								key: id,
								label: name,
								sentence: `Another collection of this user is also named "Reading", so this one is now named "${name}".`,
								provenance: [
									{ value: id, key: "Collection" },
									{ key: "User", value: "reader" },
									{ value: legacyName, key: "Legacy name" },
									{ value: "first", key: "Name kept by" },
								],
							},
						})),
					);
				}),
			),
	);
});
