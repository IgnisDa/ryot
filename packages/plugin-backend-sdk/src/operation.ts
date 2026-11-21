import { OutputWithChanges } from "@ryot-app/contract/modules/changes/change-set";
import { LocalMessage } from "@ryot-app/i18n/message";
import { type Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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
