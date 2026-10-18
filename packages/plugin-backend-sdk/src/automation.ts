import {
	AutomationInput as automationInputSchema,
	AutomationOutput as automationResultSchema,
	AutomationPolicyInput as automationPolicyInputSchema,
	AutomationPolicyOutput as automationPolicyResultSchema,
	AutomationPolicyBatchInput as automationPolicyBatchInputSchema,
	AutomationPolicyBatchOutput as automationPolicyBatchResultSchema,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxManifest } from "./core/script-manifest";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";

export {
	automationInputSchema,
	automationResultSchema,
	automationPolicyInputSchema,
	automationPolicyResultSchema,
	automationPolicyBatchInputSchema,
	automationPolicyBatchResultSchema,
};
export const automationContextSchema = automationInputSchema.fields.automation;
export const automationPolicyContextSchema = automationPolicyInputSchema.fields.automation;
export type AutomationInput = Schema.Schema.Type<typeof automationInputSchema>;
export type AutomationContext = Schema.Schema.Type<typeof automationContextSchema>;
export type AutomationPolicyInput = Schema.Schema.Type<typeof automationPolicyInputSchema>;
export type AutomationPolicyResult = Schema.Schema.Type<typeof automationPolicyResultSchema>;
export type AutomationPolicyBatchInput = Schema.Schema.Type<
	typeof automationPolicyBatchInputSchema
>;
export type AutomationPolicyBatchResult = Schema.Schema.Type<
	typeof automationPolicyBatchResultSchema
>;
export type AutomationManifest = Extract<
	SandboxManifest,
	{ readonly kind: "automation"; readonly automationType: "automation" }
>;
export type AutomationPolicyManifest = Extract<
	SandboxManifest,
	{ readonly kind: "automation"; readonly automationType: "policy" }
>;

export type AutomationDefinition<
	Manifest extends AutomationManifest,
	Failure,
> = GenericScriptDefinition<
	Manifest,
	typeof automationInputSchema,
	typeof automationResultSchema,
	Failure
>;
export type AutomationPolicyDefinition<
	Manifest extends AutomationPolicyManifest,
	Failure,
> = GenericScriptDefinition<
	Manifest,
	typeof automationPolicyBatchInputSchema,
	typeof automationPolicyBatchResultSchema,
	Failure
>;

export const defineAutomation = <
	const Manifest extends AutomationManifest,
	Failure,
	Run extends AutomationDefinition<Manifest, Failure>["run"],
>(definition: {
	readonly manifest: Manifest;
	readonly run: Run;
}): Omit<AutomationDefinition<Manifest, Effect.Error<ReturnType<Run>>>, "run"> & {
	readonly run: Run;
} => ({
	run: definition.run,
	input: automationInputSchema,
	manifest: definition.manifest,
	output: automationResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
export const defineAutomationPolicy = <
	const Manifest extends AutomationPolicyManifest,
	Failure,
	Run extends AutomationPolicyDefinition<Manifest, Failure>["run"],
>(definition: {
	readonly manifest: Manifest;
	readonly run: Run;
}): Omit<AutomationPolicyDefinition<Manifest, Effect.Error<ReturnType<Run>>>, "run"> & {
	readonly run: Run;
} => ({
	run: definition.run,
	manifest: definition.manifest,
	input: automationPolicyBatchInputSchema,
	output: automationPolicyBatchResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
