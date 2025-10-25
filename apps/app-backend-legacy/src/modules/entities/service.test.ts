import { describe, expect, it } from "bun:test";

import {
	createEntityBody,
	createEntityDeps,
	createEntityImportDeps,
	createListedEntity,
	createNestedMetadataPropertiesSchema,
	createOptionalTitlePropertiesSchema,
	createRequiredTitlePropertiesSchema,
	createTitleAndPagesPropertiesSchema,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";

import {
	createEntity,
	getEntityDetail,
	getEntityImportResult,
	importEntity,
	parseEntityProperties,
	resolveEntityCreateInput,
	resolveEntityId,
	resolveEntityName,
	resolveEntitySchemaId,
} from "./service";

describe("resolveEntityName", () => {
	it("trims the provided name", () => {
		expect(resolveEntityName("  My Entity  ")).toBe("My Entity");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEntityName("   ")).toThrow("Entity name is required");
	});
});

describe("resolveEntitySchemaId", () => {
	it("trims the provided entity schema id", () => {
		expect(resolveEntitySchemaId("  schema_123  ")).toBe("schema_123");
	});

	it("throws when the entity schema id is blank", () => {
		expect(() => resolveEntitySchemaId("   ")).toThrow("Entity schema id is required");
	});
});

describe("resolveEntityId", () => {
	it("trims the provided entity id", () => {
		expect(resolveEntityId("  entity_123  ")).toBe("entity_123");
	});

	it("throws when the entity id is blank", () => {
		expect(() => resolveEntityId("   ")).toThrow("Entity id is required");
	});
});

describe("parseEntityProperties", () => {
	it("validates properties against schema", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { pages: 350, title: "My Book" };

		expect(parseEntityProperties({ properties, propertiesSchema })).toMatchObject({
			pages: 350,
			title: "My Book",
		});
	});

	it("accepts properties with optional fields missing", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { title: "My Book" };

		expect(parseEntityProperties({ properties, propertiesSchema })).toMatchObject({
			title: "My Book",
		});
	});

	it("rejects properties missing required fields", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { pages: 350 };

		expect(() => parseEntityProperties({ properties, propertiesSchema })).toThrow(
			"Entity payload is invalid",
		);
	});

	it("rejects properties with wrong type", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = {
			title: "My Book",
			pages: "not a number",
		};

		expect(() => parseEntityProperties({ properties, propertiesSchema })).toThrow(
			"Entity payload is invalid",
		);
	});

	it("rejects non-object properties", () => {
		const propertiesSchema = createOptionalTitlePropertiesSchema();

		expect(() => parseEntityProperties({ properties: "not an object", propertiesSchema })).toThrow(
			"Entity properties must be a JSON object",
		);
	});

	it("rejects array properties", () => {
		const propertiesSchema = createOptionalTitlePropertiesSchema();

		expect(() => parseEntityProperties({ properties: [], propertiesSchema })).toThrow(
			"Entity properties must be a JSON object, not an array",
		);
	});

	it("validates nested object properties", () => {
		const propertiesSchema = createNestedMetadataPropertiesSchema();

		const properties = {
			metadata: { year: 2024, author: "John Doe" },
		};

		expect(parseEntityProperties({ properties, propertiesSchema })).toMatchObject(properties);
	});
});

describe("resolveEntityCreateInput", () => {
	it("returns normalized payload", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		expect(
			resolveEntityCreateInput({
				image: null,
				propertiesSchema,
				name: "  My Book  ",
				properties: { title: "Test Book", pages: 200 },
			}),
		).toEqual({
			image: null,
			name: "My Book",
			properties: { title: "Test Book", pages: 200 },
		});
	});

	it("accepts a remote image url", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { type: "remote", url: "https://example.com/image.jpg" },
			}),
		).toEqual({
			name: "Book",
			properties: { title: "Test Book" },
			image: { type: "remote", url: "https://example.com/image.jpg" },
		});
	});

	it("accepts an s3 image key", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { type: "s3", key: "uploads/entities/entity-image-123" },
			}),
		).toEqual({
			name: "Book",
			properties: { title: "Test Book" },
			image: { type: "s3", key: "uploads/entities/entity-image-123" },
		});
	});

	it("rejects invalid remote image urls", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(() =>
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { type: "remote", url: "not-a-url" },
			}),
		).toThrow("Entity image remote url must be a valid URL");
	});
});

