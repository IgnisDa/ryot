import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { UploadIntentsService } from "./intents/service";

export const uploadsFrequentTask: CronTask<never, UploadIntentsService> = {
	name: "uploads-cleanup",
	run: () =>
		Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			yield* service.cleanupPendingIntents(100);
		}),
};
