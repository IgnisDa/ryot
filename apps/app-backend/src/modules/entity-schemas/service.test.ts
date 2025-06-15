import { describe, expect, it } from "bun:test";
import { expectDataResult } from "~/lib/test-helpers";
import { authenticationBuiltinEntitySchemas } from "../authentication/bootstrap/manifests";
import type { CreateEntitySchemaBody, ListedEntitySchema } from "./schemas";
import {
	createEntitySchema,
	type EntitySchemaServiceDeps,
	getEntitySchemaById,
	listEntitySchemas,
	parseEntitySchemaPropertiesSchema,
	resolveEntitySchemaAccentColor,
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaIcon,
	resolveEntitySchemaName,
	resolveEntitySchemaTrackerId,
	validateSlugNotReserved,
} from "./service";

const createEntitySchemaBody = (): CreateEntitySchemaBody => ({
	name: "Books",
	icon: "book-open",
	trackerId: "tracker_1",
	accentColor: "#5B7FFF",
	propertiesSchema: { title: { type: "string" } },
});

const createListedEntitySchema = (
	overrides: Partial<ListedEntitySchema> = {},
): ListedEntitySchema => ({
	slug: "books",
	name: "Books",
	id: "schema_1",
	isBuiltin: false,
	icon: "book-open",
	trackerId: "tracker_1",
	accentColor: "#5B7FFF",
	propertiesSchema: { title: { type: "string" } },
	...overrides,
});

const createDeps = (
	overrides: Partial<EntitySchemaServiceDeps> = {},
): EntitySchemaServiceDeps => ({
	getEntitySchemaByIdForUser: async () => undefined,
	getEntitySchemaBySlugForUser: async () => undefined,
	listEntitySchemasByTracker: async () => [createListedEntitySchema()],
	getTrackerScopeForUser: async (input) => ({
		isBuiltin: false,
		id: input.trackerId,
		userId: input.userId,
	}),
	createEntitySchemaForUser: async (input) =>
		createListedEntitySchema({
			name: input.name,
			slug: input.slug,
			icon: input.icon,
			trackerId: input.trackerId,
			accentColor: input.accentColor,
			propertiesSchema: input.propertiesSchema,
		}),
	...overrides,
});

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
	it("accepts flat properties map", () => {
		expect(
			parseEntitySchemaPropertiesSchema({
				title: { type: "string" },
				pages: { type: "integer" },
			}),
		).toEqual({
			title: { type: "string" },
			pages: { type: "integer" },
		});
	});

	it("accepts already-parsed properties map", () => {
		const schema = {
			title: { type: "string" as const },
			pages: { type: "integer" as const },
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object root like array, string, or null", () => {
		for (const input of [[], "hello", null]) {
			if (Array.isArray(input)) {
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected record, received array",
				);
			} else if (input === null) {
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected record, received null",
				);
			} else {
				expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
					"Invalid input: expected record, received string",
				);
			}
		}
	});

	it("rejects empty properties map", () => {
		expect(() => parseEntitySchemaPropertiesSchema({})).toThrow(
			"Entity schema properties must contain at least one property",
		);
	});

	it("rejects property without type field", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ title: { required: true } }),
		).toThrow("Invalid input");
	});

	it("rejects property with invalid type", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ title: { type: "invalid" } }),
		).toThrow("Invalid input");
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ tags: { type: "array" } }),
		).toThrow("Invalid input: expected object, received undefined");
	});

	it("rejects object property without properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema({ metadata: { type: "object" } }),
		).toThrow("Invalid input: expected record, received undefined");
	});

	it("accepts complex nested structure", () => {
		const schema = {
			people: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						role: { type: "string" as const },
						identifier: { type: "string" as const },
					},
				},
			},
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("validates recursively nested arrays", () => {
		const schema = {
			matrix: {
				type: "array" as const,
				items: {
					type: "array" as const,
					items: { type: "number" as const },
				},
			},
		};

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
				propertiesSchema: { title: { type: "string" } },
			}),
		).toEqual({
			icon: "book-open",
			name: "Book Details",
			accentColor: "#5B7FFF",
			slug: "my-custom-schema",
			propertiesSchema: { title: { type: "string" } },
		});
	});

	it("throws when icon is blank", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				icon: "   ",
				name: "Books",
				accentColor: "#5B7FFF",
				propertiesSchema: { title: { type: "string" } },
			}),
		).toThrow("Entity schema icon is required");
	});

	it("throws when accent color is blank", () => {
		expect(() =>
			resolveEntitySchemaCreateInput({
				name: "Books",
				icon: "book-open",
				accentColor: "   ",
				propertiesSchema: { title: { type: "string" } },
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
				propertiesSchema: { title: { type: "string" } },
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
	it("returns not found when the tracker does not exist", async () => {
		const result = await listEntitySchemas(
			{ trackerId: "tracker_1", userId: "user_1" },
			createDeps({ getTrackerScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Tracker not found",
		});
	});
});

describe("createEntitySchema", () => {
	it("normalizes the payload before persisting", async () => {
		let createdSlug: string | undefined;
		const deps = createDeps({
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
			createDeps({
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
			createDeps(),
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
			createDeps({ getEntitySchemaByIdForUser: async () => schema }),
		);

		expect(result).toEqual({ data: schema });
	});

	it("returns not_found when entity schema does not exist", async () => {
		const result = await getEntitySchemaById(
			{ entitySchemaId: "non_existent", userId: "user_1" },
			createDeps({ getEntitySchemaByIdForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});

	it("returns not_found when the schema belongs to another user", async () => {
		const result = await getEntitySchemaById(
			{ entitySchemaId: "schema_1", userId: "other_user" },
			createDeps({ getEntitySchemaByIdForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});
});
