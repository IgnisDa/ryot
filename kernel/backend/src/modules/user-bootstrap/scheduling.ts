import { internalError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { UserBootstrap } from "./bootstrap";
import { UserBootstrapWorkflow } from "./workflow";

export const userBootstrapWorkflowExecutionId = (
	userId: UserId,
	accountGeneration: AccountGeneration,
) => `user-bootstrap-${userId.length}-${userId}-${accountGeneration.token}`;

export class UserBootstrapScheduling extends Context.Service<UserBootstrapScheduling>()(
	"UserBootstrapScheduling",
	{
		make: Effect.gen(function* () {
			const bootstrap = yield* UserBootstrap;
			const engine = yield* WorkflowEngine;
			const receipts = yield* MutationReceipts.make;
			const schedule = Effect.fn("UserBootstrapScheduling.schedule")(function* (userId: UserId) {
				const accountGeneration = yield* receipts
					.currentAccount(userId)
					.pipe(Effect.mapError(() => internalError("User bootstrap account is unavailable")));
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					UserBootstrapWorkflow,
					accountGeneration,
					{
						discard: true,
						payload: { userId, accountGeneration },
						executionId: userBootstrapWorkflowExecutionId(userId, accountGeneration),
					},
					(admission) =>
						admission.pipe(
							Effect.mapError(() => internalError("User bootstrap account is unavailable")),
						),
					(execution) =>
						execution.pipe(
							Effect.mapError(() => internalError("User bootstrap could not be scheduled")),
						),
				);
			});
			const reconcile = Effect.fn("UserBootstrapScheduling.reconcile")(function* (limit: number) {
				const incomplete = yield* bootstrap.listIncomplete(limit);
				yield* Effect.forEach(
					incomplete,
					({ id }) =>
						schedule(UserId.make(id)).pipe(
							Effect.catchCause((cause) =>
								Effect.logError("user bootstrap recovery scheduling failed", cause).pipe(
									Effect.annotateLogs({ userId: id }),
								),
							),
						),
					{ discard: true },
				);
			});
			return { schedule, reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
