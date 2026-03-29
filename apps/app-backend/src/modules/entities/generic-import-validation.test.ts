import { describe, expect, it } from "bun:test";

import {
	createEntityImportWorkerDeps,
	createJob,
	createListedEntity,
	createOptionalTitlePropertiesSchema,
	createRelatedDeps,
} from "~/lib/test-fixtures";

import { entityImportWaitingForSandboxStep } from "./jobs";
import { processEntityImportJob, processRelatedEntities } from "./worker";

const createBookPropertiesSchema = () => ({
	fields: {
		...createOptionalTitlePropertiesSchema().fields,
		images: {
			label: "Images",
			description: "Images",
			type: "array" as const,
			items: {
				label: "Image",
				description: "Image",
				type: "object" as const,
				properties: {
					key: { label: "Key", description: "Key", type: "string" as const },
					url: { label: "URL", description: "URL", type: "string" as const },
					type: { label: "Type", description: "Type", type: "string" as const },
				},
			},
		},
	},
});

describe("processEntityImportJob", () => {
	it("rejects invalid primary properties", () => {
		expect(
			processEntityImportJob(
				Object.assign(
					createJob({
						userId: "user_1",
						externalId: "ext_1",
						scriptId: "script_1",
						entitySchemaId: "schema_1",
						step: entityImportWaitingForSandboxStep,
					}),
					{
						getChildrenValues: () =>
							Promise.resolve({
								child_1: {
									logs: null,
									error: null,
									success: true,
									value: { name: "Imported title", properties: { images: [], title: 123 } },
								},
							}),
					},
				),
				"token_1",
				createEntityImportWorkerDeps({
					getEntitySchemaScopeForUser: () =>
						Promise.resolve(
							// oxlint-disable-next-line no-unsafe-type-assertion
							{
								slug: "book",
								id: "schema_1",
								propertiesSchema: createBookPropertiesSchema(),
							} as never,
						),
				}),
			),
		).rejects.toThrow("Entity payload is invalid");
	});

	it("continues populating an existing unpopulated entity", async () => {
		let updateInput:
			| Parameters<
					NonNullable<Parameters<typeof processEntityImportJob>[2]>["updateGlobalEntityById"]
			  >[0]
			| undefined;

		const existingEntity = createListedEntity({
			id: "media_1",
			populatedAt: null,
			externalId: "ext_1",
			name: "Imported title",
			sandboxScriptId: "script_1",
		});

		await processEntityImportJob(
			Object.assign(
				createJob({
					userId: "user_1",
					externalId: "ext_1",
					scriptId: "script_1",
					entitySchemaId: "schema_1",
					step: entityImportWaitingForSandboxStep,
				}),
				{
					getChildrenValues: () =>
						Promise.resolve({
							child_1: {
								logs: null,
								error: null,
								success: true,
								value: {
									name: "Imported title",
									properties: { images: [], title: "Imported title" },
								},
							},
						}),
				},
			),
			"token_1",
			createEntityImportWorkerDeps({
				createGlobalEntity: () =>
					Promise.resolve({
						isNew: false,
						entity: existingEntity,
					}),
				findGlobalEntityByExternalId: () => Promise.resolve(existingEntity),
				getEntitySchemaScopeForUser: () =>
					Promise.resolve(
						// oxlint-disable-next-line no-unsafe-type-assertion
						{
							id: "schema_1",
							slug: "book",
							propertiesSchema: createBookPropertiesSchema(),
						} as never,
					),
				updateGlobalEntityById: (input) => {
					updateInput = input;
					return Promise.resolve(
						createListedEntity({
							id: "media_1",
							name: input.name,
							externalId: input.entityId,
							sandboxScriptId: "script_1",
							properties: input.properties,
							populatedAt: input.populatedAt,
						}),
					);
				},
			}),
		);

		expect(updateInput?.entityId).toBe("media_1");
		expect(updateInput?.populatedAt instanceof Date).toBe(true);
	});
});

describe("processRelatedEntities", () => {
	const validRelatedEntity = {
		name: "Loading...",
		scriptSlug: "person.tmdb",
		externalId: "related_ext_1",
		relationshipProperties: { roles: ["Author"] },
	};

	it("throws when the related sandbox script is missing", () => {
		expect(
			processRelatedEntities(
				{
					entityId: "media_1",
					entitySchemaSlug: "book",
					relatedEntities: [validRelatedEntity],
				},
				createRelatedDeps({
					getBuiltinSandboxScriptBySlug: () => Promise.resolve(undefined),
				}),
			),
		).rejects.toThrow('Related sandbox script not found for slug "person.tmdb"');
	});

	it("throws when the related entity schema is missing", () => {
		expect(
			processRelatedEntities(
				{
					entityId: "media_1",
					entitySchemaSlug: "book",
					relatedEntities: [validRelatedEntity],
				},
				createRelatedDeps({
					getBuiltinEntitySchemaBySandboxScriptId: () => Promise.resolve(undefined),
				}),
			),
		).rejects.toThrow('Related entity schema not found for sandbox script slug "person.tmdb"');
	});

	it("throws when the relationship schema is missing", () => {
		expect(
			processRelatedEntities(
				{
					entityId: "media_1",
					entitySchemaSlug: "book",
					relatedEntities: [validRelatedEntity],
				},
				createRelatedDeps({
					getBuiltinRelationshipSchemaBySlug: () => Promise.resolve(undefined),
				}),
			),
		).rejects.toThrow(
			'No relationship schema seeded for related type "person" and entity type "book" (slug: "person-to-book") — check bootstrap manifests',
		);
	});

	it("throws when relationship properties are invalid", () => {
		expect(
			processRelatedEntities(
				{
					entityId: "media_1",
					entitySchemaSlug: "book",
					relatedEntities: [validRelatedEntity],
				},
				createRelatedDeps({
					writeEntityRelationship: () =>
						Promise.resolve({
							error: "validation" as const,
							message:
								"Relationship properties validation failed: order: Expected number, received string",
						}),
				}),
			),
		).rejects.toThrow(
			"Failed to write person-to-book relationship: Relationship properties validation failed: order: Expected number, received string",
		);
	});
});
