import { DbError } from "@ryot-app/contract/errors";
import {
	type UserCommand,
	UserCommandResult,
} from "@ryot-app/contract/modules/mutations/user-command";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { UserCommandWorkflow } from "./workflow";

export class UserCommands extends Context.Service<UserCommands>()("UserCommands", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const receipts = yield* MutationReceipts.make;
		const lifecycle = yield* LifecycleExecution;
		const commit = Effect.fn("UserCommands.commit")(function* (
			input: UserCommand,
			command: DomainLifecycleCommand,
			userId: UserId,
		) {
			const replay = yield* receipts
				.peek(
					mutationReceiptIdentity({
						input,
						command,
						ownerUserId: userId,
						scopeUserId: userId,
						commandKind: "user-command:commit",
					}),
					UserCommandResult,
				)
				.pipe(
					Effect.catchTag(
						"MutationReceiptIdentityConflict",
						() => new DbError({ message: "Command identity reused with different input" }),
					),
				);
			if (replay) {
				yield* lifecycle
					.dispatch(replay.dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
				return replay.result;
			}
			const result = yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				UserCommandWorkflow,
				command.accountGeneration,
				{ payload: { input, userId, command } },
				(admission) => admission,
				(execution) => execution,
			);
			return result;
		});
		return { commit };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