describe("getEntityDetail", () => {
	it("returns not found when the entity does not exist", async () => {
		const result = await getEntityDetail(
			{ entityId: "entity_1", userId: "user_1" },
			createEntityDeps({ getEntityScopeForUser: () => Promise.resolve(undefined) }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});

	it("returns entity data for a global entity with a builtin schema visible to any user", async () => {
		const globalEntity = createListedEntity({ id: "entity_global" });
		const result = await getEntityDetail(
			{ entityId: "entity_global", userId: "user_1" },
			createEntityDeps({
				getEntityScopeForUser: (input) =>
					Promise.resolve({
						isBuiltin: true,
						entityUserId: null,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						entitySchemaId: "schema_1",
					}),
				getEntityByIdForUser: () => Promise.resolve(globalEntity),
			}),
		);

		expect(result).toEqual({ data: globalEntity });
	});

	it("returns entity data for a user-owned builtin library entity", async () => {
		const libraryEntity = createListedEntity({ id: "entity_library" });
		const result = await getEntityDetail(
			{ entityId: "entity_library", userId: "user_1" },
			createEntityDeps({
				getEntityScopeForUser: (input) =>
					Promise.resolve({
						isBuiltin: true,
						entityId: input.entityId,
						entityUserId: input.userId,
						entitySchemaSlug: "library",
						entitySchemaId: "schema_library",
					}),
				getEntityByIdForUser: () => Promise.resolve(libraryEntity),
			}),
		);

		expect(result).toEqual({ data: libraryEntity });
	});

	it("returns entity data for a user-owned builtin entity (e.g. workout)", async () => {
		const workoutEntity = createListedEntity({ id: "entity_workout" });
		const result = await getEntityDetail(
			{ entityId: "entity_workout", userId: "user_1" },
			createEntityDeps({
				getEntityScopeForUser: (input) =>
					Promise.resolve({
						isBuiltin: true,
						entityId: input.entityId,
						entityUserId: input.userId,
						entitySchemaSlug: "workout",
						entitySchemaId: "schema_workout",
					}),
				getEntityByIdForUser: () => Promise.resolve(workoutEntity),
			}),
		);

		expect(result).toEqual({ data: workoutEntity });
	});
});

describe("createEntity", () => {
	it("normalizes the payload before persisting", async () => {
		let createdName: string | undefined;
		const deps = createEntityDeps({
			createEntityForUser: (input) => {
				createdName = input.name;
				return Promise.resolve(
					createListedEntity({
						name: input.name,
						image: input.image,
						properties: input.properties,
					}),
				);
			},
		});

		const createdEntity = expectDataResult(
			await createEntity(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						name: "  My Book  ",
						properties: { title: "My Book" },
					},
				},
				deps,
			),
		);

		expect(createdName).toBe("My Book");
		expect(createdEntity.name).toBe("My Book");
	});

	it("allows manual creation for any built-in entity schema", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: createEntityBody({
					entitySchemaId: "schema_book",
					name: "Dune",
					properties: { title: "Dune" },
				}),
			},
			createEntityDeps({
				getEntitySchemaScopeForUser: () =>
					Promise.resolve({
						userId: null,
						slug: "book",
						isBuiltin: true,
						id: "schema_book",
						propertiesSchema: {
							fields: {
								title: { type: "string" as const, label: "Title", description: "Title" },
							},
						},
					}),
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
	});

	it("allows manual creation for the built-in workout schema", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: createEntityBody({
					entitySchemaId: "schema_workout",
					name: "Push Day",
					properties: {
						endedAt: "2026-04-27T11:00:00Z",
						startedAt: "2026-04-27T10:00:00Z",
					},
				}),
			},
			createEntityDeps({
				getEntitySchemaScopeForUser: () =>
					Promise.resolve({
						userId: null,
						slug: "workout",
						isBuiltin: true,
						id: "schema_workout",
						propertiesSchema: {
							fields: {
								endedAt: { label: "Ended At", type: "datetime" as const, description: "Ended At" },
								startedAt: {
									label: "Started At",
									type: "datetime" as const,
									description: "Started At",
								},
							},
						},
					}),
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
	});

	it("returns validation for a blank entity schema id", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: { ...createEntityBody(), entitySchemaId: "   " },
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity schema id is required",
		});
	});

	it("returns validation when only externalId is provided without sandboxScriptId", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: { ...createEntityBody(), externalId: "ol:OL12345M" },
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "externalId and sandboxScriptId must both be provided or both be omitted",
		});
	});

	it("returns validation when only sandboxScriptId is provided without externalId", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					sandboxScriptId: "script_details_1",
				},
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "externalId and sandboxScriptId must both be provided or both be omitted",
		});
	});

	it("returns the existing entity without inserting when provenance fields match", async () => {
		const existingEntity = createListedEntity({
			id: "entity_existing",
			externalId: "ol:OL12345M",
			sandboxScriptId: "script_details_1",
		});
		let createCalled = false;
		const deps = createEntityDeps({
			findEntityByExternalIdForUser: () => Promise.resolve(existingEntity),
			createEntityForUser: (input) => {
				createCalled = true;
				return Promise.resolve(createListedEntity({ name: input.name }));
			},
		});

		const result = await createEntity(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					externalId: "ol:OL12345M",
					sandboxScriptId: "script_details_1",
				},
			},
			deps,
		);

		expect(createCalled).toBe(false);
		expect(result).toEqual({ data: existingEntity });
	});

	it("creates a new entity with provenance fields when no matching entity exists", async () => {
		let capturedInput: Parameters<typeof createEntityBody>[0] | undefined;
		const deps = createEntityDeps({
			findEntityByExternalIdForUser: () => Promise.resolve(undefined),
			createEntityForUser: (input) => {
				// oxlint-disable-next-line no-unsafe-type-assertion
				capturedInput = input as unknown as Parameters<typeof createEntityBody>[0];
				return Promise.resolve(
					createListedEntity({
						name: input.name,
						externalId: input.externalId ?? null,
						sandboxScriptId: input.sandboxScriptId ?? null,
					}),
				);
			},
		});

		const result = expectDataResult(
			await createEntity(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						externalId: "ol:OL99999M",
						sandboxScriptId: "script_details_1",
					},
				},
				deps,
			),
		);

		expect(capturedInput).toBeDefined();
		expect(result.externalId).toBe("ol:OL99999M");
		expect(result.sandboxScriptId).toBe("script_details_1");
	});
});

