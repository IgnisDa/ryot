import { describe, expect, it } from "bun:test";
import type { Job } from "bullmq";
import {
	createListedEntity,
	createOptionalTitlePropertiesSchema,
} from "~/lib/test-fixtures";
import {
	hasImportedEntityDetails,
	processMediaImportJob,
	processPersonPopulateJob,
} from "./worker";

const createJob = (data: unknown): Job =>
	({
		data,
		id: "job_1",
		updateData: async () => {},
		queueQualifiedName: "bull:media",
		getChildrenValues: async () => ({}),
		moveToWaitingChildren: async () => false,
	}) as unknown as Job;

const createMediaDeps = (
	overrides: Partial<
		NonNullable<Parameters<typeof processMediaImportJob>[2]>
	> = {},
): NonNullable<Parameters<typeof processMediaImportJob>[2]> => ({
	upsertInLibraryRelationship: async () => {},
	getUserLibraryEntityId: async () => "library_1",
	getEntitySchemaScopeForUser: async () => undefined,
	findGlobalEntityByExternalId: async () => undefined,
	getBuiltinEntitySchemaBySlug: async () => undefined,
	getBuiltinSandboxScriptBySlug: async () => undefined,
	getSandboxScriptForUser: async () => ({ id: "script_1" }) as never,
	createGlobalEntity: async () => {
		throw new Error("createGlobalEntity should not be called");
	},
	updateGlobalEntityById: async () => {
		throw new Error("updateGlobalEntityById should not be called");
	},
	...overrides,
});

const createPersonDeps = (
	overrides: Partial<
		NonNullable<Parameters<typeof processPersonPopulateJob>[2]>
	> = {},
): NonNullable<Parameters<typeof processPersonPopulateJob>[2]> => ({
	upsertInLibraryRelationship: async () => {},
	getUserLibraryEntityId: async () => "library_1",
	getEntitySchemaScopeForUser: async () => undefined,
	findGlobalEntityByExternalId: async () => undefined,
	getSandboxScriptForUser: async () => ({ id: "script_1" }) as never,
	getBuiltinSandboxScriptBySlug: async () =>
		({ id: "person_script_1" }) as never,
	createGlobalEntity: async () => {
		throw new Error("createGlobalEntity should not be called");
	},
	updateGlobalEntityById: async () => {
		throw new Error("updateGlobalEntityById should not be called");
	},
	getBuiltinEntitySchemaBySlug: async () =>
		({
			id: "person_schema_1",
			propertiesSchema: { fields: {} },
		}) as never,
	...overrides,
});

describe("hasImportedEntityDetails", () => {
	it("returns false for empty placeholder entities", () => {
		expect(
			hasImportedEntityDetails(
				createListedEntity({
					image: null,
					properties: {},
					populatedAt: new Date(0),
				}),
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
					image: { kind: "remote", url: "https://example.com/image.jpg" },
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
				findGlobalEntityByExternalId: async () => entity,
				getSandboxScriptForUser: async () => {
					sandboxScriptLookups += 1;
					return { id: "script_1" } as never;
				},
				upsertInLibraryRelationship: async (input) => {
					linkedMediaEntityId = input.mediaEntityId;
				},
			}),
		);

		expect(result).toEqual(entity);
		expect(linkedMediaEntityId).toBe("media_1");
		expect(sandboxScriptLookups).toBe(1);
	});

	it("still validates the script when the entity is not yet imported", async () => {
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
					getSandboxScriptForUser: async () => {
						sandboxScriptLookups += 1;
						return { id: "script_1" } as never;
					},
				}),
			),
		).rejects.toThrow();

		expect(sandboxScriptLookups).toBe(1);
	});
});

describe("processPersonPopulateJob", () => {
	it("skips sandbox population when the person already has imported details", async () => {
		let updates = 0;

		await processPersonPopulateJob(
			createJob({
				userId: "user_1",
				externalId: "ext_1",
				scriptSlug: "person.tmdb",
				personEntityId: "person_1",
			}),
			undefined,
			createPersonDeps({
				findGlobalEntityByExternalId: async () =>
					createListedEntity({
						id: "person_1",
						externalId: "ext_1",
						sandboxScriptId: "person_script_1",
						properties: { sourceUrl: "https://example.com/person" },
						populatedAt: new Date("2024-01-02T00:00:00.000Z"),
					}),
				updateGlobalEntityById: async () => {
					updates += 1;
					throw new Error("updateGlobalEntityById should not be called");
				},
			}),
		);

		expect(updates).toBe(0);
	});

	it("continues to populate placeholder person entities", async () => {
		let sandboxScriptLookups = 0;

		expect(
			processPersonPopulateJob(
				createJob({
					userId: "user_1",
					externalId: "ext_1",
					scriptSlug: "person.tmdb",
					personEntityId: "person_1",
				}),
				undefined,
				createPersonDeps({
					getBuiltinSandboxScriptBySlug: async () => {
						sandboxScriptLookups += 1;
						return { id: "person_script_1" } as never;
					},
					findGlobalEntityByExternalId: async () =>
						createListedEntity({
							image: null,
							id: "person_1",
							properties: {},
							externalId: "ext_1",
							populatedAt: new Date(0),
							sandboxScriptId: "person_script_1",
						}),
				}),
			),
		).rejects.toThrow();

		expect(sandboxScriptLookups).toBe(1);
	});

	it("does not link media into the library before the entity update succeeds", async () => {
		let linkedMediaEntityId: string | undefined;

		expect(
			processMediaImportJob(
				{
					...createJob({
						userId: "user_1",
						externalId: "ext_1",
						scriptId: "script_1",
						entitySchemaId: "schema_1",
						step: "waiting_for_sandbox",
					}),
					getChildrenValues: async () => ({
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
				} as unknown as Job,
				"token_1",
				createMediaDeps({
					getEntitySchemaScopeForUser: async () =>
						({
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
						}) as never,
					createGlobalEntity: async () => ({
						isNew: true,
						entity: createListedEntity({
							image: null,
							id: "media_1",
							properties: {},
							externalId: "ext_1",
							sandboxScriptId: "script_1",
							populatedAt: new Date(0),
						}),
					}),
					updateGlobalEntityById: async () => {
						throw new Error("update failed");
					},
					upsertInLibraryRelationship: async (input) => {
						linkedMediaEntityId = input.mediaEntityId;
					},
				}),
			),
		).rejects.toThrow("update failed");

		expect(linkedMediaEntityId).toBeUndefined();
	});
});
