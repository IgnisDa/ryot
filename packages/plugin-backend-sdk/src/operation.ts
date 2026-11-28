import {
	CommitConflictCode,
	OutputWithChanges,
} from "@ryot-app/contract/modules/changes/change-set";
import { LocalMessage } from "@ryot-app/i18n/message";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { OperationManifest } from "./core/script-manifest";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";

type OperationResult<Output extends Schema.Codec<unknown, unknown>> = ReturnType<
	typeof OutputWithChanges<Output>
>;

export const defineOperation = <
	const Manifest extends OperationManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
	Run extends GenericScriptDefinition<Manifest, Input, OperationResult<Output>, Failure>["run"],
>(
	definition: { readonly run: Run } & Omit<
		GenericScriptDefinition<Manifest, Input, Output, Failure>,
		"run" | "definitionType"
	>,
): { readonly run: Run } & Omit<
	GenericScriptDefinition<Manifest, Input, OperationResult<Output>, Effect.Error<ReturnType<Run>>>,
	"run"
> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	output: OutputWithChanges(definition.output),
});

/**
 * A refusal the user sees. `reason` is a message from the plugin's own catalog; the kernel stamps
 * the plugin's namespace, so it cannot name another catalog.
 */
export class OperationRejectedError extends Schema.TaggedError<
	OperationRejectedError,
	{ readonly brand: unique symbol }
>()("OperationRejectedError", { reason: LocalMessage }) {
	readonly data = { reason: this.reason, code: "operation-rejected" } as const;
}

export const reject = (reason: LocalMessage) => Effect.fail(new OperationRejectedError({ reason }));

/**
 * The baseline an operation read is gone or no longer matches what it read before. It reaches the
 * caller as the HTTP 409 `changes-conflict` the commit of stale changes raises, with `conflict`.
 */
export class StaleBaselineError extends Schema.TaggedError<
	StaleBaselineError,
	{ readonly brand: unique symbol }
>()("StaleBaselineError", { conflict: CommitConflictCode }) {
	readonly data = { conflict: this.conflict, code: "changes-conflict" } as const;
}
