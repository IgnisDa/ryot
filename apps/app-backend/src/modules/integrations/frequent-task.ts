import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Schema } from "effect";

import type { DbRunner } from "#lib/db/service";
import type { ImportsRepository } from "#modules/imports/repository";
import type { CronTask } from "#modules/scheduler/types";

import { IntegrationsService } from "./service";

export type FrequentCronTask = CronTask<
	never,
	IntegrationsService | DbRunner | ImportsRepository | WorkflowEngine | WorkflowInstance
>;

export const integrationsFrequentTask: FrequentCronTask = {
	name: "integrations-reconcile",
	run: () =>
		Effect.gen(function* () {
			const service = yield* IntegrationsService;
			yield* Activity.make({
				error: Schema.Never,
				name: "integrations-reconcile",
				execute: service.reconcileScheduledYankRuns().pipe(Effect.orDie),
			});
		}),
};
