import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { UploadsService } from "./service";

export const uploadsFrequentTask: CronTask<never, UploadsService> = {
	name: "uploads-cleanup",
	run: () =>
		Effect.gen(function* () {
			const service = yield* UploadsService;
			yield* service.cleanupPendingIntents(100);
		}),
};
