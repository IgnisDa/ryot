import { OutputWithChanges } from "@ryot-app/contract/modules/changes/change-set";
import type { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxManifest } from "./core/script-manifest";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";

/** The run of a definition that returns `{ output, changes? }`: the kernel commits `changes` once. */
export type RunWithChanges<
	Manifest extends SandboxManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
> = GenericScriptDefinition<Manifest, Input, ResultWithChanges<Output>, Failure>["run"];

export type DefinitionWithChangesInput<
	Manifest extends SandboxManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
	Run,
> = { readonly run: Run } & Omit<
	GenericScriptDefinition<Manifest, Input, Output, Failure>,
	"run" | "definitionType"
>;

type ResultWithChanges<Output extends Schema.Codec<unknown, unknown>> = ReturnType<
	typeof OutputWithChanges<Output>
>;

export const defineWithChanges = <
	Manifest extends SandboxManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
	Run extends RunWithChanges<Manifest, Input, Output, Failure>,
>(
	definition: DefinitionWithChangesInput<Manifest, Input, Output, Failure, Run>,
): { readonly run: Run } & Omit<
	GenericScriptDefinition<
		Manifest,
		Input,
		ResultWithChanges<Output>,
		Effect.Error<ReturnType<Run>>
	>,
	"run"
> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	output: OutputWithChanges(definition.output),
});
