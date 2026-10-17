import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ImportConflictError,
	ImportNotFoundError,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { CancelImportRunWorkflow } from "./cancel-workflow";
import { ImportsRepository } from "./repository";

export class ImportRunCancellationService extends Context.Service<ImportRunCancellationService>()(
	"ImportRunCancellationService",
	{
		make: Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const repository = yield* ImportsRepository;

			const cancelRun = Effect.fn("ImportRunCancellationService.cancelRun")(function* (
				user: CurrentUserValue,
				runId: ImportRunId,
			) {
				const run = yield* repository.getRunControlForUser({ runId, userId: user.id });
				if (!run) {
					return yield* new ImportNotFoundError({ reason: { runId, code: "run-not-found" } });
				}
				if (run.status === "completed" || run.status === "failed" || run.status === "expired") {
					return yield* new ImportConflictError({
						reason: { runId, status: run.status, code: "run-not-cancellable" },
					});
				}
				if (run.status !== "cancelled") {
					yield* engine
						.execute(CancelImportRunWorkflow, {
							discard: true,
							executionId: `${runId}-cancellation`,
							payload: { runId, userId: user.id, accountGeneration: user.accountGeneration },
						})
						.pipe(Effect.orDie);
				}
				return { id: runId };
			});

			return { cancelRun };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
