import type { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxHostMethodMap } from "./core/host-contracts";
import type { ExecutionMetadata, ScriptManifest } from "./core/script-manifest";
import { SANDBOX_SCRIPT_DEFINITION } from "./driver";

export { defineManifest } from "./driver";

export type AgentHost = Pick<SandboxHostMethodMap, "log" | "span" | "invokeCapability">;

export const defineScript = <
	const Manifest extends ScriptManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
	Failure,
>(definition: {
	readonly input: Input;
	readonly output: Output;
	readonly manifest: Manifest;
	readonly run: (
		input: Input["Type"],
		host: AgentHost,
		execution: ExecutionMetadata,
	) => Effect.Effect<Output["Type"], Failure>;
}) => ({ ...definition, definitionType: SANDBOX_SCRIPT_DEFINITION });
