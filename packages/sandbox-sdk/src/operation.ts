import type { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import type { OperationManifest } from "./core";
import { SANDBOX_SCRIPT_DEFINITION, type GenericScriptDefinition } from "./driver";

export const defineOperation = <
	const Manifest extends OperationManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
	Run extends GenericScriptDefinition<Manifest, Input, Output, Failure>["run"],
>(
	definition: Omit<
		GenericScriptDefinition<Manifest, Input, Output, Failure>,
		"definitionType" | "run"
	> & { readonly run: Run },
): Omit<GenericScriptDefinition<Manifest, Input, Output, Effect.Error<ReturnType<Run>>>, "run"> & {
	readonly run: Run;
} => ({ ...definition, definitionType: SANDBOX_SCRIPT_DEFINITION });
