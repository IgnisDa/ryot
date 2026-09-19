import { internalError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { UserBootstrap } from "./bootstrap";
import { UserBootstrapWorkflow } from "./workflow";

export const userBootstrapWorkflowExecutionId = (userId: UserId) =>
	`user-bootstrap-${userId.length}-${userId}`;

export class UserBootstrapScheduling extends Context.Service<UserBootstrapScheduling>()(
	"UserBootstrapScheduling",
	{
		make: Effect.gen(function* () {
			const bootstrap = yield* UserBootstrap;
			const engine = yield* WorkflowEngine;
			const schedule = Effect.fn("UserBootstrapScheduling.schedule")(function* (userId: UserId) {
				yield* engine
					.execute(UserBootstrapWorkflow, {
						discard: true,
						payload: { userId },
						executionId: userBootstrapWorkflowExecutionId(userId),
					})
					.pipe(Effect.mapError(() => internalError("User bootstrap could not be scheduled")));
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
