import type { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import type { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import type { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxHostError } from "../wire";
import type { SandboxHostMethodMap } from "./host-contracts";

export type ScriptHost = Readonly<SandboxWorkflowHost & SandboxHostMethodMap>;
export type PolicyHost = Readonly<
	Pick<SandboxHostMethodMap, (typeof POLICY_SAFE_SANDBOX_CAPABILITIES)[number]>
>;
export type SandboxWorkflowHost = {
	readonly executeWorkflow?: <
		Input extends Schema.Constraint,
		Output extends Schema.ConstraintDecoder<unknown>,
	>(
		name: string,
		reference: SandboxWorkflowReference<Input, Output>,
		input: Input["Type"],
	) => Effect.Effect<Output["Type"], SandboxHostError>;
};
export type SandboxWorkflowReference<
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly workflowSlug: string;
	readonly referenceKind: "workflow";
	readonly selection?: SandboxExecutionMetadata["executableDependencies"][number]["selection"];
};
