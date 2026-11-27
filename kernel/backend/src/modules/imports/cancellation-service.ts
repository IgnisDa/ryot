import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ImportConflictError,
	ImportNotFoundError,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { ImportRunExecutionController } from "./execution-controller";
import { ImportsRepository } from "./repository";

export class ImportRunCancellationService extends Context.Service<ImportRunCancellationService>()(
	"@ryot-app/kernel-backend/modules/imports/cancellation-service/ImportRunCancellationService",
	{
		make: Effect.gen(function* () {
			const controller = yield* ImportRunExecutionController;
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
					yield* repository.cancelIngestion({ runId, userId: user.id }).pipe(Effect.orDie);
					const current = yield* repository.getRunControlForUser({ runId, userId: user.id });
					if (current?.status === "cancelling") {
						yield* controller
							.interrupt({ runId, executionKind: current.executionKind })
							.pipe(Effect.orDie);
					}
				}
				return { id: runId };
			});

			return { cancelRun };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
