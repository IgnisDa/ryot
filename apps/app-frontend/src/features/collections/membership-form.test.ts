import { describe, expect, it } from "bun:test";
import {
	createAppCollectionFixture,
	createEntityFixture,
} from "~/features/test-fixtures";
import {
	buildCollectionSelectionPatch,
	buildDefaultMembershipFormValues,
	buildMembershipFormSchema,
	buildMembershipPropertyDefaults,
	deriveInitialValuesFromEntity,
	getMembershipFormReconciliationState,
	getMembershipPropertyEntries,
	getSelectedCollection,
	getUnsupportedRequiredProperties,
	reconcileMembershipProperties,
	syncMembershipFormValues,
	toMembershipPayload,
} from "./membership-form";

describe("buildDefaultMembershipFormValues", () => {
	it("returns empty collectionId and properties when no collection is selected", () => {
		const values = buildDefaultMembershipFormValues(undefined);

		expect(values.collectionId).toBe("");
		expect(values.properties).toEqual({});
	});

	it("returns collection id and empty properties when collection has no schema", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: null,
		});
		const values = buildDefaultMembershipFormValues(collection);

		expect(values.collectionId).toBe("collection-1");
		expect(values.properties).toEqual({});
	});

	it("generates default values for required primitive properties", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: { label: "Notes", type: "string" },
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
					rating: {
						label: "Rating",
						type: "number",
						validation: { required: true },
					},
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const values = buildDefaultMembershipFormValues(collection);

		expect(values.collectionId).toBe("collection-1");
		expect(values.properties).toEqual({
			quantity: 0,
			rating: 0,
			completed: false,
		});
	});

	it("skips non-primitive properties when generating defaults", () => {
		const collection = createAppCollectionFixture({
			membershipPropertiesSchema: {
				fields: {
					pages: {
						label: "Pages",
						type: "integer",
						validation: { required: true },
					},
					tags: {
						label: "Tags",
						type: "array",
						items: { label: "Tag", type: "string" },
						validation: { required: true },
					},
					metadata: {
						type: "object",
						label: "Metadata",
						validation: { required: true },
						properties: {
							rating: {
								label: "Rating",
								type: "number",
								validation: { required: true },
							},
						},
					},
				},
			},
		});
		const values = buildDefaultMembershipFormValues(collection);

		expect(values.properties).toEqual({ pages: 0 });
	});
});

