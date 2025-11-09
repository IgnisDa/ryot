import { describe, expect, it } from "bun:test";

import {
	createJob,
	createListedEntity,
	createMediaDeps,
	createOptionalTitlePropertiesSchema,
} from "~/lib/test-fixtures";

import { hasImportedEntityDetails, processMediaImportJob, processRelatedEntities } from "./worker";

type MediaDeps = NonNullable<Parameters<typeof processMediaImportJob>[2]>;

describe("hasImportedEntityDetails", () => {
	it("returns false for empty placeholder entities", () => {
		expect(
			hasImportedEntityDetails(
				createListedEntity({ image: null, properties: {}, populatedAt: null }),
			),
		).toBe(false);
	});

	it("returns true when any imported properties exist", () => {
		expect(
			hasImportedEntityDetails(
				createListedEntity({
					image: null,
					properties: { sourceUrl: "https://example.com/item" },
					populatedAt: new Date("2024-01-02T00:00:00.000Z"),
				}),
			),
		).toBe(true);
	});

	it("returns true when an image exists even with no properties", () => {
		expect(
			hasImportedEntityDetails(
				createListedEntity({
					properties: {},
					populatedAt: new Date("2024-01-02T00:00:00.000Z"),
					image: { type: "remote", url: "https://example.com/image.jpg" },
				}),
			),
		).toBe(true);
	});
});

