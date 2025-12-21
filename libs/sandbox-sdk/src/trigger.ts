import * as z from "@ryot/sandbox-sdk/zod";

import {
	jsonValueSchema,
	SANDBOX_SCRIPT_DEFINITION,
	type GenericDriver,
	type GenericScriptDefinition,
	type SandboxManifest,
} from "./index.js";

export type TriggerManifest = Extract<SandboxManifest, { kind: "trigger" }>;
export type BeforeCreateTriggerManifest = TriggerManifest & { readonly mode: "before_create" };
export type AfterCreateTriggerManifest = TriggerManifest & { readonly mode: "after_create" };

const triggerPropertiesSchema = z.record(z.string(), jsonValueSchema);
const eventCreateOriginSchema = z.enum(["api", "sandbox", "import", "collection", "integration"]);

export const beforeCreateTriggerInputSchema = z
	.object({
		trigger: z
			.object({
				occurredAt: z.string(),
				origin: eventCreateOriginSchema,
				properties: triggerPropertiesSchema,
				userId: z.string().min(1),
				entityId: z.string().min(1),
				phase: z.literal("before_create"),
				eventSchemaId: z.string().min(1),
				entitySchemaId: z.string().min(1),
				eventSchemaSlug: z.string().min(1),
				entitySchemaSlug: z.string().min(1),
				importRunId: z.string().min(1).optional(),
				integrationId: z.string().min(1).optional(),
				sessionEntityId: z.string().min(1).optional(),
			})
			.strict(),
	})
	.strict();

export const afterCreateTriggerInputSchema = z
	.object({
		trigger: z
			.object({
				createdAt: z.string(),
				updatedAt: z.string(),
				occurredAt: z.string(),
				properties: triggerPropertiesSchema,
				eventId: z.string().min(1),
				entityId: z.string().min(1),
				phase: z.literal("after_create"),
				eventSchemaId: z.string().min(1),
				entitySchemaId: z.string().min(1),
				inheritedProperties: triggerPropertiesSchema,
				eventSchemaSlug: z.string().min(1),
				entitySchemaSlug: z.string().min(1),
			})
			.strict(),
	})
	.strict();

const beforeTriggerAllowSchema = z.object({ action: z.literal("allow") }).strict();
const beforeTriggerSkipSchema = z
	.object({ action: z.literal("skip"), reason: z.string() })
	.strict();
const beforeTriggerReplaceSchema = z
	.object({
		action: z.literal("replace"),
		body: z
			.object({
				occurredAt: z.string().optional(),
				properties: triggerPropertiesSchema.optional(),
				sessionEntityId: z.string().min(1).nullable().optional(),
			})
			.strict(),
	})
	.strict();

export const beforeCreateTriggerResultSchema = z.discriminatedUnion("action", [
	beforeTriggerAllowSchema,
	beforeTriggerSkipSchema,
	beforeTriggerReplaceSchema,
]);
export const afterCreateTriggerResultSchema = z.void();

export type BeforeCreateTriggerInput = z.output<typeof beforeCreateTriggerInputSchema>;
export type AfterCreateTriggerInput = z.output<typeof afterCreateTriggerInputSchema>;
export type BeforeCreateTriggerResult = z.output<typeof beforeCreateTriggerResultSchema>;
export type AfterCreateTriggerResult = z.output<typeof afterCreateTriggerResultSchema>;

export type BeforeCreateTriggerDriver<Manifest extends BeforeCreateTriggerManifest> = GenericDriver<
	typeof beforeCreateTriggerInputSchema,
	typeof beforeCreateTriggerResultSchema,
	Manifest["capabilities"]
>;

export type AfterCreateTriggerDriver<Manifest extends AfterCreateTriggerManifest> = GenericDriver<
	typeof afterCreateTriggerInputSchema,
	typeof afterCreateTriggerResultSchema,
	Manifest["capabilities"]
>;

export type TriggerDefinition<Manifest extends TriggerManifest, Driver> = GenericScriptDefinition<
	Manifest,
	{ readonly trigger: Driver }
>;

export const defineBeforeCreateTrigger = <
	const Manifest extends BeforeCreateTriggerManifest,
>(definition: {
	readonly manifest: Manifest;
	readonly run: BeforeCreateTriggerDriver<Manifest>["run"];
}): TriggerDefinition<Manifest, BeforeCreateTriggerDriver<Manifest>> => ({
	manifest: definition.manifest,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	drivers: {
		trigger: {
			run: definition.run,
			input: beforeCreateTriggerInputSchema,
			output: beforeCreateTriggerResultSchema,
		},
	},
});

export const defineAfterCreateTrigger = <
	const Manifest extends AfterCreateTriggerManifest,
>(definition: {
	readonly manifest: Manifest;
	readonly run: AfterCreateTriggerDriver<Manifest>["run"];
}): TriggerDefinition<Manifest, AfterCreateTriggerDriver<Manifest>> => ({
	manifest: definition.manifest,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	drivers: {
		trigger: {
			run: definition.run,
			input: afterCreateTriggerInputSchema,
			output: afterCreateTriggerResultSchema,
		},
	},
});
