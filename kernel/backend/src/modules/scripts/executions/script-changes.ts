import type { DbError, SandboxFailureKind } from "@ryot-app/contract/errors";
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

/** How a caller reports a rejection: the failure kind, a stable code and a diagnostic message. */
export type ScriptChangesFailure =
	| {
			readonly message: string;
			readonly code: "changes-rejected";
			readonly kind: Extract<SandboxFailureKind, "invalid-output">;
	  }
	| {
			readonly message: string;
			readonly code: CommitConflictCode | "policy-unavailable";
			readonly kind: Extract<SandboxFailureKind, "resource-unavailable">;
	  }
	| {
			readonly reason: Message;
			readonly message: string;
			readonly code: "policy-rejected" | "changes-refused";
			readonly kind: Extract<SandboxFailureKind, "script-failure">;
	  };

/**
 * A script's changes did not commit: a stale baseline, a policy that could not run, a policy
 * rejection, a refusal of what the changes ask for, or invalid changes.
 */
export class ScriptChangesRejected extends Schema.TaggedError<
	ScriptChangesRejected,
	{ readonly brand: unique symbol }
>()("ScriptChangesRejected", {
	reason: Schema.Union([
		Schema.Struct({ conflict: CommitConflictCode, code: Schema.Literal("conflict") }),
		Schema.Struct({ message: Schema.String, code: Schema.Literal("policy-unavailable") }),
		Schema.Struct({ message: Message, code: Schema.Literal("policy-rejected") }),
		Schema.Struct({ message: Message, code: Schema.Literal("refused") }),
		Schema.Struct({ message: Schema.String, code: Schema.Literal("invalid") }),
	]),
}) {}

/**
 * A conflict or an unavailable policy is retryable, a policy rejection or refusal is the script's
 * failure, anything else is invalid output.
 */
export const scriptChangesFailure = ({ reason }: ScriptChangesRejected): ScriptChangesFailure => {
	if (reason.code === "conflict") {
		return {
			code: reason.conflict,
			kind: "resource-unavailable",
			message: `Changes conflicted with a newer write (${reason.conflict})`,
		};
	}
	if (reason.code === "policy-unavailable") {
		return {
			code: reason.code,
			kind: "resource-unavailable",
			message: `A policy could not run (${reason.message})`,
		};
	}
	if (reason.code === "policy-rejected") {
		return {
			code: reason.code,
			kind: "script-failure",
			reason: reason.message,
			message: "A policy rejected the changes",
		};
	}
	if (reason.code === "refused") {
		return {
			kind: "script-failure",
			reason: reason.message,
			code: "changes-refused",
			message: "The changes were refused",
		};
	}
	return {
		kind: "invalid-output",
		code: "changes-rejected",
		message: `Changes were rejected (${reason.message})`,
	};
};

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
