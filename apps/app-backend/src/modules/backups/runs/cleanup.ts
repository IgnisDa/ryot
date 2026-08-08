import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

export const makeBackupsFrequentTask = <E, R>(
	cleanupExpiredArtifacts: Effect.Effect<void, E, R>,
): CronTask<never, R> => ({
	name: "backups-cleanup",
	run: () =>
		cleanupExpiredArtifacts.pipe(
			Effect.catchCause((cause) => Effect.logWarning("backup cleanup listing failed", cause)),
		),
});
