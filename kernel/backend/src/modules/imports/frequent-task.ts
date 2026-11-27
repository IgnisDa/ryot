import { Effect } from "effect";

import { ImportsService } from "./service";

export const ingestionFrequentTask = {
	name: "ingestion-recovery",
	run: () =>
		Effect.flatMap(ImportsService, (service) => service.recoverRuns()).pipe(
			Effect.catchCause((cause) => Effect.logWarning("ingestion recovery failed", cause)),
		),
};
