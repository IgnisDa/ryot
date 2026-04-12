import { describe, expect, it } from "bun:test";
import {
	addToCollection,
	createCollection,
	removeFromCollection,
	resolveCollectionName,
} from "./service";

const mockCollectionSchemaId = "mock-schema-id";

const mockDeps = {
	createCollectionForUser: async (input: {
		name: string;
		userId: string;
		entitySchemaId: string;
		properties: Record<string, unknown>;
	}) => ({
		id: "mock-collection-id",
		name: input.name,
		image: null,
		externalId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		entitySchemaId: input.entitySchemaId,
		properties: input.properties,
		sandboxScriptId: null,
	}),
	getBuiltinCollectionSchema: async () => ({
		id: mockCollectionSchemaId,
		propertiesSchema: {
			fields: {
				membershipPropertiesSchema: {
					type: "object" as const,
					properties: {},
					unknownKeys: "strip" as const,
				},
			},
		},
	}),
};

describe("resolveCollectionName", () => {
	it("returns the name when valid", () => {
		expect(resolveCollectionName("My Collection")).toBe("My Collection");
	});

	it("throws when name is empty", () => {
		expect(() => resolveCollectionName("")).toThrow(
			"Collection name is required",
		);
	});

	it("throws when name is whitespace", () => {
		expect(() => resolveCollectionName("   ")).toThrow(
			"Collection name is required",
		);
	});
});

