import {
	AutomationInput as automationInputSchema,
	AutomationOutput as automationResultSchema,
	AutomationPolicyInput as automationPolicyInputSchema,
	AutomationPolicyOutput as automationPolicyResultSchema,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { Schema } from "@ryot-app/sandbox-sdk/effect";

import type { SandboxManifest } from "./core";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";

export {
	automationInputSchema,
	automationResultSchema,
	automationPolicyInputSchema,
	automationPolicyResultSchema,
};
export const automationContextSchema = automationInputSchema.fields.automation;
export const automationPolicyContextSchema = automationPolicyInputSchema.fields.automation;
export type AutomationInput = Schema.Schema.Type<typeof automationInputSchema>;
export type AutomationContext = Schema.Schema.Type<typeof automationContextSchema>;
export type AutomationPolicyInput = Schema.Schema.Type<typeof automationPolicyInputSchema>;
export type AutomationPolicyResult = Schema.Schema.Type<typeof automationPolicyResultSchema>;
export type AutomationManifest = Extract<
	SandboxManifest,
	{ readonly kind: "automation"; readonly automationType: "automation" }
>;
export type AutomationPolicyManifest = Extract<
	SandboxManifest,
	{ readonly kind: "automation"; readonly automationType: "policy" }
>;

export type AutomationDefinition<Manifest extends AutomationManifest> = GenericScriptDefinition<
	Manifest,
	typeof automationInputSchema,
	typeof automationResultSchema
>;
export type AutomationPolicyDefinition<Manifest extends AutomationPolicyManifest> =
	GenericScriptDefinition<
		Manifest,
		typeof automationPolicyInputSchema,
		typeof automationPolicyResultSchema
	>;

export const defineAutomation = <const Manifest extends AutomationManifest>(definition: {
	readonly manifest: Manifest;
	readonly run: AutomationDefinition<Manifest>["run"];
}): AutomationDefinition<Manifest> => ({
	run: definition.run,
	input: automationInputSchema,
	manifest: definition.manifest,
	output: automationResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
export const defineAutomationPolicy = <
	const Manifest extends AutomationPolicyManifest,
>(definition: {
	readonly manifest: Manifest;
	readonly run: AutomationPolicyDefinition<Manifest>["run"];
}): AutomationPolicyDefinition<Manifest> => ({
	run: definition.run,
	manifest: definition.manifest,
	input: automationPolicyInputSchema,
	output: automationPolicyResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
