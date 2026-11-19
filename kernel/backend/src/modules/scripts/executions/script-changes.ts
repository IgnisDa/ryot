import type { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationPopulationContext,
	ExecutionLane,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type ChangeSet,
	CommitConflictCode,
	type CommittedChanges,
} from "@ryot-app/contract/modules/changes/change-set";
import { Message } from "@ryot-app/i18n/message";
import { Context, type Effect, Schema } from "effect";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

/**
 * Durable state that records a script's result in its changes' commit transaction. `load` runs
 * first and returns the result a previous commit recorded, which ends the commit without writing;
 * `record` runs after every write.
 */
export type ChangeSetReceipt<A> = {
	readonly load: Effect.Effect<A | null, DbError>;
	readonly record: (committed: CommittedChanges) => Effect.Effect<A, DbError>;
};

export type ScriptChangesInput = {
	readonly occurredAt: string;
	readonly lane: ExecutionLane;
	/** The durable identity of the script's execution, from which every committed ID derives. */
	readonly executionId: string;
	readonly changes: undefined | ChangeSet;
	readonly principal: ScriptExecutionPrincipal;
	readonly population?: AutomationPopulationContext;
};

/** A script's changes did not commit: a stale baseline, a policy rejection, or invalid changes. */
export class ScriptChangesRejected extends Schema.TaggedError<
	ScriptChangesRejected,
	{ readonly brand: unique symbol }
>()("ScriptChangesRejected", {
	reason: Schema.Union([
		Schema.Struct({ conflict: CommitConflictCode, code: Schema.Literal("conflict") }),
		Schema.Struct({ message: Message, code: Schema.Literal("policy-rejected") }),
		Schema.Struct({ message: Schema.String, code: Schema.Literal("invalid") }),
	]),
}) {}

/** Commits the changes a script returned, under the script's principal and causation. */
export class ScriptChanges extends Context.Service<
	ScriptChanges,
	{
		/**
		 * Commits once per execution identity: the account's idempotency key holds the result. A system
		 * execution has no account, and may write only parts that repeat idempotently.
		 */
		readonly commitKeyed: (
			input: ScriptChangesInput,
		) => Effect.Effect<CommittedChanges, DbError | ScriptChangesRejected>;
		/** Commits once against the caller's durable state, which `receipt` reads and writes. */
		readonly commit: <A>(
			input: ScriptChangesInput & { readonly receipt: ChangeSetReceipt<A> },
		) => Effect.Effect<A, DbError | ScriptChangesRejected>;
	}
>()("@ryot-app/kernel-backend/modules/scripts/executions/script-changes/ScriptChanges") {}