describe("processMediaImportJob", () => {
	it("reuses an already imported entity without fetching details again", async () => {
		const entity = createListedEntity({
			id: "media_1",
			externalId: "ext_1",
			sandboxScriptId: "script_1",
			properties: { sourceUrl: "https://example.com/media" },
			populatedAt: new Date("2024-01-02T00:00:00.000Z"),
		});
		let linkedMediaEntityId: string | undefined;
		let sandboxScriptLookups = 0;

		const result = await processMediaImportJob(
			createJob({
				userId: "user_1",
				externalId: "ext_1",
				scriptId: "script_1",
				entitySchemaId: "schema_1",
			}),
			undefined,
			createMediaDeps({
				findGlobalEntityByExternalId: () => Promise.resolve(entity),
				getSandboxScriptForUser: () => {
					sandboxScriptLookups += 1;
					// oxlint-disable-next-line no-unsafe-type-assertion
					return Promise.resolve({ id: "script_1" } as never);
				},
				upsertInLibraryRelationship: (input) => {
					linkedMediaEntityId = input.mediaEntityId;
					return Promise.resolve();
				},
			}),
		);

		expect(result).toEqual(entity);
		expect(linkedMediaEntityId).toBe("media_1");
		expect(sandboxScriptLookups).toBe(1);
	});

	it("still validates the script when the entity is not yet imported", () => {
		let sandboxScriptLookups = 0;

		expect(
			processMediaImportJob(
				createJob({
					userId: "user_1",
					scriptId: "script_1",
					externalId: "ext_1",
					entitySchemaId: "schema_1",
				}),
				undefined,
				createMediaDeps({
					getSandboxScriptForUser: () => {
						sandboxScriptLookups += 1;
						// oxlint-disable-next-line no-unsafe-type-assertion
						return Promise.resolve({ id: "script_1" } as never);
					},
				}),
			),
		).rejects.toThrow();

		expect(sandboxScriptLookups).toBe(1);
	});

	it("does not link media into the library before the entity update succeeds", () => {
		let linkedMediaEntityId: string | undefined;

		expect(
			processMediaImportJob(
				Object.assign(
					createJob({
						userId: "user_1",
						externalId: "ext_1",
						scriptId: "script_1",
						entitySchemaId: "schema_1",
						step: "waiting_for_sandbox",
					}),
					{
						getChildrenValues: () =>
							Promise.resolve({
								child: {
									logs: null,
									error: null,
									success: true,
									value: {
										name: "Imported title",
										properties: { title: "Imported title", images: [] },
									},
								},
							}),
					},
				),
				"token_1",
				createMediaDeps({
					getEntitySchemaScopeForUser: () =>
						// oxlint-disable-next-line no-unsafe-type-assertion
						Promise.resolve({
							propertiesSchema: {
								fields: {
									...createOptionalTitlePropertiesSchema().fields,
									images: {
										type: "array",
										label: "Images",
										items: {
											label: "Image",
											type: "object",
											properties: {
												url: { label: "URL", type: "string" },
												kind: { label: "Kind", type: "string" },
											},
										},
									},
								},
							},
						} as never),
					createGlobalEntity: () =>
						Promise.resolve({
							isNew: true,
							entity: createListedEntity({
								image: null,
								id: "media_1",
								properties: {},
								populatedAt: null,
								externalId: "ext_1",
								sandboxScriptId: "script_1",
							}),
						}),
					updateGlobalEntityById: () => {
						throw new Error("update failed");
					},
					upsertInLibraryRelationship: (input) => {
						linkedMediaEntityId = input.mediaEntityId;
						return Promise.resolve();
					},
				}),
			),
		).rejects.toThrow("update failed");

		expect(linkedMediaEntityId).toBeUndefined();
	});

	it("succeeds on full job retry after a related write failure", async () => {
		const entity = createListedEntity({
			id: "media_1",
			properties: {},
			populatedAt: null,
			externalId: "ext_1",
			sandboxScriptId: "script_1",
		});
		const relatedEntity = createListedEntity({
			id: "person_1",
			properties: {},
			populatedAt: null,
			externalId: "person_ext_1",
			sandboxScriptId: "person_script_1",
		});
		// oxlint-disable-next-line no-unsafe-type-assertion
		const bookScope = {
			slug: "book",
			userId: null,
			id: "schema_1",
			isBuiltin: false,
			propertiesSchema: {
				fields: {
					...createOptionalTitlePropertiesSchema().fields,
					images: {
						type: "array",
						label: "Images",
						description: "Images",
						items: {
							type: "object",
							label: "Image",
							description: "Image",
							properties: {
								url: { description: "URL", label: "URL", type: "string" },
								kind: { description: "Kind", label: "Kind", type: "string" },
							},
						},
					},
				},
			},
		} as NonNullable<Awaited<ReturnType<MediaDeps["getEntitySchemaScopeForUser"]>>>;
		const personSchema = {
			slug: "person",
			id: "person_schema_1",
			propertiesSchema: { fields: {} },
		} satisfies NonNullable<
			Awaited<ReturnType<MediaDeps["getBuiltinEntitySchemaBySandboxScriptId"]>>
		>;
		const relationshipSchema = {
			id: "rel_schema_1",
			propertiesSchema: { fields: {} },
		} satisfies NonNullable<Awaited<ReturnType<MediaDeps["getBuiltinRelationshipSchemaBySlug"]>>>;
		const relatedScript = {
			id: "person_script_1",
		} satisfies NonNullable<Awaited<ReturnType<MediaDeps["getBuiltinSandboxScriptBySlug"]>>>;
		let relatedScriptLookups = 0;
		let relatedWrites = 0;
		let updateCalls = 0;

		const deps = createMediaDeps({
			findGlobalEntityByExternalId: () => Promise.resolve(entity),
			getEntitySchemaScopeForUser: () => Promise.resolve(bookScope),
			getBuiltinEntitySchemaBySandboxScriptId: () => Promise.resolve(personSchema),
			getBuiltinRelationshipSchemaBySlug: () => Promise.resolve(relationshipSchema),
			getBuiltinSandboxScriptBySlug: () => {
				relatedScriptLookups += 1;
				return Promise.resolve(relatedScript);
			},
			createGlobalEntity: (input) =>
				Promise.resolve(
					input.entitySchemaId === "schema_1"
						? { entity, isNew: false }
						: { isNew: false, entity: relatedEntity },
				),
			writeEntityRelationship: () => {
				relatedWrites += 1;
				if (relatedWrites === 1) {
					return Promise.resolve({ error: "not_found" as const, message: "boom" });
				}

				return Promise.resolve({ data: undefined });
			},
			updateGlobalEntityById: (input) => {
				updateCalls += 1;
				return Promise.resolve(
					createListedEntity({
						name: input.name,
						image: input.image,
						id: input.entityId,
						externalId: "ext_1",
						sandboxScriptId: "script_1",
						properties: input.properties,
						populatedAt: input.populatedAt,
					}),
				);
			},
		});

		const job = createJob({
			userId: "user_1",
			externalId: "ext_1",
			scriptId: "script_1",
			entitySchemaId: "schema_1",
			step: "waiting_for_sandbox",
		});
		Object.assign(job, {
			moveToWaitingChildren: () => Promise.resolve(false),
			getChildrenValues: () =>
				Promise.resolve({
					child_1: {
						logs: null,
						error: null,
						success: true,
						value: {
							name: "Imported title",
							properties: { title: "Imported title", images: [] },
							relatedEntities: [
								{
									name: "Loading...",
									externalId: "person_ext_1",
									scriptSlug: "person.openlibrary",
									relationshipProperties: { roles: ["Author"] },
								},
							],
						},
					},
				}),
		});

		let firstError: unknown;
		try {
			await processMediaImportJob(job, "token_1", deps);
		} catch (error) {
			firstError = error;
		}

		expect(firstError).toBeInstanceOf(Error);
		if (!(firstError instanceof Error)) {
			throw new Error("Expected first retry attempt to fail");
		}
		expect(firstError.message).toBe("Failed to write person-to-book relationship: boom");
		const result = await processMediaImportJob(job, "token_1", deps);

		expect(relatedScriptLookups).toBe(2);
		expect(relatedWrites).toBe(2);
		expect(updateCalls).toBe(1);
		expect(result.populatedAt instanceof Date).toBe(true);
	});
});

