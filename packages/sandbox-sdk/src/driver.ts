import type { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import type {
	ExecutionMetadata,
	PolicyHost,
	SandboxManifest,
	ScriptHost,
	ScriptManifest,
} from "./core";

type ScriptExecution<
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Manifest extends SandboxManifest,
	Failure,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly run: (
		input: Input["Type"],
		host: Manifest extends { readonly kind: "automation"; readonly automationType: "policy" }
			? PolicyHost
			: ScriptHost,
		execution: ExecutionMetadata,
	) => Effect.Effect<Output["Type"], Failure>;
};

export const defineManifest = <const Manifest extends SandboxManifest>(
	manifest: Manifest & { readonly capabilities?: never },
): Manifest => manifest;

export const SANDBOX_SCRIPT_DEFINITION = "ryot:sandbox-script" as const;
export type GenericScriptDefinition<
	Manifest extends SandboxManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
> = ScriptExecution<Input, Output, Manifest, Failure> & {
	readonly manifest: Manifest;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
};
export const defineScript = <
	const Manifest extends ScriptManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
	Run extends ScriptExecution<Input, Output, Manifest, Failure>["run"],
>(
	definition: Omit<
		GenericScriptDefinition<Manifest, Input, Output, Failure>,
		"definitionType" | "run"
	> & { readonly run: Run },
): Omit<GenericScriptDefinition<Manifest, Input, Output, Effect.Error<ReturnType<Run>>>, "run"> & {
	readonly run: Run;
} => ({ ...definition, definitionType: SANDBOX_SCRIPT_DEFINITION });
