import { internalError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";
import { JobQueue } from "#platform/jobs/queue";

import { UserBootstrap } from "./bootstrap";
import { UserBootstrapJob } from "./job";

export class UserBootstrapScheduling extends Context.Service<UserBootstrapScheduling>()(
	"@ryot-app/kernel-backend/modules/accounts/provisioning/scheduling/UserBootstrapScheduling",
	{
		make: Effect.gen(function* () {
			const bootstrap = yield* UserBootstrap;
			const jobs = yield* JobQueue;
			const receipts = yield* MutationReceipts.make;
			const schedule = Effect.fn("UserBootstrapScheduling.schedule")(
				function* (userId: UserId) {
					const accountGeneration = yield* receipts.currentAccount(userId);
					yield* jobs.enqueue(
						UserBootstrapJob,
						{ userId, accountGeneration },
						{ userId, key: accountGeneration.token },
					);
				},
				Effect.mapError(() => internalError("User bootstrap account is unavailable")),
			);
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
