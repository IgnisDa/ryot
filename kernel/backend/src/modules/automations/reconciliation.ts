import type { DbError } from "@ryot-app/contract/errors";
import type { AutomationRun } from "@ryot-app/contract/modules/automations/lifecycle";
import { Context, DateTime, Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import type { CronTask } from "#modules/scheduler/types";

import {
	AUTOMATION_IMMEDIATE_CONCURRENCY,
	AUTOMATION_IMMEDIATE_TIMEOUT_MS,
	AutomationExecutionOperations,
} from "./execution";
import { AutomationRunRepository } from "./run-repository";

export const AUTOMATION_RECONCILIATION_BATCH_SIZE = 100;

export class AutomationReconciliationOperations extends Context.Service<
	AutomationReconciliationOperations,
	{
		listQueuedCandidates: (input: {
			now: Date;
			limit: number;
		}) => Effect.Effect<ReadonlyArray<Pick<AutomationRun, "id" | "attemptCount">>, DbError>;
		submit: AutomationExecutionOperations["Service"]["submit"];
	}
>()("AutomationReconciliationOperations") {}

export const AutomationReconciliationOperationsLive = Layer.effect(
	AutomationReconciliationOperations,
	Effect.gen(function* () {
		const repository = yield* AutomationRunRepository;
		const database = yield* Database;
		const execution = yield* AutomationExecutionOperations;
		return AutomationReconciliationOperations.of({
			submit: execution.submit,
			listQueuedCandidates: (input) =>
				repository.listQueuedCandidates(input).pipe(Effect.provideService(Database, database)),
		});
	}),
);

export class AutomationReconciliation extends Context.Service<AutomationReconciliation>()(
	"AutomationReconciliation",
	{
		make: Effect.gen(function* () {
			const operations = yield* AutomationReconciliationOperations;
			const reconcile = Effect.fn("AutomationReconciliation.reconcile")(function* () {
				const now = DateTime.toDate(yield* DateTime.now);
				const candidates = yield* operations.listQueuedCandidates({
					now,
					limit: AUTOMATION_RECONCILIATION_BATCH_SIZE,
				});
				yield* Effect.forEach(
					candidates,
					(run) => {
						const payload = { runId: run.id, attemptNumber: run.attemptCount + 1 };
						return operations.submit(payload).pipe(
							Effect.timeout(AUTOMATION_IMMEDIATE_TIMEOUT_MS),
							Effect.catchCause(() =>
								Effect.logWarning("automation reconciliation submission failed").pipe(
									Effect.annotateLogs(payload),
								),
							),
						);
					},
					{ discard: true, concurrency: AUTOMATION_IMMEDIATE_CONCURRENCY },
				);
			});
			return { reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const automationsFrequentTask: CronTask<never, AutomationReconciliation> = {
	name: "automations-reconciliation",
	run: () =>
		Effect.flatMap(AutomationReconciliation, (service) => service.reconcile()).pipe(
			Effect.catchCause(() => Effect.logWarning("automation reconciliation listing failed")),
		),
};
