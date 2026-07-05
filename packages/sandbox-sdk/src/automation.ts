import { Schema } from "@ryot-app/sandbox-sdk/effect";

import type { SandboxManifest } from "./core";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";
import { jsonValueSchema, strictStruct } from "./wire";

export type {
	AutomationOccurrencePopulation,
	AutomationOccurrenceSource,
} from "@ryot-app/contract/modules/automations/schemas";

const propertiesSchema = Schema.Record(Schema.String, jsonValueSchema);

export type AutomationManifest = Extract<SandboxManifest, { readonly kind: "automation" }>;
export const automationOriginSchema = Schema.Union([
	strictStruct({ kind: Schema.Literal("api") }),
	strictStruct({ kind: Schema.Literal("bootstrap") }),
	strictStruct({ kind: Schema.Literal("provider_refresh") }),
	strictStruct({ kind: Schema.Literal("import"), importRunId: Schema.optional(Schema.String) }),
	strictStruct({
		integrationId: Schema.String,
		kind: Schema.Literal("integration"),
		importRunId: Schema.optional(Schema.String),
	}),
	strictStruct({ executionId: Schema.String, kind: Schema.Literal("automation") }),
]);
const automationSourceSchema = Schema.Union([
	strictStruct({ entityId: Schema.String, kind: Schema.Literal("entity") }),
	strictStruct({ eventId: Schema.String, kind: Schema.Literal("event") }),
	strictStruct({ relationshipId: Schema.String, kind: Schema.Literal("relationship") }),
	strictStruct({ signalId: Schema.String, kind: Schema.Literal("signal") }),
	strictStruct({
		entityId: Schema.String,
		externalId: Schema.String,
		providerId: Schema.String,
		entitySchemaSlug: Schema.String,
		kind: Schema.Literal("provider-entity-import"),
	}),
]);
export const automationContextSchema = strictStruct({
	ruleId: Schema.String,
	occurredAt: Schema.String,
	occurrenceId: Schema.String,
	origin: automationOriginSchema,
	source: automationSourceSchema,
	runId: Schema.optional(Schema.String),
	operation: Schema.Literals(["create", "update", "delete", "signal"]),
});
export const automationInputSchema = strictStruct({ automation: automationContextSchema });
export const automationResultSchema = jsonValueSchema;

export const automationPolicyDraftSchema = strictStruct({
	entityId: Schema.String,
	occurredAt: Schema.String,
	properties: propertiesSchema,
	eventSchemaSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(Schema.String),
});
export const automationPolicyContextSchema = strictStruct({
	ruleId: Schema.String,
	occurrenceId: Schema.String,
	origin: automationOriginSchema,
	operation: Schema.Literal("create"),
	ruleMetadata: Schema.optional(jsonValueSchema),
	source: strictStruct({ kind: Schema.Literal("event"), draft: automationPolicyDraftSchema }),
});
export const automationPolicyInputSchema = strictStruct({
	automation: automationPolicyContextSchema,
});
export const automationPolicyResultSchema = Schema.Union([
	strictStruct({ action: Schema.Literal("allow") }),
	strictStruct({ reason: Schema.String, action: Schema.Literal("skip") }),
	strictStruct({
		action: Schema.Literal("replace"),
		body: strictStruct({
			occurredAt: Schema.optional(Schema.String),
			properties: Schema.optional(propertiesSchema),
			sessionEntityId: Schema.optional(Schema.NullOr(Schema.String)),
		}),
	}),
]);

export type AutomationInput = Schema.Schema.Type<typeof automationInputSchema>;
export type AutomationContext = Schema.Schema.Type<typeof automationContextSchema>;
export type AutomationPolicyInput = Schema.Schema.Type<typeof automationPolicyInputSchema>;
export type AutomationPolicyResult = Schema.Schema.Type<typeof automationPolicyResultSchema>;

export type AutomationDefinition<Manifest extends AutomationManifest> = GenericScriptDefinition<
	Manifest,
	typeof automationInputSchema,
	typeof automationResultSchema
>;
export type AutomationPolicyDefinition<Manifest extends AutomationManifest> =
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
export const defineAutomationPolicy = <const Manifest extends AutomationManifest>(definition: {
	readonly manifest: Manifest;
	readonly run: AutomationPolicyDefinition<Manifest>["run"];
}): AutomationPolicyDefinition<Manifest> => ({
	run: definition.run,
	manifest: definition.manifest,
	input: automationPolicyInputSchema,
	output: automationPolicyResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
