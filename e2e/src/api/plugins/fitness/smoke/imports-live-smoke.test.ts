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
				expect(completedRun.failedItems).toBe(0);
				expect(completedRun.importedItems).toBeGreaterThan(0);
				expect(completedRun.progress).toBe(100);
			}),
		300_000,
	);
});
