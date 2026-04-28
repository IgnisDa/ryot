import { describe, expect, it } from "bun:test";
import {
	createAddToCollectionData,
	createAddToCollectionDeps,
	createCollectionDeps,
	createCollectionResponse,
	createRemoveFromCollectionDeps,
} from "~/lib/test-fixtures";
import { expectDataResult, expectErrorResult } from "~/lib/test-helpers";
import {
	addToCollection,
	createCollection,
	removeFromCollection,
	resolveCollectionName,
} from "./service";

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
		const data = expectDataResult(
			await createCollection(
				{ body: { name: "Test Collection" }, userId: "user-1" },
				createCollectionDeps(),
			),
		);

		expect(data.name).toBe("Test Collection");
		expect(data.entitySchemaId).toBe("schema_collection");
		expect(data.properties).toEqual({});
	});

	it("creates a collection with membershipPropertiesSchema", async () => {
		const membershipSchema = {
			fields: {
				friendWhoRecommendedIt: {
					type: "string" as const,
					label: "Friend Who Recommended It",
					description: "Friend who recommended it",
				},
			},
		};

		const data = expectDataResult(
			await createCollection(
				{
					userId: "user-1",
					body: {
						name: "Recommended to me",
						description: "Movies recommended by friends",
						membershipPropertiesSchema: membershipSchema,
					},
				},
				createCollectionDeps(),
			),
		);

		expect(data.name).toBe("Recommended to me");
		expect(data.properties).toMatchObject({
			description: "Movies recommended by friends",
			membershipPropertiesSchema: membershipSchema,
		});
	});

	it("creates a collection with description only", async () => {
		const data = expectDataResult(
			await createCollection(
				{
					userId: "user-1",
					body: { name: "Test Collection", description: "A description" },
				},
				createCollectionDeps(),
			),
		);

		expect(data.properties).toEqual({ description: "A description" });
	});

	it("returns validation error for empty name", async () => {
		const err = expectErrorResult(
			await createCollection(
				{ body: { name: "" }, userId: "user-1" },
				createCollectionDeps(),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain("Collection name");
	});

	it("returns not_found error when collection schema is missing", async () => {
		const err = expectErrorResult(
			await createCollection(
				{ body: { name: "Test Collection" }, userId: "user-1" },
				createCollectionDeps({
					getBuiltinCollectionSchema: async () => undefined,
				}),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toContain("Collection entity schema not found");
	});

	it("returns validation error for invalid membershipPropertiesSchema type", async () => {
		const err = expectErrorResult(
			await createCollection(
				{
					userId: "user-1",
					body: {
						name: "Test Collection",
						membershipPropertiesSchema: "not an object",
					},
				},
				createCollectionDeps(),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	});

	it("returns validation error for membershipPropertiesSchema without fields", async () => {
		const err = expectErrorResult(
			await createCollection(
				{
					userId: "user-1",
					body: {
						name: "Test Collection",
						membershipPropertiesSchema: { rules: [] },
					},
				},
				createCollectionDeps(),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	});

	it("returns validation error for membershipPropertiesSchema with invalid property type", async () => {
		const err = expectErrorResult(
			await createCollection(
				{
					userId: "user-1",
					body: {
						name: "Test Collection",
						membershipPropertiesSchema: {
							fields: {
								invalidField: {
									type: "invalid_type",
									label: "Invalid Field",
									description: "Invalid field",
								},
							},
						},
					},
				},
				createCollectionDeps(),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	});

	it("propagates repository errors", async () => {
		expect(
			createCollection(
				{ body: { name: "Test Collection" }, userId: "user-1" },
				createCollectionDeps({
					createCollectionForUser: async () => {
						throw new Error("Database connection lost");
					},
				}),
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
						description: "Friend who recommended it",
					},
					recommendationDetails: {
						type: "object" as const,
						label: "Recommendation Details",
						description: "Recommendation details",
						properties: {
							when: {
								label: "When",
								type: "date" as const,
								description: "Recommendation date",
							},
							where: {
								label: "Where",
								type: "string" as const,
								description: "Recommendation location",
							},
							rating: {
								label: "Rating",
								type: "integer" as const,
								description: "Recommendation rating",
							},
						},
					},
				},
			};

			const data = expectDataResult(
				await createCollection(
					{
						userId: "user-1",
						body: {
							name: "Nested Schema Collection",
							membershipPropertiesSchema: nestedSchema,
						},
					},
					createCollectionDeps(),
				),
			);

			expect(data.properties.membershipPropertiesSchema).toEqual(nestedSchema);
		});

		it("accepts valid nested array with item schema", async () => {
			const arraySchema = {
				fields: {
					tags: {
						label: "Tags",
						type: "array" as const,
						description: "Tags",
						items: {
							label: "Item",
							type: "string" as const,
							description: "Tag item",
						},
					},
				},
			};

			expectDataResult(
				await createCollection(
					{
						userId: "user-1",
						body: {
							name: "Array Schema Collection",
							membershipPropertiesSchema: arraySchema,
						},
					},
					createCollectionDeps(),
				),
			);
		});

		it("returns validation error for invalid nested property type", async () => {
			const err = expectErrorResult(
				await createCollection(
					{
						userId: "user-1",
						body: {
							name: "Invalid Nested Collection",
							membershipPropertiesSchema: {
								fields: {
									nested: {
										type: "object" as const,
										label: "Nested",
										description: "Nested object",
										properties: {
											invalidField: {
												type: "unknown_type",
												label: "Invalid Field",
												description: "Invalid nested field",
											},
										},
									},
								},
							},
						},
					},
					createCollectionDeps(),
				),
			);

			expect(err.error).toBe("validation");
			expect(err.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		});

		it("returns validation error for invalid array item type", async () => {
			const err = expectErrorResult(
				await createCollection(
					{
						userId: "user-1",
						body: {
							name: "Invalid Array Collection",
							membershipPropertiesSchema: {
								fields: {
									tags: {
										type: "array" as const,
										label: "Tags",
										description: "Tags",
										items: {
											type: "unknown_type",
											label: "Item",
											description: "Invalid array item",
										},
									},
								},
							},
						},
					},
					createCollectionDeps(),
				),
			);

			expect(err.error).toBe("validation");
			expect(err.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		});

		it("accepts complex deeply nested schema with multiple levels", async () => {
			const complexSchema = {
				fields: {
					priority: {
						label: "Priority",
						type: "integer" as const,
						description: "Priority level",
					},
					metadata: {
						label: "Metadata",
						type: "object" as const,
						description: "Metadata",
						properties: {
							source: {
								label: "Source",
								type: "object" as const,
								description: "Source metadata",
								properties: {
									url: {
										label: "URL",
										type: "string" as const,
										description: "Source URL",
									},
									name: {
										label: "Name",
										type: "string" as const,
										description: "Source name",
									},
								},
							},
							tags: {
								label: "Tags",
								type: "array" as const,
								description: "Tag metadata",
								items: {
									label: "Item",
									type: "object" as const,
									description: "Tag item",
									properties: {
										label: {
											label: "Label",
											type: "string" as const,
											description: "Tag label",
										},
										color: {
											label: "Color",
											type: "string" as const,
											description: "Tag color",
										},
									},
								},
							},
						},
					},
				},
			};

			const data = expectDataResult(
				await createCollection(
					{
						userId: "user-1",
						body: {
							name: "Complex Nested Collection",
							membershipPropertiesSchema: complexSchema,
						},
					},
					createCollectionDeps(),
				),
			);

			expect(data.properties.membershipPropertiesSchema).toEqual(complexSchema);
		});

		it("does not create entity when nested template validation fails", async () => {
			let wasCreateCalled = false;

			const result = await createCollection(
				{
					userId: "user-1",
					body: {
						name: "Should Not Create",
						membershipPropertiesSchema: {
							fields: {
								nested: {
									type: "object" as const,
									label: "Nested",
									description: "Nested object",
									properties: {
										invalid: {
											type: "bad_type",
											label: "Invalid",
											description: "Invalid nested property",
										},
									},
								},
							},
						},
					},
				},
				createCollectionDeps({
					createCollectionForUser: async (input) => {
						wasCreateCalled = true;
						return createCollectionResponse({
							name: input.name,
							properties: input.properties,
							entitySchemaId: input.entitySchemaId,
						});
					},
				}),
			);

			expectErrorResult(result);
			expect(wasCreateCalled).toBe(false);
		});
	});
});

describe("addToCollection", () => {
	it("returns validation error when trying to add collection to itself", async () => {
		const err = expectErrorResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "same-id", entityId: "same-id" },
				},
				createAddToCollectionDeps(),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toBe("Cannot add a collection to itself");
	});

	it("adds an entity to a collection and returns the membership", async () => {
		const data = expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createAddToCollectionDeps(),
			),
		);

		expect(data.memberOf.id).toBe("rel_1");
		expect(data.memberOf.relationshipSchemaId).toBe("rel_schema_member_of");
		expect(data.memberOf.sourceEntityId).toBe("entity-1");
		expect(data.memberOf.targetEntityId).toBe("collection-1");
	});

	it("adds an entity with custom properties", async () => {
		const data = expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { priority: "high", notes: "Important item" },
					},
				},
				createAddToCollectionDeps({
					addEntityToCollection: async (input) =>
						createAddToCollectionData({
							memberOf: {
								id: "rel_1",
								properties: input.properties,
								sourceEntityId: input.entityId,
								targetEntityId: input.collectionId,
								createdAt: "2024-01-01T00:00:00.000Z",
								relationshipSchemaId: "rel_schema_member_of",
							},
						}),
				}),
			),
		);

		expect(data.memberOf.properties).toEqual({
			priority: "high",
			notes: "Important item",
		});
	});

	it("upserts in-library when adding a global entity to a collection", async () => {
		const calls: Array<{
			userId: string;
			mediaEntityId: string;
			libraryEntityId: string;
		}> = [];

		expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createAddToCollectionDeps({
					getUserLibraryEntityId: async () => "library-123",
					getEntityById: async () => ({ id: "entity-1", userId: null }),
					upsertInLibraryRelationship: async (input) => {
						calls.push(input);
					},
				}),
			),
		);

		expect(calls).toEqual([
			{
				userId: "user-1",
				mediaEntityId: "entity-1",
				libraryEntityId: "library-123",
			},
		]);
	});

	it("still succeeds when a global entity is already in the library", async () => {
		let upsertCalls = 0;

		expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createAddToCollectionDeps({
					getEntityById: async () => ({ id: "entity-1", userId: null }),
					upsertInLibraryRelationship: async () => {
						upsertCalls++;
					},
				}),
			),
		);

		expect(upsertCalls).toBe(1);
	});

	it("does not upsert in-library for a user-owned entity", async () => {
		let upsertCalls = 0;

		expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createAddToCollectionDeps({
					upsertInLibraryRelationship: async () => {
						upsertCalls++;
					},
				}),
			),
		);

		expect(upsertCalls).toBe(0);
	});

	it("fails clearly when a global entity is added without a library entity", async () => {
		const result = await addToCollection(
			{
				userId: "user-1",
				body: { collectionId: "collection-1", entityId: "entity-1" },
			},
			createAddToCollectionDeps({
				getUserLibraryEntityId: async () => undefined,
				getEntityById: async () => ({ id: "entity-1", userId: null }),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "User library entity not found",
		});
	});

	it("does not upsert in-library when membership properties are invalid", async () => {
		let upsertCalls = 0;

		const result = await addToCollection(
			{
				userId: "user-1",
				body: {
					entityId: "entity-1",
					collectionId: "collection-1",
					properties: { rating: "not a number" },
				},
			},
			createAddToCollectionDeps({
				getEntityById: async () => ({ id: "entity-1", userId: null }),
				getCollectionById: async () =>
					createCollectionResponse({
						properties: {
							membershipPropertiesSchema: {
								fields: {
									rating: {
										type: "integer",
										label: "Rating",
										description: "Rating",
									},
								},
							},
						},
					}),
				upsertInLibraryRelationship: async () => {
					upsertCalls++;
				},
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining(
				"Membership properties validation failed",
			),
		});
		expect(upsertCalls).toBe(0);
	});

	it("validates properties against collection membershipPropertiesSchema", async () => {
		let receivedProperties: Record<string, unknown> | undefined;

		const data = expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { recommendedBy: "John", rating: 5 },
					},
				},
				createAddToCollectionDeps({
					getCollectionById: async () =>
						createCollectionResponse({
							properties: {
								membershipPropertiesSchema: {
									fields: {
										rating: {
											type: "integer",
											label: "Rating",
											description: "Rating",
										},
										recommendedBy: {
											type: "string",
											label: "Recommended By",
											description: "Friend name",
										},
									},
								},
							},
						}),
					addEntityToCollection: async (input) => {
						receivedProperties = input.properties;
						return createAddToCollectionData({
							memberOf: {
								id: "rel_1",
								properties: input.properties,
								sourceEntityId: input.entityId,
								targetEntityId: input.collectionId,
								createdAt: "2024-01-01T00:00:00.000Z",
								relationshipSchemaId: "rel_schema_member_of",
							},
						});
					},
				}),
			),
		);

		expect(receivedProperties).toEqual({ recommendedBy: "John", rating: 5 });
		expect(data.memberOf.properties).toEqual({
			rating: 5,
			recommendedBy: "John",
		});
	});

	it("returns validation error when properties don't match schema type", async () => {
		const err = expectErrorResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { rating: "not a number" },
					},
				},
				createAddToCollectionDeps({
					getCollectionById: async () =>
						createCollectionResponse({
							properties: {
								membershipPropertiesSchema: {
									fields: {
										rating: {
											type: "integer",
											label: "Rating",
											description: "Rating",
										},
									},
								},
							},
						}),
				}),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain("Membership properties validation failed");
	});

	it("returns validation error when required property is missing", async () => {
		const err = expectErrorResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						properties: {},
						entityId: "entity-1",
						collectionId: "collection-1",
					},
				},
				createAddToCollectionDeps({
					getCollectionById: async () =>
						createCollectionResponse({
							properties: {
								membershipPropertiesSchema: {
									fields: {
										recommendedBy: {
											type: "string",
											label: "Recommended By",
											description: "Friend name",
											validation: { required: true },
										},
									},
								},
							},
						}),
				}),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain("Membership properties validation failed");
		expect(err.message).toContain("recommendedBy");
	});

	describe("stable validation error format", () => {
		it("includes field path in validation error for missing required field", async () => {
			const err = expectErrorResult(
				await addToCollection(
					{
						userId: "user-1",
						body: {
							properties: {},
							entityId: "entity-1",
							collectionId: "collection-1",
						},
					},
					createAddToCollectionDeps({
						getCollectionById: async () =>
							createCollectionResponse({
								properties: {
									membershipPropertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Rating",
												description: "Rating",
												validation: { required: true },
											},
										},
									},
								},
							}),
					}),
				),
			);

			expect(err.message).toContain("rating");
		});

		it("includes field path in validation error for invalid type", async () => {
			const err = expectErrorResult(
				await addToCollection(
					{
						userId: "user-1",
						body: {
							entityId: "entity-1",
							collectionId: "collection-1",
							properties: { score: "not a number" },
						},
					},
					createAddToCollectionDeps({
						getCollectionById: async () =>
							createCollectionResponse({
								properties: {
									membershipPropertiesSchema: {
										fields: {
											score: {
												type: "integer",
												label: "Score",
												description: "Score",
											},
										},
									},
								},
							}),
					}),
				),
			);

			expect(err.message).toContain("score");
		});

		it("reports multiple validation errors with stable format", async () => {
			const err = expectErrorResult(
				await addToCollection(
					{
						userId: "user-1",
						body: {
							properties: {},
							entityId: "entity-1",
							collectionId: "collection-1",
						},
					},
					createAddToCollectionDeps({
						getCollectionById: async () =>
							createCollectionResponse({
								properties: {
									membershipPropertiesSchema: {
										fields: {
											name: {
												type: "string",
												label: "Name",
												description: "Name",
												validation: { required: true },
											},
											priority: {
												type: "integer",
												label: "Priority",
												description: "Priority",
												validation: { required: true },
											},
										},
									},
								},
							}),
					}),
				),
			);

			expect(err.message).toContain("name");
			expect(err.message).toContain("priority");
		});

		it("includes nested field path in validation error", async () => {
			const err = expectErrorResult(
				await addToCollection(
					{
						userId: "user-1",
						body: {
							entityId: "entity-1",
							collectionId: "collection-1",
							properties: { details: { score: "invalid" } },
						},
					},
					createAddToCollectionDeps({
						getCollectionById: async () =>
							createCollectionResponse({
								properties: {
									membershipPropertiesSchema: {
										fields: {
											details: {
												type: "object",
												label: "Details",
												description: "Details",
												properties: {
													score: {
														type: "integer",
														label: "Score",
														description: "Score",
													},
												},
											},
										},
									},
								},
							}),
					}),
				),
			);

			expect(err.message).toContain("details.score");
		});
	});

	it("allows any properties when collection has no membershipPropertiesSchema", async () => {
		let receivedProperties: Record<string, unknown> | undefined;

		expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { anyCustomField: "any value", another: 123 },
					},
				},
				createAddToCollectionDeps({
					addEntityToCollection: async (input) => {
						receivedProperties = input.properties;
						return createAddToCollectionData();
					},
				}),
			),
		);

		expect(receivedProperties).toEqual({
			anyCustomField: "any value",
			another: 123,
		});
	});

	it("validates nested object properties against schema", async () => {
		let receivedProperties: Record<string, unknown> | undefined;

		const data = expectDataResult(
			await addToCollection(
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
				createAddToCollectionDeps({
					getCollectionById: async () =>
						createCollectionResponse({
							properties: {
								membershipPropertiesSchema: {
									fields: {
										recommendationDetails: {
											type: "object",
											label: "Recommendation Details",
											description: "Recommendation details",
											properties: {
												friend: {
													type: "string",
													label: "Friend",
													description: "Friend name",
												},
												context: {
													type: "string",
													label: "Context",
													description: "Recommendation context",
												},
											},
										},
									},
								},
							},
						}),
					addEntityToCollection: async (input) => {
						receivedProperties = input.properties;
						return createAddToCollectionData({
							memberOf: {
								id: "rel_1",
								properties: input.properties,
								sourceEntityId: input.entityId,
								targetEntityId: input.collectionId,
								createdAt: "2024-01-01T00:00:00.000Z",
								relationshipSchemaId: "rel_schema_member_of",
							},
						});
					},
				}),
			),
		);

		expect(receivedProperties).toEqual({
			recommendationDetails: { friend: "Alice", context: "Work lunch" },
		});
		expect(data.memberOf.properties).toEqual({
			recommendationDetails: { friend: "Alice", context: "Work lunch" },
		});
	});

	it("returns validation error for invalid nested object properties", async () => {
		const err = expectErrorResult(
			await addToCollection(
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
				createAddToCollectionDeps({
					getCollectionById: async () =>
						createCollectionResponse({
							properties: {
								membershipPropertiesSchema: {
									fields: {
										recommendationDetails: {
											type: "object",
											label: "Recommendation Details",
											description: "Recommendation details",
											properties: {
												friend: {
													type: "string",
													label: "Friend",
													description: "Friend name",
												},
												score: {
													type: "integer",
													label: "Score",
													description: "Recommendation score",
												},
											},
										},
									},
								},
							},
						}),
				}),
			),
		);

		expect(err.error).toBe("validation");
		expect(err.message).toContain("Membership properties validation failed");
	});

	it("returns not_found error when entity schema is not visible to user", async () => {
		const err = expectErrorResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						collectionId: "collection-1",
						entityId: "entity-with-invisible-schema",
					},
				},
				createAddToCollectionDeps({ getEntityById: async () => undefined }),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Entity not found");
	});

	it("returns not_found error when collection does not exist", async () => {
		const err = expectErrorResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "nonexistent", entityId: "entity-1" },
				},
				createAddToCollectionDeps({ getCollectionById: async () => undefined }),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Collection not found");
	});

	it("returns not_found error when entity does not exist", async () => {
		const err = expectErrorResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "nonexistent" },
				},
				createAddToCollectionDeps({ getEntityById: async () => undefined }),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Entity not found");
	});

	it("uses empty properties when not provided", async () => {
		let receivedProperties: Record<string, unknown> | undefined;

		expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createAddToCollectionDeps({
					addEntityToCollection: async (input) => {
						receivedProperties = input.properties;
						return createAddToCollectionData();
					},
				}),
			),
		);

		expect(receivedProperties).toEqual({});
	});

	it("updates existing membership when re-adding same entity to collection", async () => {
		const data = expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { updated: true, newProp: "value" },
					},
				},
				createAddToCollectionDeps({
					addEntityToCollection: async (input) =>
						createAddToCollectionData({
							memberOf: {
								id: "existing-rel-1",
								properties: input.properties,
								sourceEntityId: input.entityId,
								targetEntityId: input.collectionId,
								createdAt: "2024-01-01T00:00:00.000Z",
								relationshipSchemaId: "rel_schema_member_of",
							},
						}),
				}),
			),
		);

		expect(data.memberOf.properties).toEqual({
			updated: true,
			newProp: "value",
		});
	});

	it("prevents duplicate relationships by upserting", async () => {
		let callCount = 0;

		const addEntityToCollection = async (input: {
			userId: string;
			entityId: string;
			collectionId: string;
			properties: Record<string, unknown>;
		}) => {
			callCount++;
			return createAddToCollectionData({
				memberOf: {
					id: `rel_${callCount}`,
					properties: input.properties,
					sourceEntityId: input.entityId,
					targetEntityId: input.collectionId,
					createdAt: "2024-01-01T00:00:00.000Z",
					relationshipSchemaId: "rel_schema_member_of",
				},
			});
		};

		await addToCollection(
			{
				userId: "user-1",
				body: { collectionId: "collection-1", entityId: "entity-1" },
			},
			createAddToCollectionDeps({ addEntityToCollection }),
		);

		expectDataResult(
			await addToCollection(
				{
					userId: "user-1",
					body: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { updated: true },
					},
				},
				createAddToCollectionDeps({ addEntityToCollection }),
			),
		);

		expect(callCount).toBe(2);
	});

	it("propagates repository errors", async () => {
		expect(
			addToCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createAddToCollectionDeps({
					addEntityToCollection: async () => {
						throw new Error("Database connection lost");
					},
				}),
			),
		).rejects.toThrow("Database connection lost");
	});
});

