import { describe, expect, it } from "bun:test";

import type { Job } from "bullmq";

import { createListedEntity, createOptionalTitlePropertiesSchema } from "~/lib/test-fixtures";

import {
	hasImportedEntityDetails,
	processMediaImportJob,
	processPersonPopulateJob,
} from "./worker";

const createJob = (data: unknown): Job =>
	// oxlint-disable-next-line no-unsafe-type-assertion
	({
		data,
		id: "job_1",
		updateData: () => Promise.resolve(),
		queueQualifiedName: "bull:media",
		getChildrenValues: () => Promise.resolve({}),
		moveToWaitingChildren: () => Promise.resolve(false),
	}) as unknown as Job;

const createMediaDeps = (
	overrides: Partial<NonNullable<Parameters<typeof processMediaImportJob>[2]>> = {},
): NonNullable<Parameters<typeof processMediaImportJob>[2]> => ({
	upsertInLibraryRelationship: () => Promise.resolve(),
	getUserLibraryEntityId: () => Promise.resolve("library_1"),
	getEntitySchemaScopeForUser: () => Promise.resolve(undefined),
	findGlobalEntityByExternalId: () => Promise.resolve(undefined),
	getBuiltinEntitySchemaBySlug: () => Promise.resolve(undefined),
	getBuiltinSandboxScriptBySlug: () => Promise.resolve(undefined),
	// oxlint-disable-next-line no-unsafe-type-assertion
	getSandboxScriptForUser: () => Promise.resolve({ id: "script_1" } as never),
	createGlobalEntity: () => {
		throw new Error("createGlobalEntity should not be called");
	},
	updateGlobalEntityById: () => {
		throw new Error("updateGlobalEntityById should not be called");
	},
	...overrides,
});

const createPersonDeps = (
	overrides: Partial<NonNullable<Parameters<typeof processPersonPopulateJob>[2]>> = {},
): NonNullable<Parameters<typeof processPersonPopulateJob>[2]> => ({
	upsertInLibraryRelationship: () => Promise.resolve(),
	getUserLibraryEntityId: () => Promise.resolve("library_1"),
	getEntitySchemaScopeForUser: () => Promise.resolve(undefined),
	findGlobalEntityByExternalId: () => Promise.resolve(undefined),
	// oxlint-disable-next-line no-unsafe-type-assertion
	getSandboxScriptForUser: () => Promise.resolve({ id: "script_1" } as never),
	// oxlint-disable-next-line no-unsafe-type-assertion
	getBuiltinSandboxScriptBySlug: () => Promise.resolve({ id: "person_script_1" } as never),
	createGlobalEntity: () => {
		throw new Error("createGlobalEntity should not be called");
	},
	updateGlobalEntityById: () => {
		throw new Error("updateGlobalEntityById should not be called");
	},
	getBuiltinEntitySchemaBySlug: () =>
		// oxlint-disable-next-line no-unsafe-type-assertion
		Promise.resolve({
			id: "person_schema_1",
			propertiesSchema: { fields: {} },
		} as never),
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
				findGlobalEntityByExternalId: () =>
					Promise.resolve(
						createListedEntity({
							id: "person_1",
							externalId: "ext_1",
							sandboxScriptId: "person_script_1",
							properties: { sourceUrl: "https://example.com/person" },
							populatedAt: new Date("2024-01-02T00:00:00.000Z"),
						}),
					),
				updateGlobalEntityById: () => {
					updates += 1;
					throw new Error("updateGlobalEntityById should not be called");
				},
			}),
		);

		expect(updates).toBe(0);
	});

	it("continues to populate placeholder person entities", () => {
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
					getBuiltinSandboxScriptBySlug: () => {
						sandboxScriptLookups += 1;
						// oxlint-disable-next-line no-unsafe-type-assertion
						return Promise.resolve({ id: "person_script_1" } as never);
					},
					findGlobalEntityByExternalId: () =>
						Promise.resolve(
							createListedEntity({
								image: null,
								id: "person_1",
								properties: {},
								externalId: "ext_1",
								populatedAt: new Date(0),
								sandboxScriptId: "person_script_1",
							}),
						),
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
								externalId: "ext_1",
								sandboxScriptId: "script_1",
								populatedAt: new Date(0),
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
});