describe("createCollection", () => {
	it("creates a collection with valid input", async () => {
		const result = await createCollection(
			{
				body: { name: "Test Collection" },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.name).toBe("Test Collection");
			expect(result.data.entitySchemaId).toBe(mockCollectionSchemaId);
			expect(result.data.properties).toEqual({});
		}
	});

	it("creates a collection with membershipPropertiesSchema", async () => {
		const membershipSchema = {
			fields: {
				friendWhoRecommendedIt: {
					type: "string" as const,
					label: "Friend Who Recommended It",
				},
			},
		};

		const result = await createCollection(
			{
				body: {
					name: "Recommended to me",
					description: "Movies recommended by friends",
					membershipPropertiesSchema: membershipSchema,
				},
				userId: "user-1",
			},
			mockDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.name).toBe("Recommended to me");
			expect(result.data.properties).toMatchObject({
				description: "Movies recommended by friends",
				membershipPropertiesSchema: membershipSchema,
			});
		}
	});

	it("creates a collection with description only", async () => {
		const result = await createCollection(
			{
				body: { name: "Test Collection", description: "A description" },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.properties).toEqual({ description: "A description" });
		}
	});

	it("returns validation error for empty name", async () => {
		const result = await createCollection(
			{
				body: { name: "" },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain("Collection name");
		}
	});

	it("returns not_found error when collection schema is missing", async () => {
		const depsWithoutSchema = {
			...mockDeps,
			getBuiltinCollectionSchema: async () => undefined,
		};

		const result = await createCollection(
			{
				body: { name: "Test Collection" },
				userId: "user-1",
			},
			depsWithoutSchema,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("not_found");
			expect(result.message).toContain("Collection entity schema not found");
		}
	});

	it("returns validation error for invalid membershipPropertiesSchema type", async () => {
		const result = await createCollection(
			{
				body: {
					name: "Test Collection",
					membershipPropertiesSchema: "not an object",
				} as unknown as { name: string },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		}
	});

	it("returns validation error for membershipPropertiesSchema without fields", async () => {
		const result = await createCollection(
			{
				body: {
					name: "Test Collection",
					membershipPropertiesSchema: { rules: [] },
				} as unknown as { name: string },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		}
	});

	it("returns validation error for membershipPropertiesSchema with invalid property type", async () => {
		const result = await createCollection(
			{
				body: {
					name: "Test Collection",
					membershipPropertiesSchema: {
						fields: {
							invalidField: { type: "invalid_type" },
						},
					},
				} as unknown as { name: string },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		}
	});

	it("propagates repository errors", async () => {
		const failingDeps = {
			...mockDeps,
			createCollectionForUser: async () => {
				throw new Error("Database connection lost");
			},
		};

		expect(
			createCollection(
				{ body: { name: "Test Collection" }, userId: "user-1" },
				failingDeps,
			),
		).rejects.toThrow("Database connection lost");
	});

	describe("nested membershipPropertiesSchema validation", () => {
		it("accepts valid nested object properties", async () => {
			const nestedSchema = {
				fields: {
					friendWhoRecommendedIt: {
						type: "string" as const,
						label: "Friend Who Recommended It",
					},
					recommendationDetails: {
						type: "object" as const,
						label: "Recommendation Details",
						properties: {
							when: { label: "When", type: "date" as const },
							where: { label: "Where", type: "string" as const },
							rating: { label: "Rating", type: "integer" as const },
						},
					},
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Nested Schema Collection",
						membershipPropertiesSchema: nestedSchema,
					},
					userId: "user-1",
				},
				mockDeps,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.properties.membershipPropertiesSchema).toEqual(
					nestedSchema,
				);
			}
		});

		it("accepts valid nested array with item schema", async () => {
			const arraySchema = {
				fields: {
					tags: {
						label: "Tags",
						type: "array" as const,
						items: { label: "Item", type: "string" as const },
					},
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Array Schema Collection",
						membershipPropertiesSchema: arraySchema,
					},
					userId: "user-1",
				},
				mockDeps,
			);

			expect("data" in result).toBe(true);
		});

		it("returns validation error for invalid nested property type", async () => {
			const result = await createCollection(
				{
					body: {
						name: "Invalid Nested Collection",
						membershipPropertiesSchema: {
							fields: {
								nested: {
									type: "object" as const,
									properties: { invalidField: { type: "unknown_type" } },
								},
							},
						},
					} as unknown as { name: string },
					userId: "user-1",
				},
				mockDeps,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"membershipPropertiesSchema must be a valid AppSchema",
				);
			}
		});

		it("returns validation error for invalid array item type", async () => {
			const result = await createCollection(
				{
					body: {
						name: "Invalid Array Collection",
						membershipPropertiesSchema: {
							fields: {
								tags: {
									type: "array" as const,
									items: { type: "unknown_type" },
								},
							},
						},
					} as unknown as { name: string },
					userId: "user-1",
				},
				mockDeps,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"membershipPropertiesSchema must be a valid AppSchema",
				);
			}
		});

		it("accepts complex deeply nested schema with multiple levels", async () => {
			const complexSchema = {
				fields: {
					priority: { label: "Priority", type: "integer" as const },
					metadata: {
						label: "Metadata",
						type: "object" as const,
						properties: {
							source: {
								label: "Source",
								type: "object" as const,
								properties: {
									url: { label: "URL", type: "string" as const },
									name: { label: "Name", type: "string" as const },
								},
							},
							tags: {
								label: "Tags",
								type: "array" as const,
								items: {
									label: "Item",
									type: "object" as const,
									properties: {
										label: { label: "Label", type: "string" as const },
										color: { label: "Color", type: "string" as const },
									},
								},
							},
						},
					},
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Complex Nested Collection",
						membershipPropertiesSchema: complexSchema,
					},
					userId: "user-1",
				},
				mockDeps,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.properties.membershipPropertiesSchema).toEqual(
					complexSchema,
				);
			}
		});

		it("does not create entity when nested template validation fails", async () => {
			let wasCreateCalled = false;

			const trackingDeps = {
				...mockDeps,
				createCollectionForUser: async (input: {
					name: string;
					userId: string;
					entitySchemaId: string;
					properties: Record<string, unknown>;
				}) => {
					wasCreateCalled = true;
					return mockDeps.createCollectionForUser(input);
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Should Not Create",
						membershipPropertiesSchema: {
							fields: {
								nested: {
									type: "object" as const,
									properties: {
										invalid: { type: "bad_type" },
									},
								},
							},
						},
					} as unknown as { name: string },
					userId: "user-1",
				},
				trackingDeps,
			);

			expect("error" in result).toBe(true);
			expect(wasCreateCalled).toBe(false);
		});
	});

	describe("addToCollection", () => {
		const mockCollection = {
			id: "collection-1",
			name: "My Collection",
			image: null,
			externalId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			entitySchemaId: "schema-1",
			properties: {},
			sandboxScriptId: null,
		};

		const mockEntity = { id: "entity-1" };

		const mockRelationship = {
			id: "rel-1",
			properties: {},
			relType: "member_of",
			sourceEntityId: "entity-1",
			targetEntityId: "collection-1",
			createdAt: "2024-01-01T00:00:00Z",
		};

		const mockAddToCollectionDeps = {
			getEntityById: async () => mockEntity,
			getCollectionById: async () => mockCollection,
			addEntityToCollection: async () => ({ memberOf: mockRelationship }),
		};

		it("returns validation error when trying to add collection to itself", async () => {
			const result = await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "same-id", entityId: "same-id" },
				},
				mockAddToCollectionDeps,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toBe("Cannot add a collection to itself");
			}
		});

		it("adds an entity to a collection and returns the membership", async () => {
			const result = await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				mockAddToCollectionDeps,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.memberOf.id).toBe("rel-1");
				expect(result.data.memberOf.relType).toBe("member_of");
				expect(result.data.memberOf.sourceEntityId).toBe("entity-1");
				expect(result.data.memberOf.targetEntityId).toBe("collection-1");
			}
		});

		it("adds an entity with custom properties", async () => {
			const memberOfWithProps = {
				...mockRelationship,
				properties: { priority: "high", notes: "Important item" },
			};

			const depsWithProps = {
				...mockAddToCollectionDeps,
				addEntityToCollection: async () => ({ memberOf: memberOfWithProps }),
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { priority: "high", notes: "Important item" },
					},
				},
				depsWithProps,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.memberOf.properties).toEqual({
					priority: "high",
					notes: "Important item",
				});
			}
		});

		it("validates properties against collection membershipPropertiesSchema", async () => {
			const collectionWithSchema = {
				...mockCollection,
				properties: {
					membershipPropertiesSchema: {
						fields: {
							recommendedBy: { type: "string" },
							rating: { type: "integer" },
						},
					},
				},
			};

			let receivedProperties: Record<string, unknown> | undefined;

			const depsWithSchema = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => collectionWithSchema,
				addEntityToCollection: async (input: {
					collectionId: string;
					entityId: string;
					userId: string;
					properties: Record<string, unknown>;
				}) => {
					receivedProperties = input.properties;
					return {
						memberOf: { ...mockRelationship, properties: input.properties },
					};
				},
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						collectionId: "collection-1",
						entityId: "entity-1",
						properties: {
							recommendedBy: "John",
							rating: 5,
						},
					},
				},
				depsWithSchema,
			);

			expect("data" in result).toBe(true);
			expect(receivedProperties).toEqual({
				recommendedBy: "John",
				rating: 5,
			});
			if ("data" in result) {
				expect(result.data.memberOf.properties).toEqual({
					recommendedBy: "John",
					rating: 5,
				});
			}
		});

		it("returns validation error when properties don't match schema type", async () => {
			const collectionWithSchema = {
				...mockCollection,
				properties: {
					membershipPropertiesSchema: {
						fields: { rating: { type: "integer" } },
					},
				},
			};

			const depsWithSchema = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => collectionWithSchema,
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { rating: "not a number" },
					},
				},
				depsWithSchema,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"Membership properties validation failed",
				);
			}
		});

		it("returns validation error when required property is missing", async () => {
			const collectionWithRequired = {
				...mockCollection,
				properties: {
					membershipPropertiesSchema: {
						fields: {
							recommendedBy: { type: "string", validation: { required: true } },
						},
					},
				},
			};

			const depsWithRequired = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => collectionWithRequired,
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						properties: {},
						entityId: "entity-1",
						collectionId: "collection-1",
					},
				},
				depsWithRequired,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"Membership properties validation failed",
				);
				// Verify stable error format with field path
				expect(result.message).toContain("recommendedBy");
			}
		});

		describe("stable validation error format", () => {
			it("includes field path in validation error for missing required field", async () => {
				const collectionWithRequired = {
					...mockCollection,
					properties: {
						membershipPropertiesSchema: {
							fields: {
								rating: { type: "integer", validation: { required: true } },
							},
						},
					},
				};

				const depsWithRequired = {
					...mockAddToCollectionDeps,
					getCollectionById: async () => collectionWithRequired,
				};

				const result = await addToCollection(
					{
						userId: "user-1",
						body: {
							properties: {},
							entityId: "entity-1",
							collectionId: "collection-1",
						},
					},
					depsWithRequired,
				);

				expect("error" in result).toBe(true);
				if ("error" in result) {
					expect(result.message).toContain("rating");
				}
			});

			it("includes field path in validation error for invalid type", async () => {
				const collectionWithSchema = {
					...mockCollection,
					properties: {
						membershipPropertiesSchema: {
							fields: { score: { type: "integer" } },
						},
					},
				};

				const depsWithSchema = {
					...mockAddToCollectionDeps,
					getCollectionById: async () => collectionWithSchema,
				};

				const result = await addToCollection(
					{
						userId: "user-1",
						body: {
							entityId: "entity-1",
							collectionId: "collection-1",
							properties: { score: "not a number" },
						},
					},
					depsWithSchema,
				);

				expect("error" in result).toBe(true);
				if ("error" in result) {
					expect(result.message).toContain("score");
				}
			});

			it("reports multiple validation errors with stable format", async () => {
				const collectionWithMultipleRequired = {
					...mockCollection,
					properties: {
						membershipPropertiesSchema: {
							fields: {
								name: {
									type: "string",
									validation: { required: true },
								},
								priority: {
									type: "integer",
									validation: { required: true },
								},
							},
						},
					},
				};

				const depsWithMultipleRequired = {
					...mockAddToCollectionDeps,
					getCollectionById: async () => collectionWithMultipleRequired,
				};

				const result = await addToCollection(
					{
						userId: "user-1",
						body: {
							properties: {},
							entityId: "entity-1",
							collectionId: "collection-1",
						},
					},
					depsWithMultipleRequired,
				);

				expect("error" in result).toBe(true);
				if ("error" in result) {
					expect(result.message).toContain("name");
					expect(result.message).toContain("priority");
				}
			});

			it("includes nested field path in validation error", async () => {
				const collectionWithNestedSchema = {
					...mockCollection,
					properties: {
						membershipPropertiesSchema: {
							fields: {
								details: {
									type: "object",
									properties: { score: { type: "integer" } },
								},
							},
						},
					},
				};

				const depsWithNestedSchema = {
					...mockAddToCollectionDeps,
					getCollectionById: async () => collectionWithNestedSchema,
				};

				const result = await addToCollection(
					{
						userId: "user-1",
						body: {
							entityId: "entity-1",
							collectionId: "collection-1",
							properties: { details: { score: "invalid" } },
						},
					},
					depsWithNestedSchema,
				);

				expect("error" in result).toBe(true);
				if ("error" in result) {
					expect(result.message).toContain("details.score");
				}
			});
		});

		it("allows any properties when collection has no membershipPropertiesSchema", async () => {
			const collectionWithoutSchema = { ...mockCollection, properties: {} };

			let receivedProperties: Record<string, unknown> | undefined;

			const depsWithoutSchema = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => collectionWithoutSchema,
				addEntityToCollection: async (input: {
					userId: string;
					entityId: string;
					collectionId: string;
					properties: Record<string, unknown>;
				}) => {
					receivedProperties = input.properties;
					return { memberOf: mockRelationship };
				},
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { anyCustomField: "any value", another: 123 },
					},
				},
				depsWithoutSchema,
			);

			expect("data" in result).toBe(true);
			expect(receivedProperties).toEqual({
				anyCustomField: "any value",
				another: 123,
			});
		});

		it("validates nested object properties against schema", async () => {
			const collectionWithNestedSchema = {
				...mockCollection,
				properties: {
					membershipPropertiesSchema: {
						fields: {
							recommendationDetails: {
								type: "object",
								properties: {
									friend: { type: "string" },
									context: { type: "string" },
								},
							},
						},
					},
				},
			};

			let receivedProperties: Record<string, unknown> | undefined;

			const depsWithNestedSchema = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => collectionWithNestedSchema,
				addEntityToCollection: async (input: {
					userId: string;
					entityId: string;
					collectionId: string;
					properties: Record<string, unknown>;
				}) => {
					receivedProperties = input.properties;
					return {
						memberOf: { ...mockRelationship, properties: input.properties },
					};
				},
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: {
							recommendationDetails: { friend: "Alice", context: "Work lunch" },
						},
					},
				},
				depsWithNestedSchema,
			);

			expect("data" in result).toBe(true);
			expect(receivedProperties).toEqual({
				recommendationDetails: { friend: "Alice", context: "Work lunch" },
			});
			if ("data" in result) {
				expect(result.data.memberOf.properties).toEqual({
					recommendationDetails: { friend: "Alice", context: "Work lunch" },
				});
			}
		});

		it("returns validation error for invalid nested object properties", async () => {
			const collectionWithNestedSchema = {
				...mockCollection,
				properties: {
					membershipPropertiesSchema: {
						fields: {
							recommendationDetails: {
								type: "object",
								properties: {
									friend: { type: "string" },
									score: { type: "integer" },
								},
							},
						},
					},
				},
			};

			const depsWithNestedSchema = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => collectionWithNestedSchema,
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: {
							recommendationDetails: { friend: "Alice", score: "not a number" },
						},
					},
				},
				depsWithNestedSchema,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"Membership properties validation failed",
				);
			}
		});

		it("returns not_found error when entity schema is not visible to user", async () => {
			const depsWithInvisibleEntitySchema = {
				...mockAddToCollectionDeps,
				getEntityById: async () => undefined,
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						collectionId: "collection-1",
						entityId: "entity-with-invisible-schema",
					},
				},
				depsWithInvisibleEntitySchema,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("not_found");
				expect(result.message).toBe("Entity not found");
			}
		});

		it("returns not_found error when collection does not exist", async () => {
			const depsWithMissingCollection = {
				...mockAddToCollectionDeps,
				getCollectionById: async () => undefined,
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "nonexistent", entityId: "entity-1" },
				},
				depsWithMissingCollection,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("not_found");
				expect(result.message).toBe("Collection not found");
			}
		});

		it("returns not_found error when entity does not exist", async () => {
			const depsWithMissingEntity = {
				...mockAddToCollectionDeps,
				getEntityById: async () => undefined,
			};

			const result = await addToCollection(
				{
					body: { collectionId: "collection-1", entityId: "nonexistent" },
					userId: "user-1",
				},
				depsWithMissingEntity,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("not_found");
				expect(result.message).toBe("Entity not found");
			}
		});

		it("uses empty properties when not provided", async () => {
			let receivedProperties: Record<string, unknown> | undefined;

			const trackingDeps = {
				...mockAddToCollectionDeps,
				addEntityToCollection: async (input: {
					userId: string;
					entityId: string;
					collectionId: string;
					properties: Record<string, unknown>;
				}) => {
					receivedProperties = input.properties;
					return { memberOf: mockRelationship };
				},
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				trackingDeps,
			);

			expect("data" in result).toBe(true);
			expect(receivedProperties).toEqual({});
		});

		it("updates existing membership when re-adding same entity to collection", async () => {
			const updatedMemberOf = {
				...mockRelationship,
				id: "existing-rel-1",
				properties: { updated: true, newProp: "value" },
			};

			const depsWithUpsert = {
				...mockAddToCollectionDeps,
				addEntityToCollection: async () => ({ memberOf: updatedMemberOf }),
			};

			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { updated: true, newProp: "value" },
					},
				},
				depsWithUpsert,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.memberOf.properties).toEqual({
					updated: true,
					newProp: "value",
				});
			}
		});

		it("prevents duplicate relationships by upserting", async () => {
			let callCount = 0;
			const depsWithTracking = {
				...mockAddToCollectionDeps,
				addEntityToCollection: async () => {
					callCount++;
					return { memberOf: { ...mockRelationship, id: `rel-${callCount}` } };
				},
			};

			// First add
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				depsWithTracking,
			);

			// Second add (should update, not create duplicate)
			const result = await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { updated: true },
					},
				},
				depsWithTracking,
			);

			expect(callCount).toBe(2);
			expect("data" in result).toBe(true);
		});

		it("propagates repository errors", async () => {
			const failingDeps = {
				...mockAddToCollectionDeps,
				addEntityToCollection: async () => {
					throw new Error("Database connection lost");
				},
			};

			expect(
				addToCollection(
					{
						userId: "user-1",
						body: { collectionId: "collection-1", entityId: "entity-1" },
					},
					failingDeps,
				),
			).rejects.toThrow("Database connection lost");
		});
	});
});

