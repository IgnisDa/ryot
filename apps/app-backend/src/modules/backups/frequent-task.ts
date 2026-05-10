import { Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";
import type { CronTask } from "#modules/scheduler/types";

import { BackupsService } from "./service";

export const backupsFrequentTask: CronTask<never, BackupsService | Database> = {
	name: "backups-cleanup",
	run: () =>
		Effect.gen(function* () {
			const service = yield* BackupsService;
			yield* service.cleanupExpiredArtifacts(100);
		}).pipe(
			Effect.catchCause((cause) => Effect.logWarning("backup cleanup listing failed", cause)),
		),
};
