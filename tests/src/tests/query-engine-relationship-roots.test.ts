import { describe, expect, it } from "bun:test";

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
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("Relationship root sources", () => {
	it("returns relationship rows with relationship and endpoint entity fields sorted by relationship createdAt", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: memberSchemaId, slug: memberSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "RelRootMember" },
		);
		const { schemaId: collectionSchemaId, slug: collectionSlug } =
			await createQueryEngineTrackerAndSchema(client, { schemaName: "RelRootCollection" });
		const relationshipSlug = `rel-root-membership-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Rel Root Membership",
			slug: relationshipSlug,
			sourceEntitySchemaId: memberSchemaId,
			targetEntitySchemaId: collectionSchemaId,
			propertiesSchema: {
				fields: { role: { type: "string", label: "Role", description: "Membership role" } },
			},
		});

		const memberOne = await createQueryEngineEntity(client, {
			name: "Member One",
			entitySchemaId: memberSchemaId,
		});
		const memberTwo = await createQueryEngineEntity(client, {
			name: "Member Two",
			entitySchemaId: memberSchemaId,
		});
		const collection = await createQueryEngineEntity(client, {
			name: "Collection",
			entitySchemaId: collectionSchemaId,
		});

		await createRelationship(client, {
			sourceEntityId: memberOne.id,
			targetEntityId: collection.id,
			properties: { role: "first" },
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
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

		const result = await executeQueryEngine(client, doc);

		expect(result.data.items).toHaveLength(2);
		expect(result.data.pageInfo.total).toBe(2);

		const [first, second] = result.data.items;
		assertPresent(first, "Expected first relationship row");
		assertPresent(second, "Expected second relationship row");
		const firstCreatedAt = new Date(String(requireQueryEngineFieldValue(first, "createdAt").value));
		const secondCreatedAt = new Date(
			String(requireQueryEngineFieldValue(second, "createdAt").value),
		);
		expect(firstCreatedAt.getTime()).toBeGreaterThanOrEqual(secondCreatedAt.getTime());

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
		expect(requireQueryEngineFieldValue(memberOneRow, "collectionName").value).toBe("Collection");
		expect(requireQueryEngineFieldValue(memberOneRow, "role").value).toBe("first");
		expect(requireQueryEngineFieldValue(memberTwoRow, "memberName").value).toBe("Member Two");
		expect(requireQueryEngineFieldValue(memberTwoRow, "role").value).toBe("second");
	});

	it("enforces visibility on relationship rows and both endpoint entities", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();

		const { schemaId: memberSchemaIdA, slug: memberSlugA } =
			await createQueryEngineTrackerAndSchema(userA.client, { schemaName: "RelRootIsoMember" });
		const { schemaId: collectionSchemaIdA, slug: collectionSlugA } =
			await createQueryEngineTrackerAndSchema(userA.client, {
				schemaName: "RelRootIsoCollection",
			});
		const relationshipSlugA = `rel-root-iso-${crypto.randomUUID()}`;
		const relationshipSchemaA = await createRelationshipSchema(userA.client, {
			name: "Rel Root Iso",
			slug: relationshipSlugA,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: memberSchemaIdA,
			targetEntitySchemaId: collectionSchemaIdA,
		});
		const memberA = await createQueryEngineEntity(userA.client, {
			name: "User A Member",
			entitySchemaId: memberSchemaIdA,
		});
		const collectionA = await createQueryEngineEntity(userA.client, {
			name: "User A Collection",
			entitySchemaId: collectionSchemaIdA,
		});
		await createRelationship(userA.client, {
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

		const errorForUserB = await executeQueryEngineError(userB.client, docA);
		expect(errorForUserB).toMatchObject({ _tag: "NotFound" });

		const { schemaId: memberSchemaIdB, slug: memberSlugB } =
			await createQueryEngineTrackerAndSchema(userB.client, { schemaName: "RelRootIsoMember" });
		const { schemaId: collectionSchemaIdB, slug: collectionSlugB } =
			await createQueryEngineTrackerAndSchema(userB.client, {
				schemaName: "RelRootIsoCollection",
			});
		const relationshipSlugB = `rel-root-iso-${crypto.randomUUID()}`;
		const relationshipSchemaB = await createRelationshipSchema(userB.client, {
			name: "Rel Root Iso",
			slug: relationshipSlugB,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: memberSchemaIdB,
			targetEntitySchemaId: collectionSchemaIdB,
		});
		const memberB = await createQueryEngineEntity(userB.client, {
			name: "User B Member",
			entitySchemaId: memberSchemaIdB,
		});
		const collectionB = await createQueryEngineEntity(userB.client, {
			name: "User B Collection",
			entitySchemaId: collectionSchemaIdB,
		});
		await createRelationship(userB.client, {
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

		const resultB = await executeQueryEngine(userB.client, docB);
		expect(resultB.data.items).toHaveLength(1);
		const itemB = resultB.data.items[0];
		assertPresent(itemB, "Expected User B's relationship row");
		expect(requireQueryEngineFieldValue(itemB, "memberName").value).toBe("User B Member");
	});

	it("filters relationship rows by a where on a relationship property", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: memberSchemaId, slug: memberSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "RelWhereMember" },
		);
		const { schemaId: collectionSchemaId, slug: collectionSlug } =
			await createQueryEngineTrackerAndSchema(client, { schemaName: "RelWhereCollection" });
		const relationshipSlug = `rel-where-membership-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Rel Where Membership",
			slug: relationshipSlug,
			sourceEntitySchemaId: memberSchemaId,
			targetEntitySchemaId: collectionSchemaId,
			propertiesSchema: {
				fields: { role: { type: "string", label: "Role", description: "Membership role" } },
			},
		});

		const collection = await createQueryEngineEntity(client, {
			name: "Collection",
			entitySchemaId: collectionSchemaId,
		});
		await Promise.all(
			(
				[
					["Owner One", "owner"],
					["Owner Two", "owner"],
					["Guest One", "guest"],
				] as const
			).map(async ([name, role]) => {
				const member = await createQueryEngineEntity(client, {
					name,
					entitySchemaId: memberSchemaId,
				});
				await createRelationship(client, {
					properties: { role },
					sourceEntityId: member.id,
					targetEntityId: collection.id,
					relationshipSchemaId: relationshipSchema.id,
				});
			}),
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

		const result = await executeQueryEngine(client, doc);

		expect(result.data.pageInfo.total).toBe(2);
		expect(result.data.items).toHaveLength(2);
		for (const item of result.data.items) {
			expect(requireQueryEngineFieldValue(item, "role").value).toBe("owner");
		}
		const names = result.data.items.map(
			(item) => requireQueryEngineFieldValue(item, "memberName").value,
		);
		expect(names).toEqual(["Owner One", "Owner Two"]);
	});

	it("orders relationship rows by a source endpoint entity name", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: memberSchemaId, slug: memberSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "RelOrderMember" },
		);
		const { schemaId: collectionSchemaId, slug: collectionSlug } =
			await createQueryEngineTrackerAndSchema(client, { schemaName: "RelOrderCollection" });
		const relationshipSlug = `rel-order-membership-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Rel Order Membership",
			slug: relationshipSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: memberSchemaId,
			targetEntitySchemaId: collectionSchemaId,
		});

		const collection = await createQueryEngineEntity(client, {
			name: "Collection",
			entitySchemaId: collectionSchemaId,
		});
		await Promise.all(
			["Charlie", "Alice", "Bravo"].map(async (name) => {
				const member = await createQueryEngineEntity(client, {
					name,
					entitySchemaId: memberSchemaId,
				});
				await createRelationship(client, {
					sourceEntityId: member.id,
					targetEntityId: collection.id,
					relationshipSchemaId: relationshipSchema.id,
				});
			}),
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

		const ascending = await executeQueryEngine(client, orderedDoc("asc"));
		expect(
			ascending.data.items.map((item) => requireQueryEngineFieldValue(item, "memberName").value),
		).toEqual(["Alice", "Bravo", "Charlie"]);

		const descending = await executeQueryEngine(client, orderedDoc("desc"));
		expect(
			descending.data.items.map((item) => requireQueryEngineFieldValue(item, "memberName").value),
		).toEqual(["Charlie", "Bravo", "Alice"]);
	});
});