describe("buildMembershipFormSchema", () => {
	it("validates that collectionId is required", () => {
		const schema = buildMembershipFormSchema();
		const result = schema.safeParse({
			properties: {},
			collectionId: "  \n\t ",
		});

		expect(result.success).toBeFalse();
	});

	it("validates that missing required primitive properties fail validation", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: {
						label: "Notes",
						type: "string",
						validation: { required: true },
					},
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
		const schema = buildMembershipFormSchema(collection);

		const missingNotes = schema.safeParse({
			collectionId: "collection-1",
			properties: { quantity: 5 },
		});
		const missingQuantity = schema.safeParse({
			collectionId: "collection-1",
			properties: { notes: "test" },
		});
		const missingBoth = schema.safeParse({
			collectionId: "collection-1",
			properties: {},
		});

		expect(missingNotes.success).toBeFalse();
		expect(missingQuantity.success).toBeFalse();
		expect(missingBoth.success).toBeFalse();
	});

	it("validates that empty strings fail validation for required string fields", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: {
						label: "Notes",
						type: "string",
						validation: { required: true },
					},
				},
			},
		});
		const schema = buildMembershipFormSchema(collection);

		const emptyString = schema.safeParse({
			collectionId: "collection-1",
			properties: { notes: "" },
		});
		const whitespaceOnly = schema.safeParse({
			collectionId: "collection-1",
			properties: { notes: "   " },
		});
		const validString = schema.safeParse({
			collectionId: "collection-1",
			properties: { notes: "valid notes" },
		});

		expect(emptyString.success).toBeFalse();
		expect(whitespaceOnly.success).toBeFalse();
		expect(validString.success).toBeTrue();
	});

	it("validates required primitive properties from the selected collection", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const schema = buildMembershipFormSchema(collection);

		const invalidResult = schema.safeParse({
			collectionId: "collection-1",
			properties: { completed: "not-a-boolean" },
		});
		const validResult = schema.safeParse({
			collectionId: "collection-1",
			properties: { completed: true },
		});

		expect(invalidResult.success).toBeFalse();
		expect(validResult.success).toBeTrue();
	});

	it("blocks collections with required unsupported properties", () => {
		const collection = createAppCollectionFixture({
			membershipPropertiesSchema: {
				fields: {
					notes: {
						label: "Notes",
						type: "string",
						validation: { required: true },
					},
					tags: {
						label: "Tags",
						type: "array",
						items: { label: "Tag", type: "string" },
						validation: { required: true },
					},
					metadata: {
						type: "object",
						label: "Metadata",
						validation: { required: true },
						properties: {
							rating: {
								label: "Rating",
								type: "number",
								validation: { required: true },
							},
						},
					},
				},
			},
		});
		const schema = buildMembershipFormSchema(collection);
		const result = schema.safeParse({
			properties: { notes: "test" },
			collectionId: "collection-1",
		});

		expect(result.success).toBeFalse();
		if (result.success) {
			throw new Error("Expected validation failure");
		}

		expect(result.error.issues).toContainEqual(
			expect.objectContaining({
				path: ["properties"],
				message:
					"This collection requires unsupported properties: tags, metadata.",
			}),
		);
	});

	it("passes validation when collection has no membership schema", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: null,
		});
		const schema = buildMembershipFormSchema(collection);
		const result = schema.safeParse({
			collectionId: "collection-1",
			properties: {},
		});

		expect(result.success).toBeTrue();
	});
});

describe("getUnsupportedRequiredProperties", () => {
	it("returns only required unsupported property keys", () => {
		const schema = {
			fields: {
				pages: {
					label: "Pages",
					type: "integer" as const,
					validation: { required: true as const },
				},
				notes: {
					label: "Notes",
					type: "array" as const,
					items: { label: "Note", type: "string" as const },
				},
				tags: {
					label: "Tags",
					type: "array" as const,
					items: { label: "Tag", type: "string" as const },
					validation: { required: true as const },
				},
				metadata: {
					type: "object" as const,
					label: "Metadata",
					validation: { required: true as const },
					properties: {
						rating: {
							type: "number" as const,
							label: "Rating",
							validation: { required: true as const },
						},
					},
				},
			},
		};
		expect(getUnsupportedRequiredProperties(schema)).toEqual([
			"tags",
			"metadata",
		]);
	});
});

describe("getSelectedCollection", () => {
	it("returns the collection matching the provided id", () => {
		const collections = [
			createAppCollectionFixture({ id: "collection-1", name: "First" }),
			createAppCollectionFixture({ id: "collection-2", name: "Second" }),
		];

		expect(getSelectedCollection(collections, "collection-2")?.id).toBe(
			"collection-2",
		);
	});

	it("falls back to the first collection when the provided id is not found", () => {
		const collections = [
			createAppCollectionFixture({ id: "collection-1", name: "First" }),
			createAppCollectionFixture({ id: "collection-2", name: "Second" }),
		];

		expect(getSelectedCollection(collections, "missing-id")?.id).toBe(
			"collection-1",
		);
	});

	it("falls back to the first collection when no id is provided", () => {
		const collections = [
			createAppCollectionFixture({ id: "collection-1", name: "First" }),
			createAppCollectionFixture({ id: "collection-2", name: "Second" }),
		];

		expect(getSelectedCollection(collections)?.id).toBe("collection-1");
	});

	it("handles empty or whitespace-only id", () => {
		const collections = [
			createAppCollectionFixture({ id: "collection-1", name: "First" }),
		];

		expect(getSelectedCollection(collections, "  ")?.id).toBe("collection-1");
	});
});

