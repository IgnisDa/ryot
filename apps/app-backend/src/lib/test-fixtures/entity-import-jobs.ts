import type { Job } from "bullmq";

import { createListedEntity } from "~/lib/test-fixtures/entities";
import type { processRelatedEntities } from "~/modules/entities/population";
import type { processEntityImportJob } from "~/modules/entities/worker";

export const createJob = (data: unknown): Job =>
	// oxlint-disable-next-line no-unsafe-type-assertion
	({
		data,
		id: "job_1",
		queueQualifiedName: "bull:entity",
		updateData: () => Promise.resolve(),
		getChildrenValues: () => Promise.resolve({}),
		moveToWaitingChildren: () => Promise.resolve(false),
	}) as unknown as Job;

export const createRelatedDeps = (
	overrides: Partial<NonNullable<Parameters<typeof processRelatedEntities>[1]>> = {},
): NonNullable<Parameters<typeof processRelatedEntities>[1]> => ({
	writeEntityRelationship: () => Promise.resolve({ data: undefined }),
	getBuiltinEntitySchemaBySandboxScriptId: () =>
		Promise.resolve(
			// oxlint-disable-next-line no-unsafe-type-assertion
			{ slug: "person", id: "related_schema_1", propertiesSchema: { fields: {} } } as never,
		),
	getBuiltinSandboxScriptBySlug: () =>
		Promise.resolve(
			// oxlint-disable-next-line no-unsafe-type-assertion
			{ id: "related_script_1" } as never,
		),
	createGlobalEntity: () =>
		Promise.resolve({
			isNew: true,
			entity: createListedEntity({
				properties: {},
				id: "related_1",
				populatedAt: null,
				name: "Loading...",
				externalId: "related_ext_1",
				sandboxScriptId: "related_script_1",
			}),
		}),
	getBuiltinRelationshipSchemaBySlug: () =>
		Promise.resolve(
			// oxlint-disable-next-line no-unsafe-type-assertion
			{
				id: "relationship_schema_1",
				propertiesSchema: {
					fields: {
						roles: {
							label: "Roles",
							description: "Roles",
							type: "array" as const,
							items: { label: "Role", description: "Role", type: "string" as const },
						},
					},
				},
			} as never,
		),
	...overrides,
});

export const createEntityImportWorkerDeps = (
	overrides: Partial<NonNullable<Parameters<typeof processEntityImportJob>[2]>> = {},
): NonNullable<Parameters<typeof processEntityImportJob>[2]> => ({
	addEntityQueueJob: () => Promise.resolve(),
	getEntitySchemaScopeForUser: () => Promise.resolve(undefined),
	findGlobalEntityByExternalId: () => Promise.resolve(undefined),
	getBuiltinEntitySchemaBySlug: () => Promise.resolve(undefined),
	getBuiltinSandboxScriptBySlug: () => Promise.resolve(undefined),
	ensureEntityInLibrary: () => Promise.resolve({ data: undefined }),
	writeEntityRelationship: () => Promise.resolve({ data: undefined }),
	getBuiltinRelationshipSchemaBySlug: () => Promise.resolve(undefined),
	getBuiltinEntitySchemaBySandboxScriptId: () => Promise.resolve(undefined),
	getSandboxScriptForUser: () =>
		Promise.resolve(
			// oxlint-disable-next-line no-unsafe-type-assertion
			{ id: "script_1" } as never,
		),
	createGlobalEntity: () => {
		throw new Error("createGlobalEntity should not be called");
	},
	updateGlobalEntityById: () => {
		throw new Error("updateGlobalEntityById should not be called");
	},
	...overrides,
});
