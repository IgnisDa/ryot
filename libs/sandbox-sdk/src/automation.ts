import * as z from "@ryot/sandbox-sdk/zod";

import {
	jsonValueSchema,
	SANDBOX_SCRIPT_DEFINITION,
	type GenericDriver,
	type GenericScriptDefinition,
	type SandboxManifest,
} from "./index.js";

export type AutomationManifest = Extract<SandboxManifest, { kind: "automation" }>;

export const automationOriginSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("api") }).strict(),
	z.object({ kind: z.literal("bootstrap") }).strict(),
	z.object({ kind: z.literal("provider_refresh") }).strict(),
	z.object({ kind: z.literal("import"), importRunId: z.string().optional() }).strict(),
	z
		.object({
			integrationId: z.string(),
			importRunId: z.string().optional(),
			kind: z.literal("integration"),
		})
		.strict(),
	z.object({ kind: z.literal("automation"), executionId: z.string() }).strict(),
]);

const propertiesSchema = z.record(z.string(), jsonValueSchema);
const entityReferenceSchema = z
	.object({ id: z.string(), name: z.string(), entitySchemaSlug: z.string() })
	.strict();

export const automationEntitySnapshotSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		entitySchemaId: z.string(),
		entitySchemaSlug: z.string(),
		properties: propertiesSchema,
	})
	.strict();

export const automationEventSnapshotSchema = z
	.object({
		id: z.string(),
		occurredAt: z.string(),
		eventSchemaId: z.string(),
		eventSchemaSlug: z.string(),
		properties: propertiesSchema,
		subject: entityReferenceSchema,
	})
	.strict();

export const automationRelationshipSnapshotSchema = z
	.object({
		id: z.string(),
		properties: propertiesSchema,
		source: entityReferenceSchema,
		target: entityReferenceSchema,
		relationshipSchemaId: z.string(),
		relationshipSchemaSlug: z.string(),
	})
	.strict();

export const automationSignalSnapshotSchema = z
	.object({
		id: z.string(),
		occurredAt: z.string(),
		properties: propertiesSchema,
		signalSchemaSlug: z.string(),
		origin: automationOriginSchema,
	})
	.strict();

const automationSourceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("signal"), signal: automationSignalSnapshotSchema }).strict(),
	z
		.object({
			kind: z.literal("entity"),
			after: automationEntitySnapshotSchema.optional(),
			before: automationEntitySnapshotSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("event"),
			after: automationEventSnapshotSchema.optional(),
			before: automationEventSnapshotSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("relationship"),
			after: automationRelationshipSnapshotSchema.optional(),
			before: automationRelationshipSnapshotSchema.optional(),
		})
		.strict(),
]);

const automationPopulationSchema = z
	.object({
		rootPreviouslyPopulated: z.boolean(),
		owningSeason: z
			.object({ number: z.number().nullable(), name: z.string().nullable() })
			.strict()
			.optional(),
		scopeEntity: z
			.object({
				id: z.string(),
				name: z.string(),
				entitySchemaId: z.string(),
				entitySchemaSlug: z.string(),
			})
			.strict(),
		batch: z
			.object({
				id: z.string(),
				isLeader: z.boolean(),
				afterCount: z.number(),
				beforeCount: z.number(),
				createdCount: z.number(),
				deletedCount: z.number(),
				updatedCount: z.number(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const automationContextSchema = z
	.object({
		ruleId: z.string(),
		occurredAt: z.string(),
		occurrenceId: z.string(),
		origin: automationOriginSchema,
		source: automationSourceSchema,
		ruleMetadata: jsonValueSchema.optional(),
		population: automationPopulationSchema.optional(),
		operation: z.enum(["create", "update", "delete", "signal"]),
	})
	.strict();

export const automationInputSchema = z.object({ automation: automationContextSchema }).strict();
export const automationResultSchema = jsonValueSchema;

export type AutomationInput = z.output<typeof automationInputSchema>;
export type AutomationContext = z.output<typeof automationContextSchema>;
export type AutomationEventSnapshot = z.output<typeof automationEventSnapshotSchema>;
export type AutomationSignalSnapshot = z.output<typeof automationSignalSnapshotSchema>;
export type AutomationEntitySnapshot = z.output<typeof automationEntitySnapshotSchema>;
export type AutomationRelationshipSnapshot = z.output<typeof automationRelationshipSnapshotSchema>;

export type AutomationDriver<Manifest extends AutomationManifest> = GenericDriver<
	typeof automationInputSchema,
	typeof automationResultSchema,
	Manifest["capabilities"]
>;

export type AutomationDefinition<Manifest extends AutomationManifest> = GenericScriptDefinition<
	Manifest,
	{ readonly automation: AutomationDriver<Manifest> }
>;

export const defineAutomation = <const Manifest extends AutomationManifest>(definition: {
	readonly manifest: Manifest;
	readonly run: AutomationDriver<Manifest>["run"];
}): AutomationDefinition<Manifest> => ({
	manifest: definition.manifest,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	drivers: {
		automation: {
			run: definition.run,
			input: automationInputSchema,
			output: automationResultSchema,
		},
	},
});
