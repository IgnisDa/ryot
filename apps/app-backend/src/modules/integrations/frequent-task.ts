import { Effect } from "effect";

import type { DbRunner } from "#lib/db/service";
import type { ImportsRepository } from "#modules/imports/repository";
import type { CronTask } from "#modules/scheduler/types";

import { IntegrationsService } from "./service";

export type FrequentCronTask = CronTask<IntegrationsService | DbRunner | ImportsRepository>;

export const integrationsFrequentTask: FrequentCronTask = {
	name: "integrations-reconcile",
	run: Effect.gen(function* () {
		const service = yield* IntegrationsService;
		yield* service.reconcileScheduledYankRuns().pipe(Effect.orDie);
	}),
};
