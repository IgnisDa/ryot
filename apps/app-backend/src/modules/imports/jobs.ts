import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

export const importRunJobName = "import-run";

const resolvedImportEntityRefSchema = z.object({
	sourceLabel: z.string(),
	externalId: nonEmptyStringSchema,
	scriptSlug: nonEmptyStringSchema,
	kind: z.literal("resolved"),
	entitySchemaSlug: nonEmptyStringSchema,
});
export type ResolvedImportEntityRef = z.infer<typeof resolvedImportEntityRefSchema>;

const unresolvedImportEntityRefSchema = z.object({
	sourceLabel: z.string(),
	kind: z.literal("unresolved"),
	identifierType: nonEmptyStringSchema,
	identifierValue: nonEmptyStringSchema,
	entitySchemaSlug: nonEmptyStringSchema,
});

export const importEntityRefSchema = z.discriminatedUnion("kind", [
	resolvedImportEntityRefSchema,
	unresolvedImportEntityRefSchema,
]);
export type ImportEntityRef = z.infer<typeof importEntityRefSchema>;

export const importEntityRefKey = (ref: ImportEntityRef) =>
	ref.kind === "resolved"
		? `${ref.entitySchemaSlug}|${ref.scriptSlug}|${ref.externalId}`
		: `${ref.entitySchemaSlug}|${ref.identifierType}|${ref.identifierValue}`;

const importMediaEventSchema = z.object({
	occurredAt: nonEmptyStringSchema,
	eventSchemaSlug: nonEmptyStringSchema,
	properties: z.record(z.string(), z.unknown()),
});
export type ImportMediaEvent = z.infer<typeof importMediaEventSchema>;

const importCollectionMembershipSchema = z.object({ collectionName: nonEmptyStringSchema });

const importMediaEntityGroupSchema = z.object({
	entityRef: importEntityRefSchema,
	events: z.array(importMediaEventSchema),
	itemIndex: z.number().int().nonnegative().optional(),
	collectionMemberships: z.array(importCollectionMembershipSchema),
});
export type ImportMediaEntityGroup = z.infer<typeof importMediaEntityGroupSchema>;

export const importRunJobData = z.object({
	runId: nonEmptyStringSchema,
	userId: nonEmptyStringSchema,
	filePath: z.string().optional(),
	traktUsername: z.string().optional(),
	sourcePayloadKey: z.string().optional(),
	resolveSandboxJobId: z.string().optional(),
	providerSandboxJobId: z.string().optional(),
	providerEntityIndex: z.number().int().nonnegative().optional(),
	resolveEntityIndex: z.number().int().nonnegative().optional(),
	resolveCandidateIndex: z.number().int().nonnegative().optional(),
	adapterFailureCount: z.number().int().nonnegative().optional(),
	mediaWriteGroupIndex: z.number().int().nonnegative().optional(),
	mediaWriteFailedItems: z.number().int().nonnegative().optional(),
	mediaWriteImportedItems: z.number().int().nonnegative().optional(),
	providerEntityIds: z.array(z.string().nullable()).optional(),
	providerEntityRefs: z.array(importEntityRefSchema).optional(),
	mediaEntityGroups: z.array(importMediaEntityGroupSchema).optional(),
	sourcePayload: z.record(z.string(), z.unknown()).optional(),
	resolveFailedIndices: z.array(z.number().int().nonnegative()).optional(),
	providerFailedIndices: z.array(z.number().int().nonnegative()).optional(),
	importStep: z.enum(["resolving_entities", "populating_entities", "writing_events"]).optional(),
});

export type ImportRunJobData = z.infer<typeof importRunJobData>;
