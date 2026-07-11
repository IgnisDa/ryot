import { Effect } from "effect";

import { createAuthenticatedClient, createCollection, getBackendClient } from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /collections", () => {
	it.live("creates a collection with valid membershipPropertiesSchema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

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

			const collection = yield* createCollection(client, {
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
		}),
	);

	it.live("creates a collection without membershipPropertiesSchema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Favorites",
				description: "My favorite items",
			});

			expect(collection.id).toBeDefined();
			expect(collection.name).toBe("Favorites");
			expect(collection.properties).toMatchObject({
				description: "My favorite items",
			});
		}),
	);

	it.live("rejects collection creation with invalid membershipPropertiesSchema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.create({
						payload: {
							name: "Invalid Collection",
							description: "Should fail",
							membershipPropertiesSchema: { fields: { invalidField: { type: "invalid_type" } } },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
		}),
	);

	it.live("rejects unauthenticated requests", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.create({
						payload: { name: "Test Collection", description: "Should fail" },
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);

	describe("nested membershipPropertiesSchema validation", () => {
		it.live("creates a collection with deeply nested object properties", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

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

				const collection = yield* createCollection(client, {
					membershipPropertiesSchema,
					name: "Nested Schema Collection",
					description: "Testing nested properties",
				});

				expect(collection.id).toBeDefined();
				expect(collection.properties.membershipPropertiesSchema).toEqual(
					membershipPropertiesSchema,
				);
			}),
		);

		it.live("creates a collection with array item schemas", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

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

				const collection = yield* createCollection(client, {
					membershipPropertiesSchema,
					name: "Array Schema Collection",
					description: "Testing array item schemas",
				});

				expect(collection.id).toBeDefined();
				expect(collection.properties.membershipPropertiesSchema).toEqual(
					membershipPropertiesSchema,
				);
			}),
		);

		it.live("rejects collection creation with invalid nested property type", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				const error = yield* Effect.flip(
					client.call((c) =>
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
					),
				);

				assertTaggedError(error, "BadRequest");
				expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
			}),
		);

		it.live("rejects collection creation with invalid nested array item type", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				const error = yield* Effect.flip(
					client.call((c) =>
						c.collections.create({
							payload: {
								description: "Should fail",
								name: "Invalid Array Collection",
								membershipPropertiesSchema: {
									fields: { tags: { type: "array" as const, items: { type: "unknown_type" } } },
								},
							},
						}),
					),
				);

				assertTaggedError(error, "BadRequest");
				expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
			}),
		);

		it.live("creates a collection with multi-level nested schema", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				const membershipPropertiesSchema = {
					fields: {
						priority: { label: "Priority", description: "Priority", type: "integer" as const },
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
										url: { label: "URL", description: "URL", type: "string" as const },
										name: { label: "Name", description: "Name", type: "string" as const },
									},
								},
								tags: {
									label: "Tags",
									description: "Tags",
									type: "array" as const,
									items: {
										label: "Tag",
										description: "Tag",
										type: "object" as const,
										properties: {
											label: { label: "Label", description: "Label", type: "string" as const },
											color: { label: "Color", description: "Color", type: "string" as const },
										},
									},
								},
							},
						},
					},
				};

				const collection = yield* createCollection(client, {
					membershipPropertiesSchema,
					name: "Complex Nested Collection",
					description: "Testing multi-level nesting",
				});

				expect(collection.id).toBeDefined();
				expect(collection.properties.membershipPropertiesSchema).toEqual(
					membershipPropertiesSchema,
				);
			}),
		);
	});
});
