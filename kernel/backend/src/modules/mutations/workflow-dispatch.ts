import { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, type Schema } from "effect";
import type { Workflow } from "effect/workflow";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import {
	WorkflowAccountRejected,
	WorkflowAccounts,
	WorkflowAdmissionAccount,
} from "#platform/workflow/account";

// Binds the running workflow to the account it works for; a no-op once it does.
export const admitWorkflow = (account: null | UserId) =>
	Effect.flatMap(WorkflowAccounts, (accounts) => accounts.adopt(account));

// Starts or joins a workflow that works for `account`; a retired account fails with `DbError`.
export const dispatchAdmittedWorkflow = Effect.fnUntraced(function* <
	Name extends string,
	Payload extends Workflow.AnyStructSchema,
	Success extends Schema.Top,
	Error extends Schema.Top,
	const Discard extends boolean = false,
>(
	engine: WorkflowEngine["Service"],
	workflow: Workflow.Workflow<Name, Payload, Success, Error>,
	account: null | UserId,
	options: {
		readonly discard?: Discard;
		readonly executionId?: string;
		readonly payload: Payload["Type"];
		readonly suspendedRetrySchedule?: Parameters<
			WorkflowEngine["Service"]["execute"]
		>[1]["suspendedRetrySchedule"];
	},
) {
	const executionId = options.executionId ?? (yield* workflow.executionId(options.payload));
	return yield* engine.execute(workflow, { ...options, executionId }).pipe(
		Effect.provideService(WorkflowAdmissionAccount, account),
		Effect.catchDefect((defect) =>
			defect instanceof WorkflowAccountRejected
				? Effect.fail(new DbError({ message: defect.message }))
				: Effect.die(defect),
		),
	);
});
