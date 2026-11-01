import type { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect, Schema } from "effect";
import type { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { WorkflowIdentity } from "./identity";

// The account an execution admitted from here works for. `undefined` inherits the parent's.
export const WorkflowAdmissionAccount = Context.Reference<null | undefined | AccountGeneration>(
	"@ryot-app/kernel-backend/platform/workflow/account/WorkflowAdmissionAccount",
	{ defaultValue: () => undefined },
);

// The engine's execute contract has no admission error, so a fenced admission dies with this.
export class WorkflowAccountRejected extends Schema.TaggedError<
	WorkflowAccountRejected,
	{ readonly brand: unique symbol }
>()("WorkflowAccountRejected", { message: Schema.String }) {}

export class WorkflowAccounts extends Context.Service<
	WorkflowAccounts,
	{
		readonly listActive: (userId: UserId) => Effect.Effect<ReadonlyArray<WorkflowIdentity>>;
		// Binds the running execution to an account, unless it already works for that account.
		readonly adopt: (
			account: null | AccountGeneration,
		) => Effect.Effect<void, DbError, WorkflowInstance>;
	}
>()("@ryot-app/kernel-backend/platform/workflow/account/WorkflowAccounts") {}