describe("toMembershipPayload", () => {
	it("shapes the payload with trimmed ids and parsed properties", () => {
		const payload = toMembershipPayload(
			{
				collectionId: "collection-1",
				properties: { notes: "test", quantity: 5 },
			},
			"entity-1",
		);

		expect(payload).toEqual({
			collectionId: "collection-1",
			entityId: "entity-1",
			properties: { notes: "test", quantity: 5 },
		});
	});

	it("trims whitespace from ids", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
		const payload = toMembershipPayload(
			{
				collectionId: "  collection-1  ",
				properties: { quantity: 5 },
			},
			"  entity-1  ",
			collection,
		);

		expect(payload).toEqual({
			collectionId: "collection-1",
			entityId: "entity-1",
			properties: { quantity: 5 },
		});
	});

	it("passes properties through unchanged when collection has no membership schema", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: null,
		});
		const payload = toMembershipPayload(
			{
				collectionId: "collection-1",
				properties: { notes: "test", quantity: 5, extra: "value" },
			},
			"entity-1",
			collection,
		);

		expect(payload.properties).toEqual({
			notes: "test",
			quantity: 5,
			extra: "value",
		});
	});

	it("sanitizes unknown properties using the selected collection schema", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
		const payload = toMembershipPayload(
			{
				collectionId: "collection-1",
				properties: { quantity: 5, extra: "ignore-me" },
			},
			"entity-1",
			collection,
		);

		expect(payload.properties).toEqual({ quantity: 5 });
	});

	it("shapes payload with required field values", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: {
						label: "Notes",
						type: "string",
						validation: { required: true },
					},
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const payload = toMembershipPayload(
			{
				collectionId: "collection-1",
				properties: { notes: "test notes", quantity: 10, completed: true },
			},
			"entity-1",
			collection,
		);

		expect(payload).toEqual({
			collectionId: "collection-1",
			entityId: "entity-1",
			properties: { notes: "test notes", quantity: 10, completed: true },
		});
	});
});

describe("reconcileMembershipProperties", () => {
	it("preserves compatible values, resets missing required defaults, and drops stale keys", () => {
		expect(
			reconcileMembershipProperties(
				{
					fields: {
						notes: { label: "Notes", type: "string" },
						pages: {
							label: "Pages",
							type: "integer",
							validation: { required: true },
						},
						completed: {
							type: "boolean",
							label: "Completed",
							validation: { required: true },
						},
					},
				},
				{ pages: 42, minutes: 15, completed: "yes", notes: "keep me" },
			),
		).toEqual({ pages: 42, notes: "keep me", completed: false });
	});

	it("skips unsupported properties while keeping supported values", () => {
		expect(
			reconcileMembershipProperties(
				{
					fields: {
						pages: {
							label: "Pages",
							type: "integer",
							validation: { required: true },
						},
						tags: {
							label: "Tags",
							type: "array",
							validation: { required: true },
							items: { label: "Tag", type: "string" },
						},
					},
				},
				{ pages: 12, tags: ["a"] },
			),
		).toEqual({ pages: 12 });
	});

	it("returns empty object when schema has no fields", () => {
		expect(
			reconcileMembershipProperties({ fields: {} }, { old: "value" }),
		).toEqual({});
	});
});

