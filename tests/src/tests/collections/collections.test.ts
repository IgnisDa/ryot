import { describe, expect, it } from "bun:test";

import { createAuthenticatedClient, createCollection, getBackendClient } from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";

describe("POST /collections", () => {
	it("creates a collection with valid membershipPropertiesSchema", async () => {
		const { client } = await createAuthenticatedClient();

		const membershipPropertiesSchema = {
			fields: {
				friendWhoRecommendedIt: {
					type: "string" as const,
					label: "Friend Who Recommended It",
					description: "Friend Who Recommended It",
				},
				whereTheyRecommendedIt: {
					type: "string" as const,
					label: "Where They Recommended It",
					description: "Where They Recommended It",
				},
			},
		};

		const collection = await createCollection(client, {
			name: "Recommended to me",
			membershipPropertiesSchema,
			description: "Movies and books recommended by friends",
		});

		expect(collection.id).toBeDefined();
		expect(collection.name).toBe("Recommended to me");
		expect(collection.properties).toMatchObject({
			membershipPropertiesSchema,
			description: "Movies and books recommended by friends",
		});
	});

	it("creates a collection without membershipPropertiesSchema", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "Favorites",
			description: "My favorite items",
		});

		expect(collection.id).toBeDefined();
		expect(collection.name).toBe("Favorites");
		expect(collection.properties).toMatchObject({
			description: "My favorite items",
		});
	});

	it("rejects collection creation with invalid membershipPropertiesSchema", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.collections.create({
				payload: {
					name: "Invalid Collection",
					description: "Should fail",
					membershipPropertiesSchema: { fields: { invalidField: { type: "invalid_type" } } },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
	});

	it("rejects unauthenticated requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.collections.create({
				payload: {
					name: "Test Collection",
					description: "Should fail",
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});

	describe("nested membershipPropertiesSchema validation", () => {
		it("creates a collection with deeply nested object properties", async () => {
			const { client } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					friendWhoRecommendedIt: {
						type: "string" as const,
						label: "Friend Who Recommended It",
						description: "Friend Who Recommended It",
					},
					recommendationDetails: {
						type: "object" as const,
						label: "Recommendation Details",
						description: "Recommendation Details",
						properties: {
							when: { label: "When", description: "When", type: "date" as const },
							where: { label: "Where", description: "Where", type: "string" as const },
							rating: { label: "Rating", description: "Rating", type: "integer" as const },
						},
					},
				},
			};

			const collection = await createCollection(client, {
				membershipPropertiesSchema,
				name: "Nested Schema Collection",
				description: "Testing nested properties",
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(membershipPropertiesSchema);
		});

		it("creates a collection with array item schemas", async () => {
			const { client } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					tags: {
						label: "Tags",
						description: "Tags",
						type: "array" as const,
						items: { label: "Tag", description: "Tag", type: "string" as const },
					},
					recommendations: {
						type: "array" as const,
						label: "Recommendations",
						description: "Recommendations",
						items: {
							type: "object" as const,
							label: "Recommendation",
							description: "Recommendation",
							properties: {
								friend: { label: "Friend", description: "Friend", type: "string" as const },
								context: { label: "Context", description: "Context", type: "string" as const },
							},
						},
					},
				},
			};

			const collection = await createCollection(client, {
				membershipPropertiesSchema,
				name: "Array Schema Collection",
				description: "Testing array item schemas",
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(membershipPropertiesSchema);
		});

		it("rejects collection creation with invalid nested property type", async () => {
			const { client } = await createAuthenticatedClient();

			const error = await client.runError((c) =>
				c.collections.create({
					payload: {
						description: "Should fail",
						name: "Invalid Nested Collection",
						membershipPropertiesSchema: {
							fields: {
								nested: {
									type: "object" as const,
									properties: { invalidField: { type: "unknown_type" } },
								},
							},
						},
					},
				}),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
		});

		it("rejects collection creation with invalid nested array item type", async () => {
			const { client } = await createAuthenticatedClient();

			const error = await client.runError((c) =>
				c.collections.create({
					payload: {
						description: "Should fail",
						name: "Invalid Array Collection",
						membershipPropertiesSchema: {
							fields: { tags: { type: "array" as const, items: { type: "unknown_type" } } },
						},
					},
				}),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
		});

		it("creates a collection with multi-level nested schema", async () => {
			const { client } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					priority: {
						type: "integer" as const,
						label: "Priority",
						description: "Priority",
					},
					metadata: {
						label: "Metadata",
						description: "Metadata",
						type: "object" as const,
						properties: {
							source: {
								label: "Source",
								description: "Source",
								type: "object" as const,
								properties: {
									url: {
										type: "string" as const,
										label: "URL",
										description: "URL",
									},
									name: {
										type: "string" as const,
										label: "Name",
										description: "Name",
									},
								},
							},
							tags: {
								label: "Tags",
								description: "Tags",
								type: "array" as const,
								items: {
									type: "object" as const,
									label: "Tag",
									description: "Tag",
									properties: {
										label: {
											type: "string" as const,
											label: "Label",
											description: "Label",
										},
										color: {
											type: "string" as const,
											label: "Color",
											description: "Color",
										},
									},
								},
							},
						},
					},
				},
			};

			const collection = await createCollection(client, {
				membershipPropertiesSchema,
				name: "Complex Nested Collection",
				description: "Testing multi-level nesting",
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(membershipPropertiesSchema);
		});
	});
});
