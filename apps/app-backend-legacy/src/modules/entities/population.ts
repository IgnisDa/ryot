import { z } from "@hono/zod-openapi";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { normalizeSlug } from "@ryot/ts-utils/slug";
import type { Job } from "bullmq";

import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { relatedEntityReferenceSchema } from "~/lib/media/common";
import {
	getSandboxChildRunResult,
	queueSandboxChildRun,
	waitForSandboxChildRun,
} from "~/lib/sandbox/child-run";
import { imagesSchema } from "~/lib/zod";
import { getBuiltinEntitySchemaBySandboxScriptId } from "~/modules/entity-schemas";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";
import { getBuiltinSandboxScriptBySlug } from "~/modules/sandbox";

import {
	createGlobalEntity,
	findGlobalEntityByExternalId,
	getEntitySchemaScopeForUser,
	updateGlobalEntityById,
} from "./repository";
import type { ListedEntity } from "./schemas";
import { writeEntityRelationship } from "./service";

const entityDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
	relatedEntities: z.array(relatedEntityReferenceSchema).default([]),
});

const entityResolveResultSchema = z.object({
	externalId: z.string().nullable(),
});

const extractPrimaryImage = (images: unknown) => {
	const parsedImages = imagesSchema.safeParse(images);
	return parsedImages.success ? (parsedImages.data[0] ?? null) : null;
};

export type EntityPopulationDeps = {
	createGlobalEntity: typeof createGlobalEntity;
	updateGlobalEntityById: typeof updateGlobalEntityById;
	writeEntityRelationship: typeof writeEntityRelationship;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
	findGlobalEntityByExternalId: typeof findGlobalEntityByExternalId;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
	getBuiltinRelationshipSchemaBySlug: typeof getBuiltinRelationshipSchemaBySlug;
	getBuiltinEntitySchemaBySandboxScriptId: typeof getBuiltinEntitySchemaBySandboxScriptId;
};

type EntityPopulationError =
	| { kind: "script_failed"; message: string }
	| { kind: "invalid_details"; message: string }
	| { kind: "schema_not_found"; message: string }
	| { kind: "related_entity_error"; message: string };

export const entityPopulationDeps: EntityPopulationDeps = {
	createGlobalEntity,
	updateGlobalEntityById,
	writeEntityRelationship,
	getEntitySchemaScopeForUser,
	findGlobalEntityByExternalId,
	getBuiltinSandboxScriptBySlug,
	getBuiltinRelationshipSchemaBySlug,
	getBuiltinEntitySchemaBySandboxScriptId,
};

export const hasImportedEntityDetails = (entityRow: Pick<ListedEntity, "populatedAt">) =>
	entityRow.populatedAt !== null;

export const processRelatedEntities = async (
	input: {
		entityId: string;
		entitySchemaSlug: string;
		relatedEntities: Array<z.infer<typeof relatedEntityReferenceSchema>>;
	},
	deps: Pick<
		EntityPopulationDeps,
		| "createGlobalEntity"
		| "getBuiltinEntitySchemaBySandboxScriptId"
		| "getBuiltinRelationshipSchemaBySlug"
		| "getBuiltinSandboxScriptBySlug"
		| "writeEntityRelationship"
	> = entityPopulationDeps,
) => {
	if (input.relatedEntities.length === 0) {
		return;
	}

	// oxlint-disable no-await-in-loop
	for (const relatedEntity of input.relatedEntities) {
		const relatedScript = await deps.getBuiltinSandboxScriptBySlug(relatedEntity.scriptSlug);
		if (!relatedScript) {
			throw new Error(`Related sandbox script not found for slug "${relatedEntity.scriptSlug}"`);
		}

		const relatedSchema = await deps.getBuiltinEntitySchemaBySandboxScriptId(relatedScript.id);
		if (!relatedSchema) {
			throw new Error(
				`Related entity schema not found for sandbox script slug "${relatedEntity.scriptSlug}"`,
			);
		}

		const relationshipSchemaSlug = relatedEntity.reverseDirection
			? normalizeSlug(`${input.entitySchemaSlug} to ${relatedSchema.slug}`)
			: normalizeSlug(`${relatedSchema.slug} to ${input.entitySchemaSlug}`);

		const relationshipSchema =
			await deps.getBuiltinRelationshipSchemaBySlug(relationshipSchemaSlug);
		if (!relationshipSchema) {
			throw new Error(
				`No relationship schema seeded for related type "${relatedSchema.slug}" and entity type "${input.entitySchemaSlug}" (slug: "${relationshipSchemaSlug}") — check bootstrap manifests`,
			);
		}

		const { entity: existingOrCreated } = await deps.createGlobalEntity({
			name: relatedEntity.name,
			entitySchemaId: relatedSchema.id,
			sandboxScriptId: relatedScript.id,
			externalId: relatedEntity.externalId,
		});

		const sourceEntityId = relatedEntity.reverseDirection ? input.entityId : existingOrCreated.id;
		const targetEntityId = relatedEntity.reverseDirection ? existingOrCreated.id : input.entityId;

		const relationshipResult = await deps.writeEntityRelationship({
			targetEntityId,
			sourceEntityId,
			relationshipSchemaId: relationshipSchema.id,
			properties: relatedEntity.relationshipProperties,
		});
		if ("error" in relationshipResult) {
			throw new Error(
				`Failed to write ${relationshipSchemaSlug} relationship: ${relationshipResult.message}`,
			);
		}
	}
	// oxlint-enable no-await-in-loop
};