describe("buildMembershipPropertyDefaults", () => {
	it("generates defaults for all required primitive properties", () => {
		const schema = {
			fields: {
				name: {
					label: "Name",
					type: "string" as const,
					validation: { required: true as const },
				},
				count: {
					label: "Count",
					type: "integer" as const,
					validation: { required: true as const },
				},
				score: {
					label: "Score",
					type: "number" as const,
					validation: { required: true as const },
				},
				active: {
					label: "Active",
					type: "boolean" as const,
					validation: { required: true as const },
				},
			},
		};
		expect(buildMembershipPropertyDefaults(schema)).toEqual({
			name: "",
			count: 0,
			score: 0,
			active: false,
		});
	});

	it("skips optional primitive properties", () => {
		const schema = {
			fields: {
				optional: { label: "Optional", type: "string" as const },
				required: {
					label: "Required",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};
		expect(buildMembershipPropertyDefaults(schema)).toEqual({
			required: "",
		});
	});
});

describe("syncMembershipFormValues", () => {
	it("reconciles properties when collection selection changes", () => {
		const newCollection = createAppCollectionFixture({
			id: "collection-2",
			membershipPropertiesSchema: {
				fields: {
					notes: { label: "Notes", type: "string" },
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const result = syncMembershipFormValues(newCollection, {
			collectionId: "collection-1",
			properties: { pages: 20, completed: true, notes: "keep me" },
		});

		expect(result).toEqual({
			collectionId: "collection-2",
			properties: { completed: true, notes: "keep me" },
		});
	});

	it("clears properties when new collection has no schema", () => {
		const newCollection = createAppCollectionFixture({
			id: "collection-2",
			membershipPropertiesSchema: null,
		});
		const result = syncMembershipFormValues(newCollection, {
			collectionId: "collection-1",
			properties: { pages: 20 },
		});

		expect(result).toEqual({
			collectionId: "collection-2",
			properties: {},
		});
	});

	it("keeps existing collectionId when new collection is undefined", () => {
		const result = syncMembershipFormValues(undefined, {
			collectionId: "collection-1",
			properties: { pages: 20 },
		});

		expect(result.collectionId).toBe("collection-1");
	});
});

describe("buildCollectionSelectionPatch", () => {
	it("reconciles properties for the newly selected collection", () => {
		const newCollection = createAppCollectionFixture({
			id: "collection-2",
			membershipPropertiesSchema: {
				fields: {
					notes: { label: "Notes", type: "string" },
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const result = buildCollectionSelectionPatch(newCollection, {
			collectionId: "collection-1",
			properties: { pages: 20, completed: true, notes: "keep me" },
		});

		expect(result).toEqual({
			collectionId: "collection-2",
			properties: { completed: true, notes: "keep me" },
		});
	});
});

describe("getMembershipFormReconciliationState", () => {
	it("tracks the selected collection id and schema for reconciliation", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});

		expect(getMembershipFormReconciliationState(collection)).toEqual({
			collectionId: "collection-1",
			propertiesSchema: {
				fields: {
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
	});

	it("returns empty defaults when no collection is provided", () => {
		expect(getMembershipFormReconciliationState(undefined)).toEqual({
			collectionId: "",
			propertiesSchema: { fields: {} },
		});
	});
});

describe("getMembershipPropertyEntries", () => {
	it("returns empty array when schema is null", () => {
		expect(getMembershipPropertyEntries(null)).toEqual([]);
	});

	it("returns empty array when schema is undefined", () => {
		expect(getMembershipPropertyEntries(undefined)).toEqual([]);
	});

	it("returns property entries with labels for primitive properties only", () => {
		const schema = {
			fields: {
				notes: { label: "My Notes", type: "string" as const },
				quantity: {
					label: "Item Quantity",
					type: "integer" as const,
					validation: { required: true as const },
				},
				tags: {
					label: "Tags",
					type: "array" as const,
					items: { label: "Tag", type: "string" as const },
				},
			},
		};

		const entries = getMembershipPropertyEntries(schema);

		expect(entries).toHaveLength(2);
		expect(entries).toContainEqual({
			key: "notes",
			label: "My Notes",
			definition: { label: "My Notes", type: "string" },
		});
		expect(entries).toContainEqual({
			key: "quantity",
			label: "Item Quantity",
			definition: {
				label: "Item Quantity",
				type: "integer",
				validation: { required: true },
			},
		});
	});

	it("returns empty array when schema has no primitive fields", () => {
		const schema = {
			fields: {
				tags: {
					label: "Tags",
					type: "array" as const,
					items: { label: "Tag", type: "string" as const },
				},
			},
		};

		expect(getMembershipPropertyEntries(schema)).toEqual([]);
	});

	it("returns empty array when schema has empty fields", () => {
		expect(getMembershipPropertyEntries({ fields: {} })).toEqual([]);
	});

	it("generates label from key when property label is empty", () => {
		const schema = {
			fields: {
				myPropertyName: { label: "", type: "string" as const },
				another_property: { label: "", type: "integer" as const },
				someKey: { label: "Existing Label", type: "boolean" as const },
			},
		};

		const entries = getMembershipPropertyEntries(schema);

		expect(entries).toHaveLength(3);
		expect(entries).toContainEqual({
			key: "myPropertyName",
			label: "My Property Name",
			definition: { label: "", type: "string" },
		});
		expect(entries).toContainEqual({
			key: "another_property",
			label: "Another Property",
			definition: { label: "", type: "integer" },
		});
		expect(entries).toContainEqual({
			key: "someKey",
			label: "Existing Label",
			definition: { label: "Existing Label", type: "boolean" },
		});
	});
});

describe("deriveInitialValuesFromEntity", () => {
	it("returns empty collectionId and properties when no collection is selected", () => {
		const entity = createEntityFixture({ properties: { notes: "test" } });
		const values = deriveInitialValuesFromEntity(undefined, entity);

		expect(values.collectionId).toBe("");
		expect(values.properties).toEqual({});
	});

	it("returns collection id and empty properties when collection has no schema", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: null,
		});
		const entity = createEntityFixture({ properties: { notes: "test" } });
		const values = deriveInitialValuesFromEntity(collection, entity);

		expect(values.collectionId).toBe("collection-1");
		expect(values.properties).toEqual({});
	});

	it("maps compatible entity properties to membership form values", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: { label: "Notes", type: "string" },
					pages: {
						label: "Pages",
						type: "integer",
						validation: { required: true },
					},
					rating: {
						label: "Rating",
						type: "number",
						validation: { required: true },
					},
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const entity = createEntityFixture({
			properties: {
				notes: "Entity notes",
				pages: 250,
				rating: 4.5,
				completed: true,
			},
		});
		const values = deriveInitialValuesFromEntity(collection, entity);

		expect(values.collectionId).toBe("collection-1");
		expect(values.properties).toEqual({
			notes: "Entity notes",
			pages: 250,
			rating: 4.5,
			completed: true,
		});
	});

	it("falls back to defaults for entity properties with incompatible types", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: { label: "Notes", type: "string" },
					pages: {
						label: "Pages",
						type: "integer",
						validation: { required: true },
					},
					completed: {
						type: "boolean",
						label: "Completed",
						validation: { required: true },
					},
				},
			},
		});
		const entity = createEntityFixture({
			properties: {
				notes: 123,
				pages: "not-a-number",
				completed: "yes",
			},
		});
		const values = deriveInitialValuesFromEntity(collection, entity);

		expect(values.properties).toEqual({
			pages: 0,
			completed: false,
		});
	});

	it("uses schema defaults for missing entity properties", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					notes: { label: "Notes", type: "string" },
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
		const entity = createEntityFixture({ properties: {} });
		const values = deriveInitialValuesFromEntity(collection, entity);

		expect(values.properties).toEqual({
			quantity: 0,
		});
	});

	it("ignores non-primitive entity properties", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					pages: {
						label: "Pages",
						type: "integer",
						validation: { required: true },
					},
					tags: {
						label: "Tags",
						type: "array",
						items: { label: "Tag", type: "string" },
						validation: { required: true },
					},
				},
			},
		});
		const entity = createEntityFixture({
			properties: {
				pages: 100,
				tags: ["fiction", "classic"],
			},
		});
		const values = deriveInitialValuesFromEntity(collection, entity);

		expect(values.properties).toEqual({ pages: 100 });
	});

	it("handles undefined entity gracefully", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
		const values = deriveInitialValuesFromEntity(collection, undefined);

		expect(values.collectionId).toBe("collection-1");
		expect(values.properties).toEqual({ quantity: 0 });
	});

	it("handles entity with undefined properties", () => {
		const collection = createAppCollectionFixture({
			id: "collection-1",
			membershipPropertiesSchema: {
				fields: {
					quantity: {
						label: "Quantity",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
		const entity = createEntityFixture({ properties: undefined });
		const values = deriveInitialValuesFromEntity(collection, entity);

		expect(values.properties).toEqual({ quantity: 0 });
	});
});
