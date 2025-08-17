import { describe, expect, it } from "bun:test";
import {
	createEntityImportDeps,
	createEntitySchemaBody,
	createEntitySchemaDeps,
	createEntitySearchDeps,
	createListedEntitySchema,
	createNestedMatrixPropertySchema,
	createNestedPeoplePropertySchema,
	createOptionalTitlePropertiesSchema,
	createTitlePagesPropertiesSchema,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import { authenticationBuiltinEntitySchemas } from "../authentication/bootstrap/manifests";
import {
	createEntitySchema,
	enqueueEntitySearch,
	getEntityImportResult,
	getEntitySchemaById,
	getEntitySearchResult,
	importEntity,
	listEntitySchemas,
	parseEntitySchemaPropertiesSchema,
	resolveEntitySchemaAccentColor,
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaIcon,
	resolveEntitySchemaName,
	resolveEntitySchemaTrackerId,
	validateSlugNotReserved,
} from "./service";

describe("resolveEntitySchemaName", () => {
	it("trims the provided name", () => {
		expect(resolveEntitySchemaName("  Book Details  ")).toBe("Book Details");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEntitySchemaName("   ")).toThrow(
			"Entity schema name is required",
		);
	});
});

describe("resolveEntitySchemaIcon", () => {
	it("trims the provided icon", () => {
		expect(resolveEntitySchemaIcon("  book-open  ")).toBe("book-open");
	});

	it("throws when the icon is blank", () => {
		expect(() => resolveEntitySchemaIcon("   ")).toThrow(
			"Entity schema icon is required",
		);
	});
});

describe("resolveEntitySchemaAccentColor", () => {
	it("trims the provided accent color", () => {
		expect(resolveEntitySchemaAccentColor("  #5B7FFF  ")).toBe("#5B7FFF");
	});

	it("throws when the accent color is blank", () => {
		expect(() => resolveEntitySchemaAccentColor("   ")).toThrow(
			"Entity schema accent color is required",
		);
	});
});

describe("parseEntitySchemaPropertiesSchema", () => {
	it("accepts a valid properties schema object", () => {
		const schema = createTitlePagesPropertiesSchema();

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object root like array, string, or null", () => {
		for (const input of [[], "hello", null]) {
			if (Array.isArray(input)) {
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected object, received array",
				);
			} else if (input === null) {
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected object, received null",
				);
			} else {
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected object, received string",
				);
			}
		}
	});

	it("rejects empty properties map", () => {
		expect(() => parseEntitySchemaPropertiesSchema({ fields: {} })).toThrow(
			"Entity schema properties must contain at least one property",
		);
	});

	it("rejects property without type field", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({
				fields: {
					title: { validation: { required: true } },
				},
			}),
		).toThrow("Invalid input");
	});

	it("rejects property with invalid type", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({
				fields: { title: { label: "Title", type: "invalid" } },
			}),
		).toThrow("Invalid input");
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({
				fields: { tags: { label: "Tags", type: "array" } },
			}),
		).toThrow("Invalid input: expected object, received undefined");
	});

	it("rejects object property without properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({
				fields: { metadata: { label: "Metadata", type: "object" } },
			}),
		).toThrow("Invalid input: expected record, received undefined");
	});

	it("accepts complex nested structure", () => {
		const schema = createNestedPeoplePropertySchema();

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("validates recursively nested arrays", () => {
		const schema = createNestedMatrixPropertySchema();

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});
});

describe("resolveEntitySchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEntitySchemaCreateInput({
				icon: "  book-open  ",
				name: "  Book Details  ",
				accentColor: "  #5B7FFF  ",
				slug: "  My_Custom Schema  ",
				propertiesSchema: createOptionalTitlePropertiesSchema(),
			}),
		).toEqual({
			icon: "book-open",
			name: "Book Details",
			accentColor: "#5B7FFF",
			slug: "my-custom-schema",
			propertiesSchema: createOptionalTitlePropertiesSchema(),
		});
	});

	it("throws when icon is blank", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				icon: "   ",
				name: "Books",
				accentColor: "#5B7FFF",
				propertiesSchema: createOptionalTitlePropertiesSchema(),
			}),
		).toThrow("Entity schema icon is required");
	});

	it("throws when accent color is blank", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				name: "Books",
				icon: "book-open",
				accentColor: "   ",
				propertiesSchema: createOptionalTitlePropertiesSchema(),
			}),
		).toThrow("Entity schema accent color is required");
	});

	it("throws when slug is reserved", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				slug: "book",
				name: "Books",
				icon: "book-open",
				accentColor: "#5B7FFF",
				propertiesSchema: createOptionalTitlePropertiesSchema(),
			}),
		).toThrow('Entity schema slug "book" is reserved for built-in schemas');
	});
});

describe("resolveEntitySchemaTrackerId", () => {
	it("trims the provided tracker id", () => {
		expect(resolveEntitySchemaTrackerId("  tracker_123  ")).toBe("tracker_123");
	});

	it("throws when the tracker id is blank", () => {
		expect(() => resolveEntitySchemaTrackerId("   ")).toThrow(
			"Tracker id is required",
		);
	});
});