export const populateGlobalEntity = async (
	job: Job,
	token: string | undefined,
	input: {
		userId: string;
		scriptId: string;
		externalId: string;
		entitySchemaId: string;
		sandboxChildJobId: string;
		sandboxAlreadyQueued: boolean;
		updatedJobData: Record<string, unknown>;
	},
	deps: EntityPopulationDeps = entityPopulationDeps,
): Promise<{ entity: ListedEntity } | { error: EntityPopulationError }> => {
	const { userId, scriptId, externalId, entitySchemaId } = input;

	const existingEntity = await deps.findGlobalEntityByExternalId({
		externalId,
		entitySchemaId,
		sandboxScriptId: scriptId,
	});
	if (existingEntity && hasImportedEntityDetails(existingEntity)) {
		return { entity: existingEntity };
	}

	if (!input.sandboxAlreadyQueued) {
		await queueSandboxChildRun({
			job,
			jobData: input.updatedJobData,
			childJobId: input.sandboxChildJobId,
			sandboxJobData: { userId, scriptId, driverName: "details", context: { externalId } },
		});
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job, input.sandboxChildJobId);

	if (!sandboxResult.success) {
		return {
			error: {
				kind: "script_failed",
				message: sandboxResult.error ?? "Entity details script failed",
			},
		};
	}
	if (sandboxResult.error) {
		return { error: { kind: "script_failed", message: sandboxResult.error } };
	}

	const detailsParsed = entityDetailsResultSchema.safeParse(sandboxResult.value);
	if (!detailsParsed.success) {
		return {
			error: {
				kind: "invalid_details",
				message: "Entity details script returned an unexpected shape",
			},
		};
	}
	const details = detailsParsed.data;

	const scope = await deps.getEntitySchemaScopeForUser({ userId, entitySchemaId });
	if (!scope) {
		return { error: { kind: "schema_not_found", message: "Entity schema not found" } };
	}

	const schemaFieldKeys = Object.keys(scope.propertiesSchema.fields);
	const properties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			properties[key] = details.properties[key];
		}
	}

	let validatedProperties: Record<string, unknown>;
	try {
		validatedProperties = parseAppSchemaProperties({
			properties,
			kind: "Entity",
			propertiesSchema: scope.propertiesSchema,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Entity properties validation failed";
		return { error: { kind: "invalid_details", message } };
	}

	const parsedImages = imagesSchema.safeParse(validatedProperties.images);
	if (!parsedImages.success) {
		return { error: { kind: "invalid_details", message: "Entity details images are invalid" } };
	}
	validatedProperties.images = parsedImages.data;

	const image = extractPrimaryImage(validatedProperties.images);

	const { entity: importedEntity, isNew } = await deps.createGlobalEntity({
		externalId,
		entitySchemaId,
		name: details.name,
		sandboxScriptId: scriptId,
	});

	try {
		await processRelatedEntities(
			{
				entityId: importedEntity.id,
				entitySchemaSlug: scope.slug,
				relatedEntities: details.relatedEntities,
			},
			deps,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to process related entities";
		return { error: { kind: "related_entity_error", message } };
	}

	const updatedEntity = await deps.updateGlobalEntityById({
		image,
		entitySchemaId,
		name: details.name,
		entityId: importedEntity.id,
		properties: validatedProperties,
		populatedAt:
			isNew || !importedEntity.populatedAt ? dayjs().toDate() : importedEntity.populatedAt,
	});

	return { entity: updatedEntity };
};

type EntityResolutionResult = { externalId: string | null } | { error: { message: string } };

export const resolveGlobalEntityExternalId = async (
	job: Job,
	token: string | undefined,
	input: {
		value: string;
		userId: string;
		scriptId: string;
		identifierType: string;
		sandboxChildJobId: string;
		sandboxAlreadyQueued: boolean;
		updatedJobData: Record<string, unknown>;
	},
): Promise<EntityResolutionResult> => {
	const { userId, scriptId, identifierType, value } = input;

	if (!input.sandboxAlreadyQueued) {
		await queueSandboxChildRun({
			job,
			jobData: input.updatedJobData,
			childJobId: input.sandboxChildJobId,
			sandboxJobData: {
				userId,
				scriptId,
				driverName: "resolve",
				context: { identifierType, value },
			},
		});
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job, input.sandboxChildJobId);

	if (!sandboxResult.success || sandboxResult.error) {
		return { error: { message: sandboxResult.error ?? "Entity resolve script failed" } };
	}

	const parsed = entityResolveResultSchema.safeParse(sandboxResult.value);
	if (!parsed.success) {
		return { error: { message: "Entity resolve script returned an unexpected shape" } };
	}

	return { externalId: parsed.data.externalId };
};