describe("removeFromCollection", () => {
	it("removes an entity from a collection and returns the deleted membership", async () => {
		const data = expectDataResult(
			await removeFromCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createRemoveFromCollectionDeps(),
			),
		);

		expect(data.memberOf.id).toBe("rel_1");
		expect(data.memberOf.relationshipSchemaId).toBe("rel_schema_member_of");
	});

	it("returns not_found error when collection does not exist", async () => {
		const err = expectErrorResult(
			await removeFromCollection(
				{
					userId: "user-1",
					body: { collectionId: "nonexistent", entityId: "entity-1" },
				},
				createRemoveFromCollectionDeps({
					getCollectionById: async () => undefined,
				}),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Collection not found");
	});

	it("returns not_found error when entity does not exist", async () => {
		const err = expectErrorResult(
			await removeFromCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "nonexistent" },
				},
				createRemoveFromCollectionDeps({
					getEntityById: async () => undefined,
				}),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Entity not found");
	});

	it("returns not_found error when entity schema is not visible to user", async () => {
		const err = expectErrorResult(
			await removeFromCollection(
				{
					userId: "user-1",
					body: {
						collectionId: "collection-1",
						entityId: "entity-with-invisible-schema",
					},
				},
				createRemoveFromCollectionDeps({
					getEntityById: async () => undefined,
				}),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Entity not found");
	});

	it("returns not_found error when entity is not in collection", async () => {
		const err = expectErrorResult(
			await removeFromCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createRemoveFromCollectionDeps({
					removeEntityFromCollection: async () => undefined,
				}),
			),
		);

		expect(err.error).toBe("not_found");
		expect(err.message).toBe("Entity is not in collection");
	});

	it("propagates repository errors", async () => {
		expect(
			removeFromCollection(
				{
					userId: "user-1",
					body: { collectionId: "collection-1", entityId: "entity-1" },
				},
				createRemoveFromCollectionDeps({
					removeEntityFromCollection: async () => {
						throw new Error("Database connection lost");
					},
				}),
			),
		).rejects.toThrow("Database connection lost");
	});
});
