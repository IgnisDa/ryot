import type { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import type {
	ExecutionMetadata,
	SandboxHost,
	SandboxHostCapability,
	SandboxManifest,
	ScriptManifest,
} from "./core";

type ScriptExecution<
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
	Capabilities extends readonly SandboxHostCapability[],
> = {
	readonly input: Input;
	readonly output: Output;
	readonly run: (
		input: Schema.Schema.Type<Input>,
		host: SandboxHost<Capabilities>,
		execution: ExecutionMetadata,
	) => Effect.Effect<Schema.Schema.Type<Output>, unknown>;
};

export const defineManifest = <const Manifest extends SandboxManifest>(manifest: Manifest) =>
	manifest;

export const SANDBOX_SCRIPT_DEFINITION = "ryot:sandbox-script" as const;
export type GenericScriptDefinition<
	Manifest extends SandboxManifest,
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
> = ScriptExecution<Input, Output, Manifest["capabilities"]> & {
	readonly manifest: Manifest;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
};
export const defineScript = <
	const Manifest extends ScriptManifest,
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
>(
	definition: Omit<GenericScriptDefinition<Manifest, Input, Output>, "definitionType">,
): GenericScriptDefinition<Manifest, Input, Output> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
