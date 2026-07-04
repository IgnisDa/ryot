import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createRelationship,
	createRelationshipSchema,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	executeQueryEngineError,
	propertyRef,
	requireQueryEngineFieldValue,
	systemRef,
	type QueryEnginePayload,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Relationship root sources", () => {
	it.live(
		"returns relationship rows with relationship and endpoint entity fields sorted by relationship createdAt",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId: memberSchemaId, slug: memberSlug } =
					yield* createQueryEngineTrackerAndSchema(client, { schemaName: "RelRootMember" });
				const { schemaId: collectionSchemaId, slug: collectionSlug } =
					yield* createQueryEngineTrackerAndSchema(client, { schemaName: "RelRootCollection" });
				const relationshipSlug = `rel-root-membership-${crypto.randomUUID()}`;
				const relationshipSchema = yield* createRelationshipSchema(client, {
					name: "Rel Root Membership",
					slug: relationshipSlug,
					sourceEntitySchemaId: memberSchemaId,
					targetEntitySchemaId: collectionSchemaId,
					propertiesSchema: {
						fields: { role: { type: "string", label: "Role", description: "Membership role" } },
					},
				});

				const memberOne = yield* createQueryEngineEntity(client, {
					name: "Member One",
					entitySchemaId: memberSchemaId,
				});
				const memberTwo = yield* createQueryEngineEntity(client, {
					name: "Member Two",
					entitySchemaId: memberSchemaId,
				});
				const collection = yield* createQueryEngineEntity(client, {
					name: "Collection",
					entitySchemaId: collectionSchemaId,
				});

				yield* createRelationship(client, {
					sourceEntityId: memberOne.id,
					targetEntityId: collection.id,
					properties: { role: "first" },
					relationshipSchemaId: relationshipSchema.id,
				});
				yield* createRelationship(client, {
					sourceEntityId: memberTwo.id,
					targetEntityId: collection.id,
					properties: { role: "second" },
					relationshipSchemaId: relationshipSchema.id,
				});

				const doc: QueryEnginePayload = {
					source: {
						where: null,
						alias: "membership",
						type: "relationships",
						schemas: [relationshipSlug],
						sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
						targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
					},
					output: {
						type: "rows",
						pagination: { page: 1, limit: 10 },
						orderBy: [{ order: "desc", expr: systemRef("membership", "createdAt") }],
						fields: [
							{ key: "createdAt", expr: systemRef("membership", "createdAt") },
							{ key: "sourceEntityId", expr: systemRef("membership", "sourceEntityId") },
							{ key: "memberName", expr: systemRef("memberEntity", "name") },
							{ key: "collectionName", expr: systemRef("collectionEntity", "name") },
							{ key: "role", expr: propertyRef("membership", relationshipSlug, "role") },
						],
					},
				};

				const result = yield* executeQueryEngine(client, doc);

				expect(result.data.items).toHaveLength(2);
				expect(result.data.pageInfo.total).toBe(2);

				const [first, second] = result.data.items;
				assertPresent(first, "Expected first relationship row");
				assertPresent(second, "Expected second relationship row");
				const firstCreatedAt = DateTime.unsafeMake(
					String(requireQueryEngineFieldValue(first, "createdAt").value),
				);
				const secondCreatedAt = DateTime.unsafeMake(
					String(requireQueryEngineFieldValue(second, "createdAt").value),
				);
				expect(DateTime.toEpochMillis(firstCreatedAt)).toBeGreaterThanOrEqual(
					DateTime.toEpochMillis(secondCreatedAt),
				);

				const byMember = new Map(
					result.data.items.map((item) => [
						requireQueryEngineFieldValue(item, "sourceEntityId").value,
						item,
					]),
				);
				const memberOneRow = byMember.get(memberOne.id);
				const memberTwoRow = byMember.get(memberTwo.id);
				assertPresent(memberOneRow, "Expected Member One's relationship row");
				assertPresent(memberTwoRow, "Expected Member Two's relationship row");
				expect(requireQueryEngineFieldValue(memberOneRow, "memberName").value).toBe("Member One");
				expect(requireQueryEngineFieldValue(memberOneRow, "collectionName").value).toBe(
					"Collection",
				);
				expect(requireQueryEngineFieldValue(memberOneRow, "role").value).toBe("first");
				expect(requireQueryEngineFieldValue(memberTwoRow, "memberName").value).toBe("Member Two");
				expect(requireQueryEngineFieldValue(memberTwoRow, "role").value).toBe("second");
			}),
	);

	it.live("enforces visibility on relationship rows and both endpoint entities", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();

			const { schemaId: memberSchemaIdA, slug: memberSlugA } =
				yield* createQueryEngineTrackerAndSchema(userA.client, { schemaName: "RelRootIsoMember" });
			const { schemaId: collectionSchemaIdA, slug: collectionSlugA } =
				yield* createQueryEngineTrackerAndSchema(userA.client, {
					schemaName: "RelRootIsoCollection",
				});
			const relationshipSlugA = `rel-root-iso-${crypto.randomUUID()}`;
			const relationshipSchemaA = yield* createRelationshipSchema(userA.client, {
				name: "Rel Root Iso",
				slug: relationshipSlugA,
				sourceEntitySchemaId: memberSchemaIdA,
				targetEntitySchemaId: collectionSchemaIdA,
			});
			const memberA = yield* createQueryEngineEntity(userA.client, {
				name: "User A Member",
				entitySchemaId: memberSchemaIdA,
			});
			const collectionA = yield* createQueryEngineEntity(userA.client, {
				name: "User A Collection",
				entitySchemaId: collectionSchemaIdA,
			});
			yield* createRelationship(userA.client, {
				sourceEntityId: memberA.id,
				targetEntityId: collectionA.id,
				relationshipSchemaId: relationshipSchemaA.id,
			});

			const docA: QueryEnginePayload = {
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlugA],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlugA] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlugA] },
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "desc", expr: systemRef("membership", "createdAt") }],
					fields: [{ key: "memberName", expr: systemRef("memberEntity", "name") }],
				},
			};

			const errorForUserB = yield* executeQueryEngineError(userB.client, docA);
			expect(errorForUserB).toMatchObject({ _tag: "NotFound" });

			const { schemaId: memberSchemaIdB, slug: memberSlugB } =
				yield* createQueryEngineTrackerAndSchema(userB.client, { schemaName: "RelRootIsoMember" });
			const { schemaId: collectionSchemaIdB, slug: collectionSlugB } =
				yield* createQueryEngineTrackerAndSchema(userB.client, {
					schemaName: "RelRootIsoCollection",
				});
			const relationshipSlugB = `rel-root-iso-${crypto.randomUUID()}`;
			const relationshipSchemaB = yield* createRelationshipSchema(userB.client, {
				name: "Rel Root Iso",
				slug: relationshipSlugB,
				sourceEntitySchemaId: memberSchemaIdB,
				targetEntitySchemaId: collectionSchemaIdB,
			});
			const memberB = yield* createQueryEngineEntity(userB.client, {
				name: "User B Member",
				entitySchemaId: memberSchemaIdB,
			});
			const collectionB = yield* createQueryEngineEntity(userB.client, {
				name: "User B Collection",
				entitySchemaId: collectionSchemaIdB,
			});
			yield* createRelationship(userB.client, {
				sourceEntityId: memberB.id,
				targetEntityId: collectionB.id,
				relationshipSchemaId: relationshipSchemaB.id,
			});

			const docB: QueryEnginePayload = {
				...docA,
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlugB],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlugB] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlugB] },
				},
			};

			const resultB = yield* executeQueryEngine(userB.client, docB);
			expect(resultB.data.items).toHaveLength(1);
			const itemB = resultB.data.items[0];
			assertPresent(itemB, "Expected User B's relationship row");
			expect(requireQueryEngineFieldValue(itemB, "memberName").value).toBe("User B Member");
		}),
	);

	it.live("filters relationship rows by a where on a relationship property", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "RelWhereMember" });
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "RelWhereCollection" });
			const relationshipSlug = `rel-where-membership-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "Rel Where Membership",
				slug: relationshipSlug,
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
				propertiesSchema: {
					fields: { role: { type: "string", label: "Role", description: "Membership role" } },
				},
			});

			const collection = yield* createQueryEngineEntity(client, {
				name: "Collection",
				entitySchemaId: collectionSchemaId,
			});
			yield* Effect.all(
				(
					[
						["Owner One", "owner"],
						["Owner Two", "owner"],
						["Guest One", "guest"],
					] as const
				).map(([name, role]) =>
					Effect.gen(function* () {
						const member = yield* createQueryEngineEntity(client, {
							name,
							entitySchemaId: memberSchemaId,
						});
						yield* createRelationship(client, {
							properties: { role },
							sourceEntityId: member.id,
							targetEntityId: collection.id,
							relationshipSchemaId: relationshipSchema.id,
						});
					}),
				),
			);

			const doc: QueryEnginePayload = {
				source: {
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlug],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
					where: {
						type: "comparison",
						operator: "eq",
						right: { type: "literal", value: "owner" },
						left: propertyRef("membership", relationshipSlug, "role"),
					},
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "asc", expr: systemRef("memberEntity", "name") }],
					fields: [
						{ key: "memberName", expr: systemRef("memberEntity", "name") },
						{ key: "role", expr: propertyRef("membership", relationshipSlug, "role") },
					],
				},
			};

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(2);
			expect(result.data.items).toHaveLength(2);
			for (const item of result.data.items) {
				expect(requireQueryEngineFieldValue(item, "role").value).toBe("owner");
			}
			const names = result.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "memberName").value,
			);
			expect(names).toEqual(["Owner One", "Owner Two"]);
		}),
	);

	it.live("orders relationship rows by a source endpoint entity name", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "RelOrderMember" });
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "RelOrderCollection" });
			const relationshipSlug = `rel-order-membership-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "Rel Order Membership",
				slug: relationshipSlug,
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
			});

			const collection = yield* createQueryEngineEntity(client, {
				name: "Collection",
				entitySchemaId: collectionSchemaId,
			});
			yield* Effect.all(
				["Charlie", "Alice", "Bravo"].map((name) =>
					Effect.gen(function* () {
						const member = yield* createQueryEngineEntity(client, {
							name,
							entitySchemaId: memberSchemaId,
						});
						yield* createRelationship(client, {
							sourceEntityId: member.id,
							targetEntityId: collection.id,
							relationshipSchemaId: relationshipSchema.id,
						});
					}),
				),
			);

			const orderedDoc = (order: "asc" | "desc"): QueryEnginePayload => ({
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlug],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order, expr: systemRef("memberEntity", "name") }],
					fields: [{ key: "memberName", expr: systemRef("memberEntity", "name") }],
				},
			});

			const ascending = yield* executeQueryEngine(client, orderedDoc("asc"));
			expect(
				ascending.data.items.map((item) => requireQueryEngineFieldValue(item, "memberName").value),
			).toEqual(["Alice", "Bravo", "Charlie"]);

			const descending = yield* executeQueryEngine(client, orderedDoc("desc"));
			expect(
				descending.data.items.map((item) => requireQueryEngineFieldValue(item, "memberName").value),
			).toEqual(["Charlie", "Bravo", "Alice"]);
		}),
	);
});
