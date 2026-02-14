import type { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import type {
	ExecutionMetadata,
	SandboxHost,
	SandboxHostCapability,
	SandboxManifest,
	ScriptManifest,
} from "./core.js";

export type GenericDriver<
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
export const defineDriver = <
	const Manifest extends SandboxManifest,
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
>(
	_manifest: Manifest,
	driver: GenericDriver<Input, Output, Manifest["capabilities"]>,
) => driver;

export const SANDBOX_SCRIPT_DEFINITION = "ryot:sandbox-script" as const;
export type GenericScriptDefinition<
	Manifest extends SandboxManifest,
	Drivers extends Record<string, unknown>,
> = {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
};
export const defineScript = <
	const Manifest extends ScriptManifest,
	const Drivers extends Record<string, unknown>,
>(definition: {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
}) => ({ ...definition, definitionType: SANDBOX_SCRIPT_DEFINITION });
