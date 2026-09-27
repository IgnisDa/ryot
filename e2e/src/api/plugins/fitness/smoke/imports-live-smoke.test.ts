import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { runHevyImportFixture } from "~/fixtures/plugins/fitness";
import { describe, expect, it } from "~/support/effect-test";

const RUN_LIVE =
	process.env.RUN_LIVE_PROVIDER_TESTS === "1" || process.env.RUN_LIVE_PROVIDER_TESTS === "true";

describe.skipIf(!RUN_LIVE)("live fitness import smoke (real external APIs)", () => {
	it.live(
		"imports a Hevy workout with Free Exercise DB resolution",
		() =>
			Effect.gen(function* () {
				const { token, client } = yield* createAuthenticatedClient();
				const { runId, completedRun } = yield* runHevyImportFixture(client, token);

				expect(completedRun.id).toBe(ImportRunId.make(runId));
				expect(completedRun.source).toBe("hevy");
				expect(completedRun.status).toBe("completed");
				expect(completedRun.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);
				expect(
					completedRun.summary.find(({ unit }) => unit === "workouts")?.counts.created,
				).toBeGreaterThan(0);
				expect(completedRun.activities.every(({ state }) => state === "completed")).toBe(true);
			}),
		300_000,
	);
});