describe("processRelatedEntities", () => {
	const relatedPersonSchema = {
		slug: "person",
		id: "person_schema_1",
		propertiesSchema: { fields: {} },
	} satisfies NonNullable<
		Awaited<ReturnType<MediaDeps["getBuiltinEntitySchemaBySandboxScriptId"]>>
	>;
	const relatedRelationshipSchema = {
		id: "rel_schema_1",
		propertiesSchema: { fields: {} },
	} satisfies NonNullable<Awaited<ReturnType<MediaDeps["getBuiltinRelationshipSchemaBySlug"]>>>;
	const relatedSandboxScript = {
		id: "person_script_1",
	} satisfies NonNullable<Awaited<ReturnType<MediaDeps["getBuiltinSandboxScriptBySlug"]>>>;

	it("creates placeholder related entities and writes relationships", async () => {
		let relationshipSlug: string | undefined;
		let createdEntityInput:
			| Parameters<
					NonNullable<Parameters<typeof processRelatedEntities>[1]>["createGlobalEntity"]
			  >[0]
			| undefined;
		let relationshipInput:
			| Parameters<
					NonNullable<Parameters<typeof processRelatedEntities>[1]>["writeEntityRelationship"]
			  >[0]
			| undefined;

		await processRelatedEntities(
			{
				mediaEntityId: "book_1",
				mediaEntitySchemaSlug: "book",
				relatedEntities: [
					{
						name: "Loading...",
						externalId: "OL151749A",
						scriptSlug: "person.openlibrary",
						relationshipProperties: {
							order: 1,
							character: "Jane Doe",
							roles: ["Author", "Editor"],
						},
					},
				],
			},
			{
				getBuiltinSandboxScriptBySlug: () => Promise.resolve(relatedSandboxScript),
				getBuiltinEntitySchemaBySandboxScriptId: () => Promise.resolve(relatedPersonSchema),
				getBuiltinRelationshipSchemaBySlug: (slug) => {
					relationshipSlug = slug;
					return Promise.resolve(relatedRelationshipSchema);
				},
				writeEntityRelationship: (input) => {
					relationshipInput = input;
					return Promise.resolve({ data: undefined });
				},
				createGlobalEntity: (input) => {
					createdEntityInput = input;
					return Promise.resolve({
						isNew: true,
						entity: createListedEntity({
							id: "person_1",
							properties: {},
							name: input.name,
							populatedAt: null,
							externalId: input.externalId,
							sandboxScriptId: input.sandboxScriptId,
						}),
					});
				},
			} satisfies NonNullable<Parameters<typeof processRelatedEntities>[1]>,
		);

		expect(relationshipSlug).toBe("person-to-book");
		expect(createdEntityInput).toEqual({
			name: "Loading...",
			externalId: "OL151749A",
			entitySchemaId: "person_schema_1",
			sandboxScriptId: "person_script_1",
		});
		expect(relationshipInput).toEqual({
			targetEntityId: "book_1",
			sourceEntityId: "person_1",
			relationshipSchemaId: "rel_schema_1",
			properties: { order: 1, character: "Jane Doe", roles: ["Author", "Editor"] },
		});
	});
});