describe("validateSlugNotReserved", () => {
	const builtinEntitySchemas = authenticationBuiltinEntitySchemas();
	const reservedSlugs = builtinEntitySchemas.map((s) => s.slug);

	it("throws error for each built-in schema slug", () => {
		for (const slug of reservedSlugs) {
			expect(() => validateSlugNotReserved(slug)).toThrow(
				`Entity schema slug "${slug}" is reserved for built-in schemas`,
			);
		}
	});

	it("does not throw for non-reserved slugs", () => {
		const nonReservedSlugs = [
			"cars",
			"whiskey",
			"smartphones",
			"custom-schema",
		];

		for (const slug of nonReservedSlugs) {
			expect(() => validateSlugNotReserved(slug)).not.toThrow();
		}
	});

	it("derives reserved list from manifests", () => {
		expect(reservedSlugs).toContain("book");
		expect(reservedSlugs).toContain("anime");
		expect(reservedSlugs).toContain("manga");
	});
});

describe("listEntitySchemas", () => {
	it("lists all accessible schemas when trackerId and slugs are both missing", async () => {
		const result = await listEntitySchemas(
			{ userId: "user_1" },
			createEntitySchemaDeps({
				listEntitySchemasForUser: async () => [
					createListedEntitySchema({ slug: "books" }),
					createListedEntitySchema({
						id: "schema_2",
						name: "Movies",
						slug: "movies",
						trackerId: "tracker_2",
					}),
				],
			}),
		);

		expect(result).toEqual({
			data: [
				createListedEntitySchema({ slug: "books" }),
				createListedEntitySchema({
					id: "schema_2",
					name: "Movies",
					slug: "movies",
					trackerId: "tracker_2",
				}),
			],
		});
	});

	it("returns not found when the tracker does not exist", async () => {
		const result = await listEntitySchemas(
			{ trackerId: "tracker_1", userId: "user_1" },
			createEntitySchemaDeps({ getTrackerScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Tracker not found",
		});
	});

	it("lists schemas by slug without tracker lookup", async () => {
		let lookedUpTracker = false;
		let listedSlugs: string[] | undefined;
		const result = await listEntitySchemas(
			{ slugs: ["books", "movies"], userId: "user_1" },
			createEntitySchemaDeps({
				getTrackerScopeForUser: async () => {
					lookedUpTracker = true;
					return undefined;
				},
				listEntitySchemasForUser: async (input) => {
					listedSlugs = input.slugs;
					return [createListedEntitySchema({ slug: "books" })];
				},
			}),
		);

		expect(result).toEqual({
			data: [createListedEntitySchema({ slug: "books" })],
		});
		expect(lookedUpTracker).toBe(false);
		expect(listedSlugs).toEqual(["books", "movies"]);
	});
});

describe("createEntitySchema", () => {
	it("normalizes the payload before persisting", async () => {
		let createdSlug: string | undefined;
		const deps = createEntitySchemaDeps({
			createEntitySchemaForUser: async (input) => {
				createdSlug = input.slug;
				return createListedEntitySchema({ slug: input.slug, name: input.name });
			},
		});

		const createdEntitySchema = expectDataResult(
			await createEntitySchema(
				{
					userId: "user_1",
					body: {
						...createEntitySchemaBody(),
						slug: "  My_Custom Schema  ",
					},
				},
				deps,
			),
		);

		expect(createdSlug).toBe("my-custom-schema");
		expect(createdEntitySchema.slug).toBe("my-custom-schema");
	});

	it("returns validation when the tracker is built in", async () => {
		const result = await createEntitySchema(
			{ body: createEntitySchemaBody(), userId: "user_1" },
			createEntitySchemaDeps({
				getTrackerScopeForUser: async () => ({
					id: "tracker_1",
					isBuiltin: true,
					userId: "user_1",
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in trackers do not support entity schema creation",
		});
	});

	it("returns validation for a blank tracker id", async () => {
		const result = await createEntitySchema(
			{
				body: { ...createEntitySchemaBody(), trackerId: "   " },
				userId: "user_1",
			},
			createEntitySchemaDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Tracker id is required",
		});
	});
});

describe("getEntitySchemaById", () => {
	it("returns the entity schema when it exists for the user", async () => {
		const schema = createListedEntitySchema();
		const result = await getEntitySchemaById(
			{ entitySchemaId: "schema_1", userId: "user_1" },
			createEntitySchemaDeps({
				getEntitySchemaByIdForUser: async () => schema,
			}),
		);

		expect(result).toEqual({ data: schema });
	});

	it("returns not_found when entity schema does not exist", async () => {
		const result = await getEntitySchemaById(
			{ entitySchemaId: "non_existent", userId: "user_1" },
			createEntitySchemaDeps({
				getEntitySchemaByIdForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});

	it("returns not_found when the schema belongs to another user", async () => {
		const result = await getEntitySchemaById(
			{ entitySchemaId: "schema_1", userId: "other_user" },
			createEntitySchemaDeps({
				getEntitySchemaByIdForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});
});

describe("enqueueEntitySearch", () => {
	it("forwards driverName, scriptId, and context to the sandbox", async () => {
		let capturedBody: Record<string, unknown> | undefined;
		let capturedUserId: string | undefined;
		const deps = createEntitySearchDeps({
			enqueueSandboxJob: async (input) => {
				capturedBody = input.body as Record<string, unknown>;
				capturedUserId = input.userId;
				return { data: { jobId: "job_search_1" } };
			},
		});

		await enqueueEntitySearch(
			{
				userId: "user_1",
				body: { scriptId: "script_1", context: { page: 1, query: "test" } },
			},
			deps,
		);

		expect(capturedUserId).toBe("user_1");
		expect(capturedBody).toMatchObject({
			driverName: "search",
			scriptId: "script_1",
			context: { page: 1, query: "test" },
		});
	});

	it("returns the jobId returned by the sandbox", async () => {
		const deps = createEntitySearchDeps({
			enqueueSandboxJob: async () => ({ data: { jobId: "job_abc" } }),
		});

		const result = await enqueueEntitySearch(
			{ userId: "user_1", body: { scriptId: "script_1" } },
			deps,
		);

		expect(result).toEqual({ data: { jobId: "job_abc" } });
	});

	it("propagates not_found when the script does not exist", async () => {
		const deps = createEntitySearchDeps({
			enqueueSandboxJob: async () => ({
				error: "not_found" as const,
				message: "Sandbox script not found",
			}),
		});

		const result = await enqueueEntitySearch(
			{ userId: "user_1", body: { scriptId: "nonexistent" } },
			deps,
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Sandbox script not found",
		});
	});
});

describe("getEntitySearchResult", () => {
	it("forwards jobId and userId to the sandbox result lookup", async () => {
		let capturedJobId: string | undefined;
		let capturedUserId: string | undefined;
		const deps = createEntitySearchDeps({
			getSandboxJobResult: async (input) => {
				capturedJobId = input.jobId;
				capturedUserId = input.userId;
				return { data: { status: "pending" as const } };
			},
		});

		await getEntitySearchResult({ jobId: "job_1", userId: "user_1" }, deps);

		expect(capturedJobId).toBe("job_1");
		expect(capturedUserId).toBe("user_1");
	});

	it("propagates not_found when the job does not exist", async () => {
		const deps = createEntitySearchDeps({
			getSandboxJobResult: async () => ({
				error: "not_found" as const,
				message: "Sandbox job not found",
			}),
		});

		const result = await getEntitySearchResult(
			{ jobId: "nonexistent", userId: "user_1" },
			deps,
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Sandbox job not found",
		});
	});
});

describe("importEntity", () => {
	it("enqueues the job with the correct payload fields", async () => {
		let capturedJobId: string | undefined;
		let capturedPayload: Record<string, unknown> | undefined;
		const deps = createEntityImportDeps({
			addJobToQueue: async ({ jobId, payload }) => {
				capturedJobId = jobId;
				capturedPayload = payload as Record<string, unknown>;
			},
		});

		await importEntity(
			{
				userId: "user_1",
				body: {
					scriptId: "script_1",
					identifier: "ext_123",
					entitySchemaId: "schema_1",
				},
			},
			deps,
		);

		expect(typeof capturedJobId).toBe("string");
		expect(capturedJobId?.length).toBeGreaterThan(0);
		expect(capturedPayload).toMatchObject({
			userId: "user_1",
			scriptId: "script_1",
			identifier: "ext_123",
			entitySchemaId: "schema_1",
		});
	});

	it("returns the generated jobId", async () => {
		const result = expectDataResult(
			await importEntity(
				{
					userId: "user_1",
					body: { scriptId: "s", identifier: "i", entitySchemaId: "e" },
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
			createEntityImportDeps({ getJobFromQueue: async () => null }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity import job not found",
		});
	});

	it("returns not_found when the job belongs to a different user", async () => {
		const deps = createEntityImportDeps({
			getJobFromQueue: async () => ({
				failedReason: undefined,
				returnvalue: {} as never,
				getState: async () => "completed",
				data: {
					scriptId: "s",
					identifier: "i",
					entitySchemaId: "e",
					userId: "other_user",
				},
			}),
		});

		const result = await getEntityImportResult(
			{ jobId: "job_1", userId: "user_1" },
			deps,
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity import job not found",
		});
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
			getJobFromQueue: async () => ({
				returnvalue: {} as never,
				getState: async () => "failed",
				failedReason: "Script threw an error",
				data: {
					scriptId: "s",
					identifier: "i",
					userId: "user_1",
					entitySchemaId: "e",
				},
			}),
		});

		const result = await getEntityImportResult(
			{ jobId: "job_1", userId: "user_1" },
			deps,
		);

		expect(result).toEqual({
			data: { status: "failed", error: "Script threw an error" },
		});
	});

	it("returns validation when jobId is blank", async () => {
		const result = await getEntityImportResult(
			{ jobId: "   ", userId: "user_1" },
			createEntityImportDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity import job id is required",
		});
	});
});
