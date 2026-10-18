import type { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { OperationManifest } from "./core/script-manifest";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";

export const defineOperation = <
	const Manifest extends OperationManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
	Run extends GenericScriptDefinition<Manifest, Input, Output, Failure>["run"],
>(
	definition: { readonly run: Run } & Omit<
		GenericScriptDefinition<Manifest, Input, Output, Failure>,
		"run" | "definitionType"
	>,
): { readonly run: Run } & Omit<
	GenericScriptDefinition<Manifest, Input, Output, Effect.Error<ReturnType<Run>>>,
	"run"
> => ({ ...definition, definitionType: SANDBOX_SCRIPT_DEFINITION });

export class OperationRejectedError extends Error {
	readonly _tag = "OperationRejectedError";
	readonly data = { code: "operation-rejected" } as const;
}
