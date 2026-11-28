import { expect } from "bun:test";

import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import {
	migrateLegacyHistory,
	seedLegacyHistory,
	userAEvents,
} from "./history-handoff.test-support";
import { legacyDatabaseLayer, mediaPluginId } from "./legacy-database.test-support";
import { withReservedConnection } from "./shared";

const handedOffSentence =
	"so this watch was handed to a Media history import run for its user, which fetches the title from its provider before recording it.";

layer(legacyDatabaseLayer("legacy_history_staging"))((test) => {
	test.effect(
		"stages absent watches and reviews on provider parents of enabled users and clears only their parents' population",
		() =>
			withReservedConnection((connection) =>
				Effect.gen(function* () {
					yield* seedLegacyHistory(connection);
					yield* migrateLegacyHistory(connection);

					const staged = () =>
						connection.execute(
							`SELECT "legacy_kind" AS "kind", "legacy_record_id" AS "recordId", "user_id" AS "userId",
								"plugin_id" AS "pluginId", "parent_entity_id" AS "parentId", "title",
								"external_id" AS "externalId", "provider_slug" AS "providerSlug",
								"entity_schema_slug" AS "entitySchemaSlug", "event"
							FROM "legacy_history_handoff" ORDER BY "legacy_record_id"`,
							[],
							undefined,
						);
					const parent = {
						parentId: "show",
						externalId: "1399",
						pluginId: mediaPluginId,
						title: "Synthetic Show",
						entitySchemaSlug: "show",
						providerSlug: "show.tmdb",
					};
					const userBEvent = {
						eventSchemaSlug: "complete",
						episode: { type: "show", seasonNumber: 2, episodeNumber: 2 },
					};
					const expectedStaged = [
						{
							...parent,
							kind: "review",
							userId: "user-a",
							recordId: "review-episode",
							event: userAEvents.reviewEpisode,
						},
						{
							...parent,
							kind: "review",
							userId: "user-a",
							recordId: "review-season",
							event: userAEvents.reviewSeason,
						},
						{
							...parent,
							kind: "seen",
							userId: "user-b",
							recordId: "seen-b",
							event: {
								...userBEvent,
								occurredAt: "2024-04-01T00:00:00.000Z",
								properties: { dateUnknown: true, sourceRun: "seen:seen-b" },
							},
						},
						{
							...parent,
							kind: "seen",
							userId: "user-c",
							recordId: "seen-c",
							event: {
								...userBEvent,
								occurredAt: "2024-04-02T00:00:00.000Z",
								properties: { dateUnknown: true, sourceRun: "seen:seen-c" },
							},
						},
						{
							...parent,
							kind: "seen",
							userId: "user-a",
							recordId: "seen-complete",
							event: userAEvents.seenComplete,
						},
						{
							...parent,
							kind: "seen",
							userId: "user-a",
							recordId: "seen-progress",
							event: userAEvents.seenProgress,
						},
					];
					expect(yield* staged()).toEqual(expectedStaged);

					const events = () =>
						connection.execute(
							`SELECT "event_schema_slug" AS "slug", "entity_id" AS "entityId", "user_id" AS "userId"
							FROM "event" ORDER BY "event_schema_slug"`,
							[],
							undefined,
						);
					const expectedEvents = [
						{ slug: "complete", userId: "user-a", entityId: "show-s1e1" },
						{ slug: "dropped", entityId: "show", userId: "user-a" },
						{ slug: "review", userId: "user-a", entityId: "show-s1e1" },
					];
					expect(yield* events()).toEqual(expectedEvents);

					const populated = () =>
						connection.execute(
							`SELECT "id", "populated_at" IS NOT NULL AS "populated" FROM "entity"
							WHERE "entity_schema_slug" = 'show' ORDER BY "id"`,
							[],
							undefined,
						);
					expect(yield* populated()).toEqual([
						{ populated: false, id: "custom-show" },
						{ populated: true, id: "other-show" },
						{ id: "show", populated: false },
					]);

					expect(
						yield* connection.execute(
							`SELECT report.phase, report.code, report.count,
								array_agg(detail.detail ->> 'key' ORDER BY detail.detail ->> 'key') AS "keys"
							FROM "migration_report" report
							INNER JOIN "migration_report_detail" detail ON detail.report_seq = report.seq
							WHERE report.level = 'warning'
							GROUP BY report.seq ORDER BY report.seq`,
							[],
							undefined,
						),
					).toEqual([
						{
							count: 1,
							keys: ["review-season"],
							phase: "review -> event",
							code: "review-season-handed-off",
						},
						{
							count: 1,
							keys: ["review-custom"],
							phase: "review -> event",
							code: "review-episode-absent",
						},
						{
							count: 1,
							keys: ["review-episode"],
							phase: "review -> event",
							code: "review-episode-handed-off",
						},
						{
							count: 3,
							phase: "seen -> event",
							code: "seen-episode-absent",
							keys: ["seen-custom", "seen-disabled", "seen-dropped"],
						},
						{
							count: 4,
							phase: "seen -> event",
							code: "seen-episode-handed-off",
							keys: ["seen-b", "seen-c", "seen-complete", "seen-progress"],
						},
					]);
					expect(
						yield* connection.execute(
							`SELECT detail.detail ->> 'sentence' AS "sentence" FROM "migration_report_detail" detail
							WHERE detail.detail ->> 'key' IN ('seen-complete', 'seen-progress')
							ORDER BY detail.detail ->> 'key'`,
							[],
							undefined,
						),
					).toEqual([
						{
							sentence: `The show's stored season list has no season 2 — it has seasons 1 — ${handedOffSentence}`,
						},
						{
							sentence: `Season 1 is in the show's stored season list but has no episode 5, ${handedOffSentence}`,
						},
					]);

					yield* migrateLegacyHistory(connection);
					expect(yield* staged()).toEqual(expectedStaged);
					expect(yield* events()).toEqual(expectedEvents);
					expect(yield* populated()).toEqual([
						{ populated: false, id: "custom-show" },
						{ populated: true, id: "other-show" },
						{ id: "show", populated: false },
					]);
				}),
			),
	);
});