describe("importEntity", () => {
	it("enqueues the job with the correct payload fields", async () => {
		let capturedJobId: string | undefined;
		let capturedPayload: Record<string, unknown> | undefined;
		const deps = createEntityImportDeps({
			addJobToQueue: ({ jobId, payload }) => {
				capturedJobId = jobId;
				capturedPayload = payload as Record<string, unknown>;
				return Promise.resolve();
			},
		});

		await importEntity(
			{
				userId: "user_1",
				body: { scriptId: "script_1", externalId: "ext_123", entitySchemaId: "schema_1" },
			},
			deps,
		);

		expect(typeof capturedJobId).toBe("string");
		expect(capturedJobId?.length).toBeGreaterThan(0);
		expect(capturedPayload).toMatchObject({
			userId: "user_1",
			scriptId: "script_1",
			externalId: "ext_123",
			entitySchemaId: "schema_1",
		});
	});

	it("returns the generated jobId", async () => {
		const result = expectDataResult(
			await importEntity(
				{
					userId: "user_1",
					body: { scriptId: "s", externalId: "i", entitySchemaId: "e" },
				},
				createEntityImportDeps(),
			),
		);

		expect(typeof result.jobId).toBe("string");
		expect(result.jobId.length).toBeGreaterThan(0);
	});
});

describe("getEntityImportResult", () => {
	it("returns not_found when the job does not exist", async () => {
		const result = await getEntityImportResult(
			{ jobId: "missing", userId: "user_1" },
			createEntityImportDeps({ getJobFromQueue: () => Promise.resolve(null) }),
		);

		expect(result).toEqual({ error: "not_found", message: "Entity import job not found" });
	});

	it("returns not_found when the job belongs to a different user", async () => {
		const deps = createEntityImportDeps({
			getJobFromQueue: () =>
				Promise.resolve({
					failedReason: undefined,
					// oxlint-disable-next-line no-unsafe-type-assertion
					returnvalue: {} as never,
					getState: () => Promise.resolve("completed" as const),
					data: { scriptId: "s", externalId: "i", entitySchemaId: "e", userId: "other_user" },
				}),
		});

		const result = await getEntityImportResult({ jobId: "job_1", userId: "user_1" }, deps);

		expect(result).toEqual({ error: "not_found", message: "Entity import job not found" });
	});

	it("returns pending when the job is still queued", async () => {
		const result = await getEntityImportResult(
			{ jobId: "job_1", userId: "user_1" },
			createEntityImportDeps(),
		);

		expect(result).toEqual({ data: { status: "pending" } });
	});

	it("returns failed with the job's failedReason", async () => {
		const deps = createEntityImportDeps({
			getJobFromQueue: () =>
				Promise.resolve({
					// oxlint-disable-next-line no-unsafe-type-assertion
					returnvalue: {} as never,
					failedReason: "Script threw an error",
					getState: () => Promise.resolve("failed" as const),
					data: { scriptId: "s", externalId: "i", userId: "user_1", entitySchemaId: "e" },
				}),
		});

		const result = await getEntityImportResult({ jobId: "job_1", userId: "user_1" }, deps);

		expect(result).toEqual({ data: { status: "failed", error: "Script threw an error" } });
	});

	it("returns validation when jobId is blank", async () => {
		const result = await getEntityImportResult(
			{ jobId: "   ", userId: "user_1" },
			createEntityImportDeps(),
		);

		expect(result).toEqual({ error: "validation", message: "Entity import job id is required" });
	});
});
