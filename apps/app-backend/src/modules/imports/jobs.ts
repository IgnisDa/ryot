import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

export const importRunJobName = "import-run";

export const importEntityRefSchema = z.object({
	sourceLabel: z.string(),
	externalId: nonEmptyStringSchema,
	scriptSlug: nonEmptyStringSchema,
	entitySchemaSlug: nonEmptyStringSchema,
});
export type ImportEntityRef = z.infer<typeof importEntityRefSchema>;

export const importMediaEventSchema = z.object({
	occurredAt: nonEmptyStringSchema,
	eventSchemaSlug: nonEmptyStringSchema,
	properties: z.record(z.string(), z.unknown()),
});
export type ImportMediaEvent = z.infer<typeof importMediaEventSchema>;

export const importCollectionMembershipSchema = z.object({
	collectionName: nonEmptyStringSchema,
});
export type ImportCollectionMembership = z.infer<typeof importCollectionMembershipSchema>;

export const importMediaEntityGroupSchema = z.object({
	entityRef: importEntityRefSchema,
	events: z.array(importMediaEventSchema),
	collectionMemberships: z.array(importCollectionMembershipSchema),
});
export type ImportMediaEntityGroup = z.infer<typeof importMediaEntityGroupSchema>;

export const importRunJobData = z.object({
	runId: nonEmptyStringSchema,
	userId: nonEmptyStringSchema,
	filePath: z.string().optional(),
	traktUsername: z.string().optional(),
	sourcePayload: z.record(z.string(), z.unknown()).optional(),
	providerSandboxJobId: z.string().optional(),
	providerEntityIndex: z.number().int().nonnegative().optional(),
	adapterFailureCount: z.number().int().nonnegative().optional(),
	mediaWriteGroupIndex: z.number().int().nonnegative().optional(),
	mediaWriteFailedItems: z.number().int().nonnegative().optional(),
	mediaWriteImportedItems: z.number().int().nonnegative().optional(),
	providerEntityIds: z.array(z.string().nullable()).optional(),
	providerEntityRefs: z.array(importEntityRefSchema).optional(),
	providerStep: z.literal("waiting_for_entity_sandbox").optional(),
	mediaEntityGroups: z.array(importMediaEntityGroupSchema).optional(),
	providerFailedIndices: z.array(z.number().int().nonnegative()).optional(),
	importStep: z.enum(["populating_entities", "writing_events"]).optional(),
});

export type ImportRunJobData = z.infer<typeof importRunJobData>;
