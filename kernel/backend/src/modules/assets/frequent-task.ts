import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { ManagedAssetCollector } from "./storage/managed-asset-collector";
import { UploadIntentsService } from "./uploads/intents";

export const uploadsFrequentTask: CronTask<never, UploadIntentsService> = {
	name: "uploads-cleanup",
	run: () =>
		Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			yield* service.cleanupPendingIntents(100);
		}),
};

export const managedAssetsFrequentTask: CronTask<never, ManagedAssetCollector> = {
	name: "managed-asset-collection",
	run: () =>
		Effect.gen(function* () {
			const collector = yield* ManagedAssetCollector;
			yield* collector.runBatch(100);
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("managed asset collection batch failed", cause),
			),
		),
};
