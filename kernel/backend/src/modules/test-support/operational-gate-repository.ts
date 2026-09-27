import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { importRun } from "#lib/infrastructure/db/schema/tables/imports";
import { DatabaseSession } from "#lib/infrastructure/db/session";

export class OperationalGateRepository extends Context.Service<OperationalGateRepository>()(
	"OperationalGateRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const runningScope = Effect.fn("OperationalGateRepository.runningScope")(function* (
				runId: ImportRunId,
			) {
				const [run] = yield* database.run((db) =>
					db.select().from(importRun).where(eq(importRun.id, runId)).limit(1),
				);
				if (
					run?.status !== "running" ||
					run.inputSummary["kind"] !== "workflow-load-operational-gate"
				) {
					return null;
				}
				const userId = UserId.make(run.userId);
				return { runId, userId, accountGeneration: { userId, token: run.accountGeneration } };
			});
			return { runningScope };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
