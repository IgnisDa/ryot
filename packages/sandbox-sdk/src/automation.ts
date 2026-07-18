import { Schema } from "@ryot/sandbox-sdk/effect";

import type { SandboxManifest } from "./core";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";
import { jsonValueSchema } from "./wire";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });
const propertiesSchema = Schema.Record(Schema.String, jsonValueSchema);
const entityReferenceSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

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
	strictStruct({ kind: Schema.Literal("automation"), executionId: Schema.String }),
]);
export const automationEntitySnapshotSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	properties: propertiesSchema,
	entitySchemaSlug: Schema.String,
});
export const automationEventSnapshotSchema = strictStruct({
	id: Schema.String,
	occurredAt: Schema.String,
	properties: propertiesSchema,
	subject: entityReferenceSchema,
	eventSchemaSlug: Schema.String,
});
export const automationRelationshipSnapshotSchema = strictStruct({
	id: Schema.String,
	properties: propertiesSchema,
	source: entityReferenceSchema,
	target: entityReferenceSchema,
	relationshipSchemaSlug: Schema.String,
});
export const automationSignalSnapshotSchema = strictStruct({
	id: Schema.String,
	occurredAt: Schema.String,
	properties: propertiesSchema,
	origin: automationOriginSchema,
	signalSchemaSlug: Schema.String,
});
const automationSourceSchema = Schema.Union([
	strictStruct({ kind: Schema.Literal("signal"), signal: automationSignalSnapshotSchema }),
	strictStruct({
		kind: Schema.Literal("entity"),
		after: Schema.optional(automationEntitySnapshotSchema),
		before: Schema.optional(automationEntitySnapshotSchema),
	}),
	strictStruct({
		kind: Schema.Literal("event"),
		after: Schema.optional(automationEventSnapshotSchema),
		before: Schema.optional(automationEventSnapshotSchema),
	}),
	strictStruct({
		kind: Schema.Literal("relationship"),
		after: Schema.optional(automationRelationshipSnapshotSchema),
		before: Schema.optional(automationRelationshipSnapshotSchema),
	}),
]);
const automationPopulationSchema = strictStruct({
	rootPreviouslyPopulated: Schema.Boolean,
	parentEntity: Schema.optional(
		strictStruct({
			name: Schema.String,
			properties: propertiesSchema,
			entitySchemaSlug: Schema.String,
		}),
	),
	scopeEntity: entityReferenceSchema,
	batch: Schema.optional(
		strictStruct({
			id: Schema.String,
			isLeader: Schema.Boolean,
			afterCount: Schema.Number,
			beforeCount: Schema.Number,
			createdCount: Schema.Number,
			deletedCount: Schema.Number,
			updatedCount: Schema.Number,
		}),
	),
});
export const automationContextSchema = strictStruct({
	ruleId: Schema.String,
	occurredAt: Schema.String,
	occurrenceId: Schema.String,
	origin: automationOriginSchema,
	source: automationSourceSchema,
	ruleMetadata: Schema.optional(jsonValueSchema),
	population: Schema.optional(automationPopulationSchema),
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
	strictStruct({ action: Schema.Literal("skip"), reason: Schema.String }),
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
export type AutomationEventSnapshot = Schema.Schema.Type<typeof automationEventSnapshotSchema>;
export type AutomationSignalSnapshot = Schema.Schema.Type<typeof automationSignalSnapshotSchema>;
export type AutomationEntitySnapshot = Schema.Schema.Type<typeof automationEntitySnapshotSchema>;
export type AutomationRelationshipSnapshot = Schema.Schema.Type<
	typeof automationRelationshipSnapshotSchema
>;

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
	manifest: definition.manifest,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	run: definition.run,
	input: automationInputSchema,
	output: automationResultSchema,
});
export const defineAutomationPolicy = <const Manifest extends AutomationManifest>(definition: {
	readonly manifest: Manifest;
	readonly run: AutomationPolicyDefinition<Manifest>["run"];
}): AutomationPolicyDefinition<Manifest> => ({
	manifest: definition.manifest,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	run: definition.run,
	input: automationPolicyInputSchema,
	output: automationPolicyResultSchema,
});
