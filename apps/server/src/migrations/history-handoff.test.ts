import { expect } from "bun:test";

import { AuthRepository } from "@ryot-app/kernel-backend/modules/accounts/auth/repository";
import { MediaHistoryDocument } from "@ryot-app/media-plugin/shared/media-history";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import { handOffLegacyHistory, type HistoryPart, LegacyHistoryAdmission } from "./history-handoff";
import {
	migrateLegacyHistory,
	seedLegacyHistory,
	userAEvents,
} from "./history-handoff.test-support";
import { legacyDatabaseLayer } from "./legacy-database.test-support";
import { withReservedConnection } from "./shared";

const handOff = (
	calls: Array<{ userId: string; part: HistoryPart }>,
	outcome: (userId: string) => "admitted" | "source-not-ready",
) =>
	handOffLegacyHistory.pipe(
		Effect.provideService(LegacyHistoryAdmission, {
			admit: (user, part) =>
				Effect.sync(() => {
					calls.push({ part, userId: user.id });
					return outcome(user.id);
				}),
		}),
	);

const insertImportRun = (
	connection: SqlConnection.Connection,
	input: { id: string; userId: string; fileName: string; admitted: boolean },
) =>
	connection.execute(
		`INSERT INTO "import_run" ("id", "user_id", "source", "input_summary", "plan")
		VALUES ($1, $2, 'media-history', jsonb_build_object('source', 'media-history', 'fileNames', jsonb_build_object('uploadToken', $3::text)),
			CASE WHEN $4 THEN '{"operation": "import", "selection": {}}'::jsonb END)`,
		[input.id, input.userId, input.fileName, input.admitted],
		undefined,
	);

const decodeDocument = (part: undefined | HistoryPart) =>
	Schema.decodeEffect(Schema.fromJsonString(MediaHistoryDocument))(
		new TextDecoder().decode(part?.bytes),
	);

layer(Layer.provideMerge(AuthRepository.layer, legacyDatabaseLayer("legacy_history_handoff")))(
	(test) => {
		test.effect(
			"admits each user's history once across deferrals and restarts, retrying runs that never finished admission",
			() =>
				withReservedConnection((connection) =>
					Effect.gen(function* () {
						yield* seedLegacyHistory(connection);
						yield* migrateLegacyHistory(connection);
						yield* connection.executeRaw(
							`UPDATE "user" SET "disabled_at" = now() WHERE "id" = 'user-c'`,
							[],
						);
						const handoffReports = () =>
							connection.execute(
								`SELECT "count", "message" FROM "migration_report"
							WHERE "phase" = 'history handoff -> import runs' ORDER BY "seq"`,
								[],
								undefined,
							);
						const stagingPresent = () =>
							connection.execute(
								`SELECT to_regclass('"legacy_history_handoff"') IS NOT NULL AS "present"`,
								[],
								undefined,
							);

						const deferred: Array<{ userId: string; part: HistoryPart }> = [];
						yield* handOff(deferred, (userId) =>
							userId === "user-a" ? "admitted" : "source-not-ready",
						);
						expect(deferred.map(({ userId }) => userId)).toEqual(["user-a", "user-b"]);
						expect(yield* stagingPresent()).toEqual([{ present: true }]);
						expect(yield* handoffReports()).toEqual([]);
						expect(yield* decodeDocument(deferred[0]?.part)).toEqual([
							{
								externalId: "1399",
								title: "Synthetic Show",
								entitySchemaSlug: "show",
								providerSlug: "show.tmdb",
								events: [
									userAEvents.seenComplete,
									userAEvents.seenProgress,
									userAEvents.reviewEpisode,
									userAEvents.reviewSeason,
								],
							},
						]);

						const [userAPart, userBPart] = deferred.map(({ part }) => part);
						yield* insertImportRun(connection, {
							id: "run-a",
							admitted: true,
							userId: "user-a",
							fileName: userAPart?.fileName ?? "",
						});
						yield* insertImportRun(connection, {
							id: "run-b",
							admitted: false,
							userId: "user-b",
							fileName: userBPart?.fileName ?? "",
						});

						const resumed: Array<{ userId: string; part: HistoryPart }> = [];
						yield* handOff(resumed, () => "admitted");
						expect(resumed).toEqual<unknown>([{ part: userBPart, userId: "user-b" }]);
						expect(yield* stagingPresent()).toEqual([{ present: false }]);
						expect(yield* handoffReports()).toEqual([
							{ count: 2, message: "Media history import run(s) hold handed-off records" },
							{
								count: 1,
								message:
									"user(s) disabled or deleted before admission keep their handed-off records unimported",
							},
						]);

						const restarted: Array<{ userId: string; part: HistoryPart }> = [];
						yield* handOff(restarted, () => "admitted");
						expect(restarted).toEqual([]);
						expect(yield* handoffReports()).toHaveLength(2);
					}),
				),
		);
	},
);
