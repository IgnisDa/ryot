import type { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import type { ExecutionMetadata, SandboxHost, SandboxManifest, ScriptManifest } from "./core";

type ScriptExecution<
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Manifest extends SandboxManifest,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly run: (
		input: Input["Type"],
		host: Manifest extends { readonly kind: "automation"; readonly automationType: "policy" }
			? Omit<SandboxHost<Manifest["capabilities"]>, "executeWorkflow">
			: SandboxHost<Manifest["capabilities"]>,
		execution: ExecutionMetadata,
	) => Effect.Effect<Output["Type"], unknown>;
};

export const defineManifest = <const Manifest extends SandboxManifest>(manifest: Manifest) =>
	manifest;

export const SANDBOX_SCRIPT_DEFINITION = "ryot:sandbox-script" as const;
export type GenericScriptDefinition<
	Manifest extends SandboxManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
> = ScriptExecution<Input, Output, Manifest> & {
	readonly manifest: Manifest;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
};
export const defineScript = <
	const Manifest extends ScriptManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
>(
	definition: Omit<GenericScriptDefinition<Manifest, Input, Output>, "definitionType">,
): GenericScriptDefinition<Manifest, Input, Output> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