describe("removeFromCollection", () => {
	const mockCollection = {
		image: null,
		properties: {},
		externalId: null,
		id: "collection-1",
		name: "My Collection",
		createdAt: new Date(),
		updatedAt: new Date(),
		sandboxScriptId: null,
		entitySchemaId: "schema-1",
	};

	const mockEntity = { id: "entity-1" };

	const mockMemberOfRelationship = {
		id: "rel-1",
		properties: {},
		relType: "member_of",
		sourceEntityId: "entity-1",
		targetEntityId: "collection-1",
		createdAt: "2024-01-01T00:00:00Z",
	};

	const mockRemoveFromCollectionDeps = {
		getEntityById: async () => mockEntity,
		getCollectionById: async () => mockCollection,
		removeEntityFromCollection: async () => ({
			memberOf: mockMemberOfRelationship,
		}),
	};

	it("removes an entity from a collection and returns the deleted membership", async () => {
		const result = await removeFromCollection(
			{
				userId: "user-1",
				body: { collectionId: "collection-1", entityId: "entity-1" },
			},
			mockRemoveFromCollectionDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.memberOf.id).toBe("rel-1");
			expect(result.data.memberOf.relType).toBe("member_of");
		}
	});

	it("returns not_found error when collection does not exist", async () => {
		const depsWithMissingCollection = {
			...mockRemoveFromCollectionDeps,
			getCollectionById: async () => undefined,
		};

		const result = await removeFromCollection(
			{
				userId: "user-1",
				body: { collectionId: "nonexistent", entityId: "entity-1" },
			},
			depsWithMissingCollection,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("not_found");
			expect(result.message).toBe("Collection not found");
		}
	});

	it("returns not_found error when entity does not exist", async () => {
		const depsWithMissingEntity = {
			...mockRemoveFromCollectionDeps,
			getEntityById: async () => undefined,
		};

		const result = await removeFromCollection(
			{
				userId: "user-1",
				body: { collectionId: "collection-1", entityId: "nonexistent" },
			},
			depsWithMissingEntity,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("not_found");
			expect(result.message).toBe("Entity not found");
		}
	});

	it("returns not_found error when entity schema is not visible to user", async () => {
		const depsWithInvisibleEntitySchema = {
			...mockRemoveFromCollectionDeps,
			getEntityById: async () => undefined,
		};

		const result = await removeFromCollection(
			{
				userId: "user-1",
				body: {
					collectionId: "collection-1",
					entityId: "entity-with-invisible-schema",
				},
			},
			depsWithInvisibleEntitySchema,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("not_found");
			expect(result.message).toBe("Entity not found");
		}
	});

	it("returns not_found error when entity is not in collection", async () => {
		const depsWithNoMembership = {
			...mockRemoveFromCollectionDeps,
			removeEntityFromCollection: async () => undefined,
		};

		const result = await removeFromCollection(
			{
				userId: "user-1",
				body: { collectionId: "collection-1", entityId: "entity-1" },
			},
			depsWithNoMembership,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("not_found");
			expect(result.message).toBe("Entity is not in collection");
		}
	});

	it("propagates repository errors", async () => {
		const failingDeps = {
			...mockRemoveFromCollectionDeps,
			removeEntityFromCollection: async () => {
				throw new Error("Database connection lost");
			},
		};

		expect(
			removeFromCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				failingDeps,
			),
		).rejects.toThrow("Database connection lost");
	});
});
